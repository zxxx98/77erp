import { hasPermission } from '../shared/permissions.js';

export function installProductHistory(app, db) {
  db.exec(`CREATE INDEX IF NOT EXISTS order_items_product_order ON order_items(product_id,order_id);
    CREATE INDEX IF NOT EXISTS stock_adjustments_product_time ON stock_adjustments(product_id,created_at DESC,id DESC);`);
  app.get('/api/products/:id/history', (req, res) => {
    const product = db.prepare('SELECT id FROM products WHERE id=? AND warehouse_id=?').get(req.params.id, req.warehouse.id);
    if (!product) return res.status(404).json({ error: '物料不存在。' });
    const raw = req.query.offset ?? '0';
    if (typeof raw !== 'string' || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
      return res.status(400).json({ error: '记录分页参数无效。' });
    const offset = Number(raw), limit = 20;
    // This view exposes quantities and business context, without financial fields.
    // Stock adjustments retain the same permission boundary as /stocktakes.
    const rows = db.prepare(`SELECT * FROM (
      SELECT 'order' AS event,i.id AS event_id,o.id AS order_id,o.number,o.type,o.kind,o.status,
        o.created_at,o.partner,o.note,o.created_by_name AS operator,
        i.quantity,CASE WHEN o.stock_applied=0 THEN NULL WHEN o.type='in' THEN i.quantity ELSE -i.quantity END AS delta,
        NULL AS before_stock,NULL AS after_stock
      FROM order_items i JOIN orders o ON o.id=i.order_id
      WHERE i.product_id=? AND o.warehouse_id=?
      UNION ALL
      SELECT 'void',i.id,o.id,o.number,o.type,o.kind,o.status,
        o.voided_at,o.partner,o.void_reason,'',i.quantity,
        CASE WHEN o.stock_applied=0 THEN NULL WHEN o.type='in' THEN -i.quantity ELSE i.quantity END,NULL,NULL
      FROM order_items i JOIN orders o ON o.id=i.order_id
      WHERE i.product_id=? AND o.warehouse_id=? AND o.status='void'
      UNION ALL
      SELECT a.kind,a.id,NULL,'','','','',a.created_at,'',a.reason,'',
        NULL,ROUND(a.after_stock-a.before_stock,6),a.before_stock,a.after_stock
      FROM stock_adjustments a JOIN products p ON p.id=a.product_id
      WHERE a.product_id=? AND p.warehouse_id=? AND ?
    ) ORDER BY created_at DESC,event_id DESC,event DESC LIMIT ? OFFSET ?`)
      .all(product.id, req.warehouse.id, product.id, req.warehouse.id,
        product.id, req.warehouse.id, Number(hasPermission(req.user, 'stocktake')), limit + 1, offset);
    res.json({ records: rows.slice(0, limit), has_more: rows.length > limit });
  });
}
