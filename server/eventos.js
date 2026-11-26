const express = require('express');
const fs = require('fs');
const path = require('path');
const { db } = require('./db');
const { produtoParaApi } = require('./routes/produtos');

const clientes = new Set();

function gerarSnapshot() {
  try {
    const produtos = db.prepare('SELECT * FROM products WHERE arquivado = 0 ORDER BY id').all().map(produtoParaApi);
    const categorias = db.prepare('SELECT id, slug, nome, parent_id, ordem, ativa FROM categories WHERE ativa = 1 ORDER BY ordem, id').all();
    const conteudo = 'window.produtosSnapshot=' + JSON.stringify(produtos)
      + ';window.categoriasSnapshot=' + JSON.stringify(categorias) + ';\n';
    const caminho = process.env.TANIA_SNAPSHOT_PATH || path.join(__dirname, '..', 'dados-snapshot.js');
    fs.writeFileSync(caminho, conteudo, 'utf8');
  } catch (e) { console.error('Erro ao gerar snapshot:', e.message); }
}

function notificarCatalogo(tipo) {
  gerarSnapshot();
  const dados = JSON.stringify({ tipo: tipo || 'catalogo', t: Date.now() });
  for (const res of clientes) {
    try { res.write('event: catalogo\ndata: ' + dados + '\n\n'); }
    catch (e) { clientes.delete(res); }
  }
}

const router = express.Router();

router.get('/api/eventos', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();
  res.write('retry: 2000\n\n');
  res.write('event: pronto\ndata: {"ok":true}\n\n');
  clientes.add(res);
  const heartbeat = setInterval(function () {
    try { res.write(': keepalive\n\n'); }
    catch (e) { clearInterval(heartbeat); clientes.delete(res); }
  }, 25000);
  req.on('close', function () { clearInterval(heartbeat); clientes.delete(res); });
});

module.exports = { router, notificarCatalogo, gerarSnapshot };
