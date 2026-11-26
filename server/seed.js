const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db, transaction } = require('./db');

const PROJECT_DIR = path.join(__dirname, '..');
const PRODUTOS_JSON = path.join(PROJECT_DIR, 'produtos.json');

const DESTAQUES = new Set([1, 2, 3, 7, 14, 77, 9, 12]);
const NOVIDADES = new Set([77, 1, 2, 7, 14]);

const CATEGORIAS_PRODUTO = ['braceletes', 'colares', 'pulseiras', 'brincos', 'tornozeleiras', 'cabelo', 'roupas', 'chinelo', 'maquiagem', 'presentes'];
const NOMES_CATEGORIA = {
  braceletes: 'Braceletes',
  colares: 'Colares',
  pulseiras: 'Pulseiras',
  brincos: 'Brincos',
  tornozeleiras: 'Tornozeleiras',
  cabelo: 'Acessorios para Cabelo',
  roupas: 'Moda e Vestuario',
  chinelo: 'Chinelos',
  maquiagem: 'Maquiagem e Beleza',
  presentes: 'Presentes',
  bijuterias: 'Bijuterias e Acessorios'
};

function garantirAdmin() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const senha = process.env.ADMIN_PASSWORD || '';
  if (!email || !senha) return;
  const existe = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existe) return;
  db.prepare('INSERT INTO users (nome, telefone, email, password_hash, role, ativo) VALUES (?,?,?,?,?,1)')
    .run('Tania Briet', null, email, bcrypt.hashSync(senha, 12), 'admin');
  console.log('Administrador criado pelo ambiente.');
}

function run() {
  garantirAdmin();
  const total = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  if (total > 0) {
    console.log('Seed ignorado: ' + total + ' produtos ja existem.');
    return;
  }

  const raw = JSON.parse(fs.readFileSync(PRODUTOS_JSON, 'utf8'));
  if (!Array.isArray(raw) || !raw.length) throw new Error('produtos.json invalido');

  transaction((db) => {
    const insertCat = db.prepare('INSERT OR IGNORE INTO categories (id, slug, nome, parent_id, ordem) VALUES (?,?,?,?,?)');
    insertCat.run(100, 'bijuterias', NOMES_CATEGORIA.bijuterias, null, 0);
    let ordem = 1;
    for (const slug of CATEGORIAS_PRODUTO) {
      const parent = ['braceletes', 'colares', 'pulseiras', 'brincos', 'tornozeleiras'].includes(slug) ? 100 : null;
      insertCat.run(null, slug, NOMES_CATEGORIA[slug], parent, ordem++);
    }
    const catIdBySlug = {};
    for (const r of db.prepare('SELECT id, slug FROM categories').all()) catIdBySlug[r.slug] = r.id;

    const insertProd = db.prepare(`INSERT INTO products (id, codigo, category_id, nome, descricao, preco_centavos, imagem_url, destaque, novidade)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    const insertVar = db.prepare(`INSERT INTO product_variants (product_id, nome_cor, imagem_url) VALUES (?,?,?)`);
    const insertStock = db.prepare(`INSERT OR IGNORE INTO stock_balances (variant_id, disponivel, reservada) VALUES (?,?,?)`);

    for (const p of raw) {
      insertProd.run(
        p.id,
        'P' + String(p.id).padStart(4, '0'),
        catIdBySlug[p.categoria] || null,
        p.nome,
        p.descricao || null,
        Math.round(Number(p.preco) * 100),
        p.imagem || null,
        DESTAQUES.has(p.id) ? 1 : 0,
        NOVIDADES.has(p.id) ? 1 : 0
      );
      const vars = Array.isArray(p.variacoes) && p.variacoes.length ? p.variacoes : [{ cor: 'Modelo unico', imagem: p.imagem }];
      for (const v of vars) {
        const info = insertVar.run(p.id, v.cor || 'Modelo unico', v.imagem || p.imagem || null);
        insertStock.run(info.lastInsertRowid, 0, 0);
      }
    }
  });

  const nProd = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  const nVar = db.prepare('SELECT COUNT(*) AS c FROM product_variants').get().c;
  console.log('Seed concluido: ' + nProd + ' produtos, ' + nVar + ' variacoes.');
}

if (require.main === module) run();
module.exports = { run };