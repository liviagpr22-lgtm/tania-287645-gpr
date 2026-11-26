const express = require('express');
const crypto = require('crypto');
const { db, transaction } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { notificarCatalogo } = require('../eventos');

const router = express.Router();

const STATUS_VALIDOS = ['Solicitado', 'Reservado', 'Aguardando pagamento', 'Pago', 'Concluido/Entregue', 'Cancelado', 'Lista de espera'];

function gerarCodigo() {
  return 'PED-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

// Cliente: criar pedido
router.post('/api/pedidos', requireAuth, (req, res) => {
  const { itens, observacao_geral, tipo, idempotency_key } = req.body || {};
  if (!Array.isArray(itens) || !itens.length) return res.status(400).json({ erro: 'Pedido sem itens' });

  // idempotencia
  if (idempotency_key) {
    const existente = db.prepare('SELECT id, codigo FROM orders WHERE idempotency_key = ?').get(idempotency_key);
    if (existente) return res.json({ ok: true, id: existente.id, codigo: existente.codigo, duplicado: true });
  }

  try {
    let orderId, codigo;
    transaction((db) => {
      // valida e reserva estoque
      const itensPreparados = [];
      for (const it of itens) {
        const pid = Number(it.product_id);
        const vid = Number(it.variant_id);
        const qtd = Number(it.quantidade);
        if (!pid || !vid || !qtd || qtd <= 0) throw new Error('Item invalido');

        const prod = db.prepare('SELECT id, nome, preco_centavos FROM products WHERE id = ? AND arquivado = 0').get(pid);
        if (!prod) throw new Error('Produto nao encontrado: ' + pid);
        const variant = db.prepare('SELECT id, nome_cor FROM product_variants WHERE id = ? AND product_id = ? AND arquivado = 0').get(vid, pid);
        if (!variant) throw new Error('Variacao nao encontrada');

        const sb = db.prepare('SELECT disponivel FROM stock_balances WHERE variant_id = ?').get(vid);
        const disponivel = sb ? sb.disponivel : 0;
        let statusItem;
        if (disponivel >= qtd) {
          statusItem = 'Reservado';
          // reserva
          db.prepare(`INSERT INTO stock_balances (variant_id, disponivel, reservada) VALUES (?,?,0)
            ON CONFLICT(variant_id) DO UPDATE SET disponivel = disponivel - ?, reservada = reservada + ?, atualizado_em = datetime('now')`)
            .run(vid, disponivel, qtd, qtd);
        } else {
          statusItem = 'Lista de espera';
        }
        itensPreparados.push({ pid, vid, qtd, preco: prod.preco_centavos, obs: it.observacao || null, status: statusItem });
      }

      codigo = gerarCodigo();
      const info = db.prepare(`INSERT INTO orders (user_id, tipo, origem, nome_cliente, telefone_cliente, observacao_geral, status, idempotency_key)
        VALUES (?,?,?,?,?,?,?,?)`)
        .run(req.user.id, tipo || 'pedido', 'site', req.user.nome, req.user.telefone, observacao_geral || null, 'Reservado', idempotency_key || null);
      orderId = info.lastInsertRowid;
      db.prepare('UPDATE orders SET codigo = ? WHERE id = ?').run(codigo, orderId);

      const insertItem = db.prepare(`INSERT INTO order_items (order_id, product_id, variant_id, quantidade, preco_unitario_centavos, observacao, status) VALUES (?,?,?,?,?,?,?)`);
      for (const it of itensPreparados) {
        const ii = insertItem.run(orderId, it.pid, it.vid, it.qtd, it.preco, it.obs, it.status);
        if (it.status === 'Reservado') {
          db.prepare('INSERT INTO stock_movements (variant_id, order_item_id, delta_disponivel, delta_reservada, motivo) VALUES (?,?,?,?,?)')
            .run(it.vid, ii.lastInsertRowid, -it.qtd, it.qtd, 'reserva pedido');
        }
        db.prepare('INSERT INTO order_status_history (order_id, order_item_id, de_status, para_status, alterado_por) VALUES (?,?,?,?,?)')
          .run(orderId, ii.lastInsertRowid, null, it.status, req.user.id);
      }
    });
    res.status(201).json({ ok: true, id: orderId, codigo: codigo });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// Cliente: meus pedidos
router.get('/api/pedidos', requireAuth, (req, res) => {
  try {
    const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY criado_em DESC').all(req.user.id);
    const out = orders.map((o) => {
      const items = db.prepare(`
        SELECT oi.id, oi.product_id, oi.variant_id, oi.quantidade, oi.preco_unitario_centavos, oi.observacao, oi.status, oi.criado_em,
               p.nome AS produto_nome, pv.nome_cor AS cor
        FROM order_items oi
        LEFT JOIN products p ON p.id = oi.product_id
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
        WHERE oi.order_id = ?`).all(o.id);
      return {
        id: o.id, codigo: o.codigo, tipo: o.tipo, status: o.status, observacao_geral: o.observacao_geral,
        criado_em: o.criado_em, atualizado_em: o.atualizado_em,
        itens: items.map((i) => ({
          id: i.id, produto: i.produto_nome, cor: i.cor, quantidade: i.quantidade,
          preco_unitario: i.preco_unitario_centavos / 100, observacao: i.observacao, status: i.status, criado_em: i.criado_em
        }))
      };
    });
    res.json(out);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// Admin: todos os pedidos
router.get('/api/admin/pedidos', requireAdmin, (req, res) => {
  try {
    const { status, q, de, ate } = req.query || {};
    let sql = 'SELECT * FROM orders WHERE 1=1';
    const params = [];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (de) { sql += ' AND criado_em >= ?'; params.push(de); }
    if (ate) { sql += ' AND criado_em <= ?'; params.push(ate + ' 23:59:59'); }
    if (q) { sql += ' AND (codigo LIKE ? OR nome_cliente LIKE ? OR telefone_cliente LIKE ?)'; params.push('%'+q+'%','%'+q+'%','%'+q+'%'); }
    sql += ' ORDER BY criado_em DESC';
    const orders = db.prepare(sql).all(...params);
    const out = orders.map((o) => {
      const items = db.prepare(`
        SELECT oi.id, oi.product_id, oi.variant_id, oi.quantidade, oi.preco_unitario_centavos, oi.observacao, oi.status, oi.criado_em,
               p.nome AS produto_nome, pv.nome_cor AS cor
        FROM order_items oi
        LEFT JOIN products p ON p.id = oi.product_id
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
        WHERE oi.order_id = ?`).all(o.id);
      let cliente = o.nome_cliente;
      let email = null;
      if (o.user_id) {
        const u = db.prepare('SELECT nome, email FROM users WHERE id = ?').get(o.user_id);
        if (u) { cliente = u.nome; email = u.email; }
      }
      return {
        id: o.id, codigo: o.codigo, tipo: o.tipo, origem: o.origem, status: o.status,
        cliente: cliente, telefone: o.telefone_cliente, email: email, observacao_geral: o.observacao_geral,
        criado_em: o.criado_em, atualizado_em: o.atualizado_em,
        itens: items.map((i) => ({
          id: i.id, produto: i.produto_nome, cor: i.cor, quantidade: i.quantidade,
          preco_unitario: i.preco_unitario_centavos / 100, observacao: i.observacao, status: i.status
        }))
      };
    });
    res.json(out);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// Admin: atualizar status de um item
router.put('/api/admin/pedidos/:orderId/itens/:itemId/status', requireAdmin, (req, res) => {
  const orderId = Number(req.params.orderId);
  const itemId = Number(req.params.itemId);
  const { status } = req.body || {};
  if (!STATUS_VALIDOS.includes(status)) return res.status(400).json({ erro: 'Status invalido' });
  try {
    transaction((db) => {
      const item = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(itemId, orderId);
      if (!item) throw new Error('Item nao encontrado');
      const de = item.status;
      // se cancelando, devolve estoque (se estava reservado/aguardando)
      if (status === 'Cancelado' && (de === 'Reservado' || de === 'Aguardando pagamento' || de === 'Solicitado')) {
        db.prepare(`INSERT INTO stock_balances (variant_id, disponivel, reservada) VALUES (?,?,0)
          ON CONFLICT(variant_id) DO UPDATE SET disponivel = disponivel + ?, reservada = CASE WHEN reservada >= ? THEN reservada - ? ELSE 0 END, atualizado_em = datetime('now')`)
          .run(item.variant_id, 0, item.quantidade, item.quantidade, item.quantidade);
        db.prepare('INSERT INTO stock_movements (variant_id, order_item_id, delta_disponivel, delta_reservada, motivo) VALUES (?,?,?,?,?)')
          .run(item.variant_id, itemId, item.quantidade, -item.quantidade, 'cancelamento');
      }
      db.prepare('UPDATE order_items SET status = ? WHERE id = ?').run(status, itemId);
      db.prepare('INSERT INTO order_status_history (order_id, order_item_id, de_status, para_status, alterado_por) VALUES (?,?,?,?,?)')
        .run(orderId, itemId, de, status, req.user.id);
      // atualiza status do pedido (derivado)
      const items = db.prepare('SELECT status FROM order_items WHERE order_id = ?').all(orderId);
      const statuses = items.map((i) => i.status);
      let orderStatus = status;
      if (statuses.every((s) => s === 'Cancelado')) orderStatus = 'Cancelado';
      else if (statuses.every((s) => s === 'Concluido/Entregue' || s === 'Cancelado')) orderStatus = 'Concluido/Entregue';
      else if (statuses.some((s) => s === 'Pago')) orderStatus = 'Pago';
      else if (statuses.some((s) => s === 'Aguardando pagamento')) orderStatus = 'Aguardando pagamento';
      else if (statuses.some((s) => s === 'Reservado')) orderStatus = 'Reservado';
      else if (statuses.some((s) => s === 'Lista de espera')) orderStatus = 'Lista de espera';
      else orderStatus = 'Solicitado';
      db.prepare('UPDATE orders SET status = ?, atualizado_em = datetime(\'now\') WHERE id = ?').run(orderStatus, orderId);
    });
    notificarCatalogo('pedidos');
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

// Admin: cancelar pedido inteiro
router.post('/api/admin/pedidos/:orderId/cancelar', requireAdmin, (req, res) => {
  const orderId = Number(req.params.orderId);
  try {
    transaction((db) => {
      const items = db.prepare('SELECT id, variant_id, quantidade, status FROM order_items WHERE order_id = ?').all(orderId);
      for (const it of items) {
        if (it.status === 'Reservado' || it.status === 'Aguardando pagamento' || it.status === 'Solicitado') {
          db.prepare(`INSERT INTO stock_balances (variant_id, disponivel, reservada) VALUES (?,?,0)
            ON CONFLICT(variant_id) DO UPDATE SET disponivel = disponivel + ?, reservada = CASE WHEN reservada >= ? THEN reservada - ? ELSE 0 END, atualizado_em = datetime('now')`)
            .run(it.variant_id, 0, it.quantidade, it.quantidade, it.quantidade);
          db.prepare('INSERT INTO stock_movements (variant_id, order_item_id, delta_disponivel, delta_reservada, motivo) VALUES (?,?,?,?,?)')
            .run(it.variant_id, it.id, it.quantidade, -it.quantidade, 'cancelamento pedido');
        }
        db.prepare('UPDATE order_items SET status = ? WHERE id = ?').run('Cancelado', it.id);
        db.prepare('INSERT INTO order_status_history (order_id, order_item_id, de_status, para_status, alterado_por) VALUES (?,?,?,?,?)')
          .run(orderId, it.id, it.status, 'Cancelado', req.user.id);
      }
      db.prepare('UPDATE orders SET status = ?, atualizado_em = datetime(\'now\') WHERE id = ?').run('Cancelado', orderId);
    });
    notificarCatalogo('pedidos');
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});


// Admin: excluir pedido definitivamente (devolve estoque reservado)
router.delete('/api/admin/pedidos/:orderId', requireAdmin, (req, res) => {
  const orderId = Number(req.params.orderId);
  try {
    transaction((db) => {
      const pedido = db.prepare('SELECT id FROM orders WHERE id = ?').get(orderId);
      if (!pedido) throw new Error('Pedido nao encontrado');
      const itens = db.prepare('SELECT id, variant_id, quantidade, status FROM order_items WHERE order_id = ?').all(orderId);
      const itensIds = itens.map((it) => it.id);
      for (const it of itens) {
        if (it.status === 'Reservado' || it.status === 'Aguardando pagamento' || it.status === 'Solicitado') {
          db.prepare(`INSERT INTO stock_balances (variant_id, disponivel, reservada) VALUES (?,?,0)
            ON CONFLICT(variant_id) DO UPDATE SET disponivel = disponivel + ?, reservada = CASE WHEN reservada >= ? THEN reservada - ? ELSE 0 END, atualizado_em = datetime('now')`)
            .run(it.variant_id, 0, it.quantidade, it.quantidade, it.quantidade);
        }
      }
      if (itensIds.length) {
        const marks = itensIds.map(() => '?').join(',');
        db.prepare('DELETE FROM stock_movements WHERE order_item_id IN (' + marks + ')').run(...itensIds);
        db.prepare('DELETE FROM order_status_history WHERE order_item_id IN (' + marks + ')').run(...itensIds);
        db.prepare('DELETE FROM order_items WHERE id IN (' + marks + ')').run(...itensIds);
      }
      db.prepare('DELETE FROM order_status_history WHERE order_id = ?').run(orderId);
      db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
    });
    notificarCatalogo('pedidos');
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});


// Cliente: detalhe de um pedido proprio
router.get('/api/pedidos/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const o = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!o) return res.status(404).json({ erro: 'Pedido nao encontrado' });
  const items = db.prepare(`
    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantidade, oi.preco_unitario_centavos, oi.observacao, oi.status, oi.criado_em,
           p.nome AS produto_nome, pv.nome_cor AS cor
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN product_variants pv ON pv.id = oi.variant_id
    WHERE oi.order_id = ?`).all(o.id);
  const hist = db.prepare('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY criado_em ASC').all(o.id);
  res.json({
    id: o.id, codigo: o.codigo, tipo: o.tipo, status: o.status, observacao_geral: o.observacao_geral,
    criado_em: o.criado_em, atualizado_em: o.atualizado_em,
    itens: items.map((i) => ({ id: i.id, produto: i.produto_nome, cor: i.cor, quantidade: i.quantidade, preco_unitario: i.preco_unitario_centavos / 100, observacao: i.observacao, status: i.status, criado_em: i.criado_em })),
    historico: hist
  });
});

// Admin: detalhe de um pedido
router.get('/api/admin/pedidos/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) return res.status(404).json({ erro: 'Pedido nao encontrado' });
  const items = db.prepare(`
    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantidade, oi.preco_unitario_centavos, oi.observacao, oi.status, oi.criado_em,
           p.nome AS produto_nome, pv.nome_cor AS cor
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN product_variants pv ON pv.id = oi.variant_id
    WHERE oi.order_id = ?`).all(o.id);
  const hist = db.prepare('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY criado_em ASC').all(o.id);
  res.json({
    id: o.id, codigo: o.codigo, tipo: o.tipo, origem: o.origem, status: o.status,
    cliente: o.nome_cliente, telefone: o.telefone_cliente, observacao_geral: o.observacao_geral,
    criado_em: o.criado_em, atualizado_em: o.atualizado_em,
    itens: items.map((i) => ({ id: i.id, produto: i.produto_nome, cor: i.cor, quantidade: i.quantidade, preco_unitario: i.preco_unitario_centavos / 100, observacao: i.observacao, status: i.status, criado_em: i.criado_em })),
    historico: hist
  });
});

module.exports = router;