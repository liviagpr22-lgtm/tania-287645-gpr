const express = require('express');
const { db, transaction } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const STATUS_VALIDOS = ['Solicitado', 'Reservado', 'Aguardando pagamento', 'Pago', 'Concluido/Entregue', 'Cancelado', 'Lista de espera'];

router.get('/api/admin/lives', requireAdmin, (req, res) => {
  try {
    const orders = db.prepare("SELECT * FROM orders WHERE origem = 'live' ORDER BY criado_em DESC").all();
    const out = orders.map((o) => {
      const items = db.prepare(`
        SELECT oi.id, oi.product_id, oi.variant_id, oi.quantidade, oi.preco_unitario_centavos, oi.observacao, oi.status,
               p.nome AS produto_nome, p.codigo, pv.nome_cor AS cor
        FROM order_items oi
        LEFT JOIN products p ON p.id = oi.product_id
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
        WHERE oi.order_id = ?`).all(o.id);
      return {
        id: o.id, codigo: o.codigo, status: o.status, cliente: o.nome_cliente, telefone: o.telefone_cliente,
        observacao_geral: o.observacao_geral, criado_em: o.criado_em,
        itens: items.map((i) => ({ id: i.id, produto: i.produto_nome, codigo: i.codigo, cor: i.cor, quantidade: i.quantidade, preco_unitario: i.preco_unitario_centavos / 100, observacao: i.observacao, status: i.status }))
      };
    });
    res.json(out);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/api/admin/lives', requireAdmin, (req, res) => {
  const { cliente_nome, telefone_cliente, product_id, variant_id, quantidade, status, observacao } = req.body || {};
  if (!cliente_nome || !String(cliente_nome).trim()) return res.status(400).json({ erro: 'Nome do cliente obrigatorio' });
  const pid = Number(product_id);
  const vid = Number(variant_id);
  const qtd = Number(quantidade) || 1;
  if (!pid || !vid || qtd <= 0) return res.status(400).json({ erro: 'Produto/variacao/quantidade invalidos' });
  const st = STATUS_VALIDOS.includes(status) ? status : 'Solicitado';
  try {
    let orderId, codigo;
    transaction((db) => {
      const prod = db.prepare('SELECT id, nome, preco_centavos FROM products WHERE id = ?').get(pid);
      if (!prod) throw new Error('Produto nao encontrado');
      const variant = db.prepare('SELECT id, nome_cor FROM product_variants WHERE id = ? AND product_id = ?').get(vid, pid);
      if (!variant) throw new Error('Variacao nao encontrada');

      codigo = 'LIVE-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
      const info = db.prepare(`INSERT INTO orders (tipo, origem, nome_cliente, telefone_cliente, observacao_geral, status) VALUES (?,?,?,?,?,?)`)
        .run('live', 'live', String(cliente_nome).trim(), telefone_cliente || null, observacao || null, st);
      orderId = info.lastInsertRowid;
      db.prepare('UPDATE orders SET codigo = ? WHERE id = ?').run(codigo, orderId);

      const ii = db.prepare(`INSERT INTO order_items (order_id, product_id, variant_id, quantidade, preco_unitario_centavos, observacao, status) VALUES (?,?,?,?,?,?,?)`)
        .run(orderId, pid, vid, qtd, prod.preco_centavos, observacao || null, st);
      db.prepare('INSERT INTO order_status_history (order_id, order_item_id, de_status, para_status, alterado_por) VALUES (?,?,?,?,?)')
        .run(orderId, ii.lastInsertRowid, null, st, req.user.id);
    });
    res.status(201).json({ ok: true, id: orderId, codigo: codigo });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

module.exports = router;