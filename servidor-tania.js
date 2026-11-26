// Servidor Tania Briet - sincroniza produtos entre todos os dispositivos
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const dir = __dirname;
const ARQUIVO_PRODUTOS = path.join(dir, 'produtos.json');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

function lerProdutos() {
  try {
    if (fs.existsSync(ARQUIVO_PRODUTOS)) {
      const arr = JSON.parse(fs.readFileSync(ARQUIVO_PRODUTOS, 'utf8'));
      if (Array.isArray(arr)) return arr;
    }
  } catch (e) { console.log('Erro ao ler produtos.json: ' + e.message); }
  return null;
}

http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
  catch (e) { urlPath = req.url.split('?')[0]; }

  // API: buscar produtos
  if (urlPath === '/api/produtos' && req.method === 'GET') {
    const arr = lerProdutos();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(arr || []));
  }

  // API: salvar produtos
  if (urlPath === '/api/produtos' && req.method === 'POST') {
    let corpo = '';
    req.on('data', parte => {
      corpo += parte;
      if (corpo.length > 50 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        const arr = JSON.parse(corpo);
        if (!Array.isArray(arr)) throw new Error('Formato invalido');
        fs.writeFileSync(ARQUIVO_PRODUTOS, JSON.stringify(arr, null, 2), 'utf8');
        console.log('Produtos salvos: ' + arr.length + ' itens');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, total: arr.length }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
    return;
  }

  // Arquivos estaticos
  if (urlPath === '/') urlPath = '/index.html';
  const full = path.join(dir, urlPath.replace(/^\/+/, ''));
  if (!full.startsWith(dir)) { res.writeHead(403); return res.end('Acesso negado'); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Arquivo nao encontrado: ' + urlPath); }
    res.writeHead(200, {
      'Content-Type': types[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': urlPath.endsWith('.html') ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(data);
  });
}).listen(8080, '0.0.0.0', () => {
  console.log('SERVIDOR ATIVO na porta 8080');
  console.log('Pasta: ' + dir);
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach(nome => {
    (nets[nome] || []).forEach(n => {
      if (n.family === 'IPv4' && !n.internal) console.log('  http://' + n.address + ':8080');
    });
  });
});
