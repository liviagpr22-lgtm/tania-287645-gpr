const express = require('express');
const { db, transaction } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { notificarCatalogo } = require('../eventos');

const router = express.Router();

// Cliente: solicitar entrada na lista de espera
router.post('/api/waitlist', requireAuth, (req, res) => {
  const { variant_id, quantidade } = req.body || {};
  const vid = Number(variant_id);
  const qtd = Number(quantidade) || 1;
  if (!vid || qtd <= 0) return res.status(400).json({ erro: 'Dados invalidos' });
  const v = db.prepare('SELECT id, product_id FROM product_variants WHERE id = ? AND arquivado = 0').get(vid);
  if (!v) return res.status(404).json({ erro: 'Variacao nao encontrada' });
  try {
    const info = db.prepare('INSERT INTO waitlist (variant_id, user_id, quantidade, status) VALUES (?,?,?,?)')
      .run(vid, req.user.id, qtd, 'aguardando');
    res.status(201).json({ ok: true, id: info.lastInsertRowid });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

// Cliente: minhas solicitacoes
router.get('/api/waitlist', requireAuth, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT w.id, w.variant_id, w.quantidade, w.status, w.criado_em,
             p.id AS product_id, p.nome AS produto, pv.nome_cor AS cor
      FROM waitlist w
      JOIN product_variants pv ON pv.id = w.variant_id
      JOIN products p ON p.id = pv.product_id
      WHERE w.user_id = ? ORDER BY w.criado_em DESC`).all(req.user.id);
    res.json(rows);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// Admin: todas as solicitacoes
router.get('/api/admin/waitlist', requireAdmin, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT w.id, w.variant_id, w.user_id, w.quantidade, w.status, w.criado_em,
             p.id AS product_id, p.nome AS produto, pv.nome_cor AS cor,
             u.nome AS cliente, u.telefone, u.email
      FROM waitlist w
      JOIN product_variants pv ON pv.id = w.variant_id
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN users u ON u.id = w.user_id
      ORDER BY w.criado_em DESC`).all();
    res.json(rows);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// Admin: aprovar (converte em reserva se houver estoque) ou cancelar
router.put('/api/admin/waitlist/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!['aprovada', 'cancelada'].includes(status)) return res.status(400).json({ erro: 'Status invalido' });
  const w = db.prepare('SELECT * FROM waitlist WHERE id = ?').get(id);
  if (!w) return res.status(404).json({ erro: 'Solicitacao nao encontrada' });
  if (w.status !== 'aguardando') return res.status(400).json({ erro: 'Solicitacao ja processada' });

  if (status === 'cancelada') {
    db.prepare('UPDATE waitlist SET status = ? WHERE id = ?').run('cancelada', id);
    notificarCatalogo('lista-de-espera');
    return res.json({ ok: true });
  }

  // aprovar: tenta reservar estoque
  try {
    let orderId, codigo;
    transaction((db) => {
      const sb = db.prepare('SELECT disponivel FROM stock_balances WHERE variant_id = ?').get(w.variant_id);
      const disponivel = sb ? sb.disponivel : 0;
      if (disponivel < w.quantidade) throw new Error('Estoque insuficiente para aprovar');

      // reserva estoque
      db.prepare(`INSERT INTO stock_balances (variant_id, disponivel, reservada) VALUES (?,?,0)
        ON CONFLICT(variant_id) DO UPDATE SET disponivel = disponivel - ?, reservada = reservada + ?, atualizado_em = datetime('now')`)
        .run(w.variant_id, disponivel, w.quantidade, w.quantidade);
      db.prepare('INSERT INTO stock_movements (variant_id, delta_disponivel, delta_reservada, motivo) VALUES (?,?,?,?)')
        .run(w.variant_id, -w.quantidade, w.quantidade, 'aprovacao lista de espera');

      const variant = db.prepare('SELECT product_id FROM product_variants WHERE id = ?').get(w.variant_id);
      const prod = db.prepare('SELECT preco_centavos FROM products WHERE id = ?').get(variant.product_id);

      codigo = 'RES-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      const info = db.prepare(`INSERT INTO orders (user_id, tipo, origem, nome_cliente, status) VALUES (?,?,?,?,?)`)
        .run(w.user_id, 'reserva', 'admin', null, 'Reservado');
      orderId = info.lastInsertRowid;
      db.prepare('UPDATE orders SET codigo = ? WHERE id = ?').run(codigo, orderId);

      const ii = db.prepare(`INSERT INTO order_items (order_id, product_id, variant_id, quantidade, preco_unitario_centavos, status) VALUES (?,?,?,?,?,?)`)
        .run(orderId, variant.product_id, w.variant_id, w.quantidade, prod.preco_centavos, 'Reservado');
      db.prepare('INSERT INTO order_status_history (order_id, order_item_id, de_status, para_status, alterado_por) VALUES (?,?,?,?,?)')
        .run(orderId, ii.lastInsertRowid, null, 'Reservado', req.user.id);

      db.prepare('UPDATE waitlist SET status = ? WHERE id = ?').run('aprovada', id);
    });
    notificarCatalogo('lista-de-espera');
    res.json({ ok: true, aprovado: true });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

module.exports = router;