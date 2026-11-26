const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const PUBLIC = path.join(RAIZ, 'public');
const BANCO_INICIAL = path.join(RAIZ, 'data', 'tania-inicial.db');
const ARQUIVO_DB = path.join(__dirname, 'functions', 'db-inicial.js');

// Copia apenas os arquivos que o navegador precisa.
fs.rmSync(PUBLIC, { recursive: true, force: true });
fs.mkdirSync(PUBLIC, { recursive: true });

const arquivos = fs.readdirSync(RAIZ).filter((nome) => {
  const caminho = path.join(RAIZ, nome);
  if (!fs.statSync(caminho).isFile()) return false;
  if (/\.(html|css)$/.test(nome)) return true;
  return ['script.js', 'admin.js', 'dados-snapshot.js', 'produtos.json'].includes(nome);
});
for (const nome of arquivos) fs.copyFileSync(path.join(RAIZ, nome), path.join(PUBLIC, nome));

const imagens = path.join(RAIZ, 'Produtos_imagens');
if (fs.existsSync(imagens)) fs.cpSync(imagens, path.join(PUBLIC, 'Produtos_imagens'), { recursive: true });

// O banco sanitizado e embarcado na funcao so como fallback do primeiro acesso.
if (!fs.existsSync(BANCO_INICIAL)) throw new Error('data/tania-inicial.db nao encontrado');
const base64 = fs.readFileSync(BANCO_INICIAL).toString('base64');
fs.writeFileSync(ARQUIVO_DB, 'module.exports = ' + JSON.stringify(base64) + ';\n', 'utf8');
console.log('Publico preparado: ' + arquivos.length + ' arquivos, banco ' + Math.round(base64.length / 1024) + ' KB.');
