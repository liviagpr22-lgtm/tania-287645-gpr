const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, transaction } = require('../db');

const COOKIE_NAME = 'tania_session';
const SESSION_DAYS = 7;

function hashPassword(senha) {
  return bcrypt.hashSync(senha, 12);
}

function verifyPassword(senha, hash) {
  if (!hash) return false;
  return bcrypt.compareSync(senha, hash);
}

function createSession(userId) {
  const id = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, expira_em) VALUES (?,?,?)').run(id, userId, expira);
  return { id, expira };
}

function destroySession(id) {
  if (!id) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

function getSessionUser(req) {
  const id = req.cookies && req.cookies[COOKIE_NAME];
  if (!id) return null;
  const row = db.prepare(`SELECT s.id AS sid, s.expira_em, u.id, u.nome, u.telefone, u.email, u.role, u.ativo
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(id);
  if (!row) return null;
  if (new Date(row.expira_em) < new Date()) { destroySession(id); return null; }
  if (!row.ativo) { destroySession(id); return null; }
  return { sid: row.sid, id: row.id, nome: row.nome, telefone: row.telefone, email: row.email, role: row.role };
}

function setSessionCookie(res, id, expira) {
  res.cookie(COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: new Date(expira),
    path: '/'
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ erro: 'Nao autenticado' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ erro: 'Nao autenticado' });
  if (user.role !== 'admin') return res.status(403).json({ erro: 'Acesso negado' });
  req.user = user;
  next();
}

module.exports = {
  COOKIE_NAME, hashPassword, verifyPassword, createSession, destroySession,
  getSessionUser, setSessionCookie, clearSessionCookie, requireAuth, requireAdmin
};