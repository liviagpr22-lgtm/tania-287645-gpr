const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

function codigoValido(v) { return String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, ''); }
function paraApi(c) {
  return { id: c.id, nome: c.nome, codigo: c.codigo, valor: c.valor_centavos / 100, validade: c.validade, ativo: !!c.ativo, criado_em: c.criado_em };
}

router.get('/api/admin/cupons', requireAdmin, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM cupons ORDER BY id DESC').all();
    res.json(rows.map(paraApi));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/api/admin/cupons', requireAdmin, (req, res) => {
  const b = req.body || {};
  const nome = String(b.nome == null ? '' : b.nome).trim();
  const codigo = codigoValido(b.codigo);
  const valorCentavos = Math.round(Number(String(b.valor == null ? '' : b.valor).replace(',', '.')) * 100);
  const validade = String(b.validade == null ? '' : b.validade).trim() || null;
  if (!nome) return res.status(400).json({ erro: 'Informe o nome do cupom.' });
  if (!codigo) return res.status(400).json({ erro: 'Informe o código do cupom.' });
  if (!Number.isFinite(valorCentavos) || valorCentavos <= 0) return res.status(400).json({ erro: 'Informe um valor de desconto maior que zero.' });
  if (db.prepare('SELECT id FROM cupons WHERE codigo = ?').get(codigo)) return res.status(409).json({ erro: 'Esse código já existe.' });
  try {
    db.prepare('INSERT INTO cupons (nome, codigo, valor_centavos, validade) VALUES (?,?,?,?)').run(nome, codigo, valorCentavos, validade);
    res.status(201).json({ ok: true });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

router.delete('/api/admin/cupons/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM cupons WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

router.post('/api/cupons/validar', (req, res) => {
  const codigo = codigoValido(req.body && req.body.codigo);
  if (!codigo) return res.status(400).json({ erro: 'Informe o código do cupom.' });
  const c = db.prepare('SELECT * FROM cupons WHERE codigo = ? AND ativo = 1').get(codigo);
  if (!c) return res.status(404).json({ erro: 'Cupom não encontrado.' });
  const hoje = new Date().toISOString().slice(0, 10);
  if (c.validade && c.validade < hoje) return res.status(410).json({ erro: 'Este cupom venceu.' });
  res.json({ ok: true, codigo: c.codigo, nome: c.nome, valor: c.valor_centavos / 100 });
});

module.exports = router;
