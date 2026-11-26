const express = require('express');
const { db, transaction } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

function produtoParaApi(p) {
  const variants = db.prepare('SELECT id, nome_cor, imagem_url FROM product_variants WHERE product_id = ? AND arquivado = 0').all(p.id);
  const variacoes = variants.length
    ? variants.map((v) => {
        const sb = db.prepare('SELECT disponivel FROM stock_balances WHERE variant_id = ?').get(v.id);
        return { id: v.id, cor: v.nome_cor, imagem: v.imagem_url, estoque: sb ? sb.disponivel : 0 };
      })
    : [{ cor: 'Modelo unico', imagem: p.imagem_url }];
  const cat = p.category_id ? db.prepare('SELECT slug FROM categories WHERE id = ?').get(p.category_id) : null;
  return {
    id: p.id,
    codigo: p.codigo,
    nome: p.nome,
    categoria: cat ? cat.slug : '',
    preco: p.preco_centavos / 100,
    imagem: p.imagem_url,
    descricao: p.descricao,
    variacoes: variacoes,
    destaque: !!p.destaque,
    novidade: !!p.novidade,
    estoque: variacoes.reduce((a, v) => a + (v.estoque || 0), 0),
    arquivado: !!p.arquivado
  };
}

router.get('/api/produtos', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM products WHERE arquivado = 0 ORDER BY id').all();
    res.json(rows.map(produtoParaApi));
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

router.get('/api/categorias', (req, res) => {
  try {
    const rows = db.prepare('SELECT id, slug, nome, parent_id, ordem, ativa FROM categories WHERE ativa = 1 ORDER BY ordem, id').all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

router.post('/api/produtos', requireAdmin, (req, res) => {
  const arr = req.body;
  if (!Array.isArray(arr)) return res.status(400).json({ ok: false, erro: 'Formato invalido' });
  try {
    transaction((db) => {
      const flags = {};
      for (const r of db.prepare('SELECT id, destaque, novidade FROM products').all()) flags[r.id] = { destaque: r.destaque, novidade: r.novidade };
      const estoqueAntigo = {};
      for (const r of db.prepare('SELECT pv.product_id AS pid, pv.nome_cor AS cor, COALESCE(sb.disponivel,0) AS disponivel, COALESCE(sb.reservada,0) AS reservada FROM product_variants pv LEFT JOIN stock_balances sb ON sb.variant_id = pv.id').all()) {
        estoqueAntigo[r.pid + '|' + r.cor] = { disponivel: r.disponivel, reservada: r.reservada };
      }

      db.exec('DELETE FROM stock_balances');
      db.exec('DELETE FROM product_variants');
      db.exec('DELETE FROM products');

      const insertProd = db.prepare(`INSERT INTO products (id, codigo, category_id, nome, descricao, preco_centavos, imagem_url, destaque, novidade)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      const insertVar = db.prepare(`INSERT INTO product_variants (product_id, nome_cor, imagem_url) VALUES (?,?,?)`);
      const insertStock = db.prepare(`INSERT OR IGNORE INTO stock_balances (variant_id, disponivel, reservada) VALUES (?,?,?)`);
      const catBySlug = {};
      for (const r of db.prepare('SELECT id, slug FROM categories').all()) catBySlug[r.slug] = r.id;

      for (const p of arr) {
        const f = flags[p.id] || { destaque: 0, novidade: 0 };
        insertProd.run(
          p.id,
          p.codigo || ('P' + String(p.id).padStart(4, '0')),
          catBySlug[p.categoria] || null,
          p.nome,
          p.descricao || null,
          Math.round(Number(p.preco) * 100),
          p.imagem || null,
          f.destaque,
          f.novidade
        );
        const vars = Array.isArray(p.variacoes) && p.variacoes.length ? p.variacoes : [{ cor: 'Modelo unico', imagem: p.imagem }];
        for (const v of vars) {
          const nomeCor = v.cor || 'Modelo unico';
          const info = insertVar.run(p.id, nomeCor, v.imagem || p.imagem || null);
          const anterior = estoqueAntigo[p.id + '|' + nomeCor] || { disponivel: 0, reservada: 0 };
          insertStock.run(info.lastInsertRowid, anterior.disponivel, anterior.reservada);
        }
      }
    });
    res.json({ ok: true, total: arr.length });
  } catch (e) {
    res.status(400).json({ ok: false, erro: e.message });
  }
});

module.exports = router;
module.exports.produtoParaApi = produtoParaApi;