const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db, transaction } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { notificarCatalogo } = require('../eventos');

const router = express.Router();

// Estoque por cor/modelo: ausente = preserva estoque atual; informado = substitui por ele.
function estoqueInformado(v) {
  if (!v) return null;
  const bruta = v.estoque !== undefined ? v.estoque : v.disponivel;
  if (bruta === undefined || bruta === null || bruta === '') return null;
  const n = Number(String(bruta).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}
const usaBlobs = process.env.TANIA_SERVERLESS === '1';
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'Produtos_imagens', 'uploads');
if (!usaBlobs && !fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, 'upload_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext);
  }
});
const upload = multer({
  storage: usaBlobs ? multer.memoryStorage() : storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('Arquivo nao e imagem'));
    cb(null, true);
  }
});

function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'categoria';
}

// ---------- Categorias ----------
router.get('/api/admin/categorias', requireAdmin, (req, res) => {
  try {
    const rows = db.prepare('SELECT id, slug, nome, parent_id, ordem, ativa FROM categories ORDER BY ordem, id').all();
    res.json(rows);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/api/admin/categorias', requireAdmin, (req, res) => {
  const { nome, parent_id, ordem } = req.body || {};
  if (!nome || !String(nome).trim()) return res.status(400).json({ erro: 'Nome obrigatorio' });
  const pai = Number(parent_id);
  if (!pai) return res.status(400).json({ erro: 'Escolha a categoria principal.' });
  try {
    const principal = db.prepare('SELECT id FROM categories WHERE id = ? AND ativa = 1 AND parent_id IS NULL').get(pai);
    if (!principal) return res.status(400).json({ erro: 'Categoria principal invalida.' });
    const slug = slugify(nome);
    const info = db.prepare('INSERT INTO categories (slug, nome, parent_id, ordem) VALUES (?,?,?,?)')
      .run(slug, String(nome).trim(), principal.id, Number(ordem) || 0);
    notificarCatalogo('categorias');
    res.status(201).json({ id: info.lastInsertRowid, slug, nome: String(nome).trim(), parent_id: principal.id });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

router.put('/api/admin/categorias/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { nome, parent_id, ordem, ativa } = req.body || {};
  const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(id);
  if (!cat) return res.status(404).json({ erro: 'Categoria nao encontrada' });
  const slug = nome ? slugify(nome) : undefined;
  try {
    db.prepare(`UPDATE categories SET
      nome = COALESCE(?, nome),
      slug = COALESCE(?, slug),
      parent_id = ?,
      ordem = COALESCE(?, ordem),
      ativa = COALESCE(?, ativa)
      WHERE id = ?`)
      .run(nome ? String(nome).trim() : null, slug || null,
        parent_id === undefined ? null : (parent_id || null),
        ordem === undefined ? null : Number(ordem),
        ativa === undefined ? null : (ativa ? 1 : 0), id);
    notificarCatalogo('categorias');
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

router.delete('/api/admin/categorias/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  try {
    const cat = db.prepare('SELECT id, parent_id FROM categories WHERE id = ?').get(id);
    if (!cat) return res.status(404).json({ erro: 'Categoria nao encontrada' });
    if (cat.parent_id === null) return res.status(400).json({ erro: 'Categorias principais nao podem ser arquivadas.' });
    db.prepare('UPDATE categories SET ativa = 0 WHERE id = ?').run(id);
    notificarCatalogo('categorias');
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

// ---------- Produtos ----------
router.get('/api/admin/produtos', requireAdmin, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM products ORDER BY id').all();
    const out = rows.map((p) => {
      const variants = db.prepare(`SELECT pv.id, pv.nome_cor, pv.imagem_url, pv.arquivado, COALESCE(sb.disponivel, 0) AS disponivel
        FROM product_variants pv LEFT JOIN stock_balances sb ON sb.variant_id = pv.id
        WHERE pv.product_id = ?`).all(p.id);
      const cat = p.category_id ? db.prepare('SELECT slug FROM categories WHERE id = ?').get(p.category_id) : null;
      return {
        id: p.id, codigo: p.codigo, nome: p.nome, descricao: p.descricao,
        categoria: cat ? cat.slug : '', preco: p.preco_centavos / 100,
        imagem: p.imagem_url, destaque: !!p.destaque, novidade: !!p.novidade,
        arquivado: !!p.arquivado,
        variacoes: variants.map((v) => ({ id: v.id, cor: v.nome_cor, imagem: v.imagem_url, arquivado: !!v.arquivado, estoque: v.disponivel, disponivel: v.disponivel }))
      };
    });
    res.json(out);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/api/admin/produtos', requireAdmin, (req, res) => {
  const { nome, descricao, preco, categoria, codigo, imagem, variacoes, destaque, novidade } = req.body || {};
  if (codigo && db.prepare('SELECT id FROM products WHERE codigo = ?').get(codigo)) {
    return res.status(400).json({ erro: 'Codigo do produto ja esta em uso.' });
  }
  if (!nome || !String(nome).trim()) return res.status(400).json({ erro: 'Nome obrigatorio' });
  if (!isFinite(Number(preco)) || Number(preco) <= 0) return res.status(400).json({ erro: 'Preco invalido' });
  const cat = db.prepare('SELECT id FROM categories WHERE slug = ?').get(categoria);
  try {
    let newId;
    transaction((db) => {
      const info = db.prepare(`INSERT INTO products (codigo, category_id, nome, descricao, preco_centavos, imagem_url, destaque, novidade)
        VALUES (?,?,?,?,?,?,?,?)`)
        .run(codigo || null, cat ? cat.id : null, String(nome).trim(), descricao || null,
          Math.round(Number(preco) * 100), imagem || null, destaque ? 1 : 0, novidade ? 1 : 0);
      newId = info.lastInsertRowid;
      if (!codigo) db.prepare('UPDATE products SET codigo = ? WHERE id = ?').run('P' + String(newId).padStart(4, '0'), newId);
      const vars = Array.isArray(variacoes) && variacoes.length ? variacoes : [{ cor: 'Modelo unico', imagem: imagem }];
      for (const v of vars) {
        const vi = db.prepare('INSERT INTO product_variants (product_id, nome_cor, imagem_url) VALUES (?,?,?)')
          .run(newId, v.cor || 'Modelo unico', v.imagem || imagem || null);
        const qtd = estoqueInformado(v);
        db.prepare('INSERT OR IGNORE INTO stock_balances (variant_id, disponivel, reservada) VALUES (?,?,?)').run(vi.lastInsertRowid, qtd === null ? 0 : qtd, 0);
      }
    });
    notificarCatalogo('produtos');
    res.status(201).json({ ok: true, id: newId });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

router.put('/api/admin/produtos/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const prod = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
  if (!prod) return res.status(404).json({ erro: 'Produto nao encontrado' });
  const { codigo: novoCodigo } = req.body || {};
  if (novoCodigo && db.prepare('SELECT id FROM products WHERE codigo = ? AND id <> ?').get(novoCodigo, id)) {
    return res.status(400).json({ erro: 'Codigo do produto ja esta em uso.' });
  }
  const { nome, descricao, preco, categoria, codigo, imagem, variacoes, destaque, novidade, arquivado } = req.body || {};
  const cat = categoria ? db.prepare('SELECT id FROM categories WHERE slug = ?').get(categoria) : null;
  try {
    transaction((db) => {
      db.prepare(`UPDATE products SET
        nome = COALESCE(?, nome),
        descricao = COALESCE(?, descricao),
        preco_centavos = COALESCE(?, preco_centavos),
        category_id = COALESCE(?, category_id),
        codigo = COALESCE(?, codigo),
        imagem_url = COALESCE(?, imagem_url),
        destaque = COALESCE(?, destaque),
        novidade = COALESCE(?, novidade),
        arquivado = COALESCE(?, arquivado),
        atualizado_em = datetime('now')
        WHERE id = ?`)
        .run(
          nome ? String(nome).trim() : null,
          descricao === undefined ? null : (descricao || null),
          preco === undefined ? null : Math.round(Number(preco) * 100),
          categoria ? (cat ? cat.id : null) : null,
          codigo || null,
          imagem || null,
          destaque === undefined ? null : (destaque ? 1 : 0),
          novidade === undefined ? null : (novidade ? 1 : 0),
          arquivado === undefined ? null : (arquivado ? 1 : 0),
          id
        );
      if (Array.isArray(variacoes)) {
        const existentes = db.prepare('SELECT id, nome_cor FROM product_variants WHERE product_id = ?').all(id);
        const porCor = {};
        const porId = {};
        for (const v of existentes) { porCor[v.nome_cor] = v.id; porId[v.id] = v.id; }
        const mantidos = new Set();
        for (const v of variacoes) {
          const cor = v.cor || 'Modelo unico';
          const img = v.imagem || imagem || null;
          // Preserva o estoque: prioriza o id existente; se nao houver id, usa a cor.
          const vid = (v.id && porId[v.id]) ? v.id : porCor[cor];
          const qtd = estoqueInformado(v);
          if (vid) {
            mantidos.add(vid);
            db.prepare('UPDATE product_variants SET nome_cor = ?, imagem_url = COALESCE(?, imagem_url) WHERE id = ?')
              .run(cor, img, vid);
            if (qtd !== null) {
              db.prepare('INSERT OR IGNORE INTO stock_balances (variant_id, disponivel, reservada) VALUES (?,?,?)').run(vid, qtd, 0);
              db.prepare("UPDATE stock_balances SET disponivel = ?, atualizado_em = datetime('now') WHERE variant_id = ?").run(qtd, vid);
            }
          } else {
            const vi = db.prepare('INSERT INTO product_variants (product_id, nome_cor, imagem_url) VALUES (?,?,?)')
              .run(id, cor, img);
            db.prepare('INSERT OR IGNORE INTO stock_balances (variant_id, disponivel, reservada) VALUES (?,?,?)').run(vi.lastInsertRowid, qtd === null ? 0 : qtd, 0);
            mantidos.add(Number(vi.lastInsertRowid));
          }
        }
        for (const v of existentes) {
          if (!mantidos.has(v.id)) {
            db.prepare('DELETE FROM stock_balances WHERE variant_id = ?').run(v.id);
            db.prepare('DELETE FROM product_variants WHERE id = ?').run(v.id);
          }
        }
      }
    });
    notificarCatalogo('produtos');
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

router.delete('/api/admin/produtos/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  try {
    db.prepare('UPDATE products SET arquivado = 1, atualizado_em = datetime(\'now\') WHERE id = ?').run(id);
    db.prepare('UPDATE product_variants SET arquivado = 1 WHERE product_id = ?').run(id);
    notificarCatalogo('produtos');
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

// ---------- Upload de imagem ----------
router.post('/api/admin/upload', requireAdmin, upload.single('foto'), async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Nenhuma imagem enviada' });
  if (usaBlobs) {
    try {
      const { getStore } = require('@netlify/blobs');
      const store = getStore({ name: 'tania-loja' });
      await store.set('uploads/' + req.file.filename, req.file.buffer, { metadata: { contentType: req.file.mimetype } });
    } catch (e) {
      return res.status(500).json({ erro: 'Falha ao salvar imagem: ' + e.message });
    }
  } else {
    fs.writeFileSync(path.join(UPLOAD_DIR, req.file.filename), req.file.buffer);
  }
  const url = './Produtos_imagens/uploads/' + req.file.filename;
  res.json({ ok: true, url: url });
});

// error handler do multer
router.use((err, req, res, next) => {
  if (err) return res.status(400).json({ erro: err.message || 'Erro no upload' });
  next();
});

module.exports = router;