require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { run: runSeed } = require('./server/seed');
const { router: eventosRouter, gerarSnapshot } = require('./server/eventos');

const PROJECT_DIR = __dirname;
const PORT = process.env.PORT || 8080;

function criarApp() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    const blocked = ['/data', '/server', '/.env', '/package.json', '/package-lock.json'];
    if (blocked.some((b) => req.path === b || req.path.startsWith(b + '/'))) {
      return res.status(404).end();
    }
    next();
  });

  app.use(eventosRouter);

  app.use(require('./server/routes/produtos'));
  app.use(require('./server/routes/auth'));
  app.use(require('./server/routes/admin'));
  app.use(require('./server/routes/estoque'));
  app.use(require('./server/routes/pedidos'));
  app.use(require('./server/routes/waitlist'));
  app.use(require('./server/routes/lives'));
  app.use(require('./server/routes/cupons'));

  app.use(express.static(PROJECT_DIR, { index: 'index.html' }));

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ erro: 'Nao encontrado' });
    res.sendFile(path.join(PROJECT_DIR, 'index.html'));
  });

  return app;
}

const app = criarApp();

function iniciar() {
  runSeed();
  gerarSnapshot();
  return app;
}

if (require.main === module) {
  iniciar();
  app.listen(PORT, '0.0.0.0', () => {
    console.log('SERVIDOR ATIVO na porta ' + PORT);
    console.log('Pasta: ' + PROJECT_DIR);
    console.log('Banco: ' + (process.env.TANIA_DB_PATH || path.join(PROJECT_DIR, 'data', 'tania.db')));
  });
}

module.exports = app;
module.exports.iniciar = iniciar;