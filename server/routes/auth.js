const express = require('express');
const { z } = require('zod');
const { db, transaction } = require('../db');
const auth = require('../middleware/auth');
const { rateLimit } = require('../middleware/ratelimit');
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });

const router = express.Router();

const cadastroSchema = z.object({
  nome: z.string().trim().min(2, 'Nome muito curto'),
  telefone: z.string().trim().min(8, 'Telefone invalido'),
  email: z.string().trim().toLowerCase().email('E-mail invalido'),
  senha: z.string().min(6, 'Senha deve ter ao menos 6 caracteres')
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail invalido'),
  senha: z.string().min(1, 'Senha obrigatoria')
});

function formatZod(err) {
  return (err.issues || []).map((i) => i.message).join('; ') || 'Dados invalidos';
}

router.post('/api/auth/cadastro', authLimiter, (req, res) => {
  let data;
  try { data = cadastroSchema.parse(req.body); }
  catch (e) { return res.status(400).json({ erro: formatZod(e) }); }

  const existe = db.prepare('SELECT id FROM users WHERE email = ?').get(data.email);
  if (existe) return res.status(409).json({ erro: 'E-mail ja cadastrado' });

  let userId;
  try {
    transaction((db) => {
      const info = db.prepare(`INSERT INTO users (nome, telefone, email, password_hash, role) VALUES (?,?,?,?,?)`)
        .run(data.nome, data.telefone, data.email, auth.hashPassword(data.senha), 'cliente');
      userId = info.lastInsertRowid;
    });
  } catch (e) {
    return res.status(500).json({ erro: 'Falha ao criar conta' });
  }

  const sess = auth.createSession(userId);
  const user = db.prepare('SELECT id, nome, telefone, email, role FROM users WHERE id = ?').get(userId);
  auth.setSessionCookie(res, auth.criarTokenSessao(user, sess.expira, sess.id), new Date(sess.expira));
  res.status(201).json({ ok: true, usuario: user });
});

router.post('/api/auth/login', authLimiter, (req, res) => {
  let data;
  try { data = loginSchema.parse(req.body); }
  catch (e) { return res.status(400).json({ erro: formatZod(e) }); }

  const user = db.prepare('SELECT id, nome, telefone, email, role, password_hash, ativo FROM users WHERE email = ?').get(data.email);
  if (!user || !user.ativo || !auth.verifyPassword(data.senha, user.password_hash)) {
    return res.status(401).json({ erro: 'E-mail ou senha incorretos' });
  }
  const sess = auth.createSession(user.id);
  auth.setSessionCookie(res, auth.criarTokenSessao(user, sess.expira, sess.id), new Date(sess.expira));
  res.json({ ok: true, usuario: { id: user.id, nome: user.nome, telefone: user.telefone, email: user.email, role: user.role } });
});

router.post('/api/auth/logout', (req, res) => {
  const usuario = auth.getSessionUser(req);
  auth.destroySession(usuario && usuario.sid);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/api/auth/me', (req, res) => {
  const user = auth.getSessionUser(req);
  if (!user) return res.json({ usuario: null });
  res.json({ usuario: user });
});

module.exports = router;