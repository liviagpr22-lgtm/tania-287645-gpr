const fs = require('fs');
const os = require('os');
const path = require('path');
const serverless = require('serverless-http');
const { getStore, connectLambda } = require('@netlify/blobs');

const NOME_STORE = 'tania-loja';
const CHAVE_BANCO = 'tania.db';
let bancoInicial = null;

function storeStrong(event) {
  connectLambda(event);
  return getStore({ name: NOME_STORE, consistency: 'strong' });
}

function limparCacheDoServidor() {
  const raiz = path.join(__dirname, '..', '..');
  for (const caminho of Object.keys(require.cache)) {
    if (caminho.startsWith(raiz) && !caminho.includes('node_modules')) delete require.cache[caminho];
  }
}

async function prepararBanco(event, id) {
  const tmp = path.join(os.tmpdir(), 'tania-netlify', String(id).replace(/[^a-zA-Z0-9_-]/g, ''));
  fs.mkdirSync(tmp, { recursive: true });
  const destino = path.join(tmp, 'tania.db');
  const store = storeStrong(event);
  const blob = await store.get(CHAVE_BANCO, { type: 'arrayBuffer' });
  if (blob && blob.byteLength) {
    fs.writeFileSync(destino, Buffer.from(blob));
  } else {
    if (!bancoInicial) bancoInicial = require('./db-inicial');
    fs.writeFileSync(destino, Buffer.from(bancoInicial, 'base64'));
  }
  process.env.TANIA_DB_PATH = destino;
  process.env.TANIA_SNAPSHOT_PATH = path.join(tmp, 'dados-snapshot.js');
  process.env.TANIA_SERVERLESS = '1';
  process.env.NODE_ENV = 'production';
  return { store, destino, tmp };
}

function respostaEventos() {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no'
    },
    body: 'retry: 3600000\n\nevent: pronto\ndata: {"ok":true}\n\n'
  };
}

async function respostaImagem(event) {
  const nome = decodeURIComponent(event.path.split('/').pop() || '');
  if (!nome || nome.includes('..') || nome.includes('/') || nome.includes('\\')) {
    return { statusCode: 404, body: 'Nao encontrado' };
  }
  const store = storeStrong(event);
  const dados = await store.get('uploads/' + nome, { type: 'arrayBuffer' });
  if (!dados) return { statusCode: 404, body: 'Nao encontrado' };
  const ext = path.extname(nome).toLowerCase();
  const tipo = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
  return {
    statusCode: 200,
    headers: { 'Content-Type': tipo, 'Cache-Control': 'public, max-age=31536000' },
    body: Buffer.from(dados).toString('base64'),
    isBase64Encoded: true
  };
}

exports.handler = async (event, context) => {
  const metodo = (event.httpMethod || 'GET').toUpperCase();

  // Em hospedagem serverless nao ha conexao SSE persistente. O site ja tem
  // sincronizacao por consulta periodica; esta resposta evita reconexoes.
  if (metodo === 'GET' && event.path === '/api/eventos') return respostaEventos();

  if (metodo === 'GET' && event.path.startsWith('/Produtos_imagens/uploads/')) {
    return respostaImagem(event);
  }

  const id = (context && context.awsRequestId) || Date.now().toString() + Math.random().toString(36).slice(2);
  const { store, destino, tmp } = await prepararBanco(event, id);

  let resposta;
  try {
    limparCacheDoServidor();
    const app = require('../../server');
    if (typeof app.iniciar === 'function') app.iniciar();
    const handler = serverless(app);
    resposta = await handler(event, context);
  } catch (erro) {
    console.error('Erro na funcao:', erro);
    resposta = { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ erro: 'Erro interno' }) };
  } finally {
    try {
      const moduloBanco = require('../../server/db');
      try { moduloBanco.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) {}
      try { moduloBanco.db.close(); } catch (e) {}
      await store.set(CHAVE_BANCO, fs.readFileSync(destino));
    } catch (erro) {
      console.error('Erro ao gravar banco:', erro);
      resposta = { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ erro: 'Falha ao salvar dados' }) };
    }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
  return resposta;
};
