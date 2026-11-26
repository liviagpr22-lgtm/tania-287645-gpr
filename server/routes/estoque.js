const express = require('express');
const { db, transaction } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { notificarCatalogo } = require('../eventos');

const router = express.Router();

// Publico: disponibilidade agregada por produto (soma das variacoes)
router.get('/api/estoque', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT pv.product_id AS product_id, COALESCE(SUM(sb.disponivel),0) AS disponivel
      FROM product_variants pv LEFT JOIN stock_balances sb ON sb.variant_id = pv.id
      WHERE pv.arquivado = 0 GROUP BY pv.product_id`).all();
    const map = {};
    for (const r of rows) map[r.product_id] = r.disponivel;
    res.json(map);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// Admin: lista detalhada
router.get('/api/admin/estoque', requireAdmin, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT pv.id AS variant_id, pv.product_id, p.nome AS produto, pv.nome_cor AS cor,
             COALESCE(sb.disponivel,0) AS disponivel, COALESCE(sb.reservada,0) AS reservada
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN stock_balances sb ON sb.variant_id = pv.id
      WHERE pv.arquivado = 0 AND p.arquivado = 0
      ORDER BY p.id, pv.id`).all();
    res.json(rows);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// Admin: definir disponivel para uma variacao
router.put('/api/admin/estoque/:variantId', requireAdmin, (req, res) => {
  const vid = Number(req.params.variantId);
  const { disponivel } = req.body || {};
  if (!Number.isInteger(Number(disponivel)) || Number(disponivel) < 0) {
    return res.status(400).json({ erro: 'Quantidade invalida' });
  }
  try {
    transaction((db) => {
      const v = db.prepare('SELECT id FROM product_variants WHERE id = ?').get(vid);
      if (!v) throw new Error('Variacao nao encontrada');
      const antigo = db.prepare('SELECT disponivel FROM stock_balances WHERE variant_id = ?').get(vid);
      const anterior = antigo ? antigo.disponivel : 0;
      const novo = Number(disponivel);
      db.prepare(`INSERT INTO stock_balances (variant_id, disponivel, reservada) VALUES (?,?,0)
        ON CONFLICT(variant_id) DO UPDATE SET disponivel = excluded.disponivel, atualizado_em = datetime('now')`)
        .run(vid, novo);
      db.prepare('INSERT INTO stock_movements (variant_id, delta_disponivel, motivo) VALUES (?,?,?)')
        .run(vid, novo - anterior, 'ajuste manual');
    });
    notificarCatalogo('estoque');
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

module.exports = router;