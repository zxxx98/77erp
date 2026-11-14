import { hasPermission } from '../shared/permissions.js';

export function installProductHistory(app, db) {
  db.exec(`CREATE INDEX IF NOT EXISTS order_items_product_order ON order_items(product_id,order_id);
    CREATE INDEX IF NOT EXISTS stock_adjustments_product_time ON stock_adjustments(product_id,created_at DESC,id DESC);`);
  app.get('/api/products/:id/history', (req, res) => {
    const product = db.prepare('SELECT id,stock FROM products WHERE id=? AND warehouse_id=?').get(req.params.id, req.warehouse.id);
    if (!product) return res.status(404).json({ error: '物料不存在。' });
    const raw = req.query.offset ?? '0';
    if (typeof raw !== 'string' || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
      return res.status(400).json({ error: '记录分页参数无效。' });
    const offset = Number(raw), limit = 20;
    // Production registration alone does not expose the cross-group inventory ledger.
    // Purchase/sale permissions intentionally retain their warehouse approval ledger visibility.
    // Price changes require finance permission; stock adjustments retain /stocktakes permissions.
    // Calculate balances over the complete ledger before permissions and pagination.
    // Prefer persisted snapshots where available; legacy opening stock comes from current stock.
    const can = permission => Number(hasPermission(req.user, permission));
    const rows = db.prepare(`WITH events AS (
      SELECT 'order' AS event,i.id AS event_id,o.id AS order_id,o.number,o.type,o.kind,o.status,
        COALESCE(o.approved_at,o.created_at) AS created_at,o.partner,o.note,CASE WHEN o.approved_at IS NOT NULL THEN o.approved_by_name ELSE o.created_by_name END AS operator,
        i.quantity,CASE WHEN o.stock_applied=0 THEN NULL WHEN o.type='in' THEN i.quantity ELSE -i.quantity END AS delta,
        NULL AS before_stock,NULL AS after_stock,
        NULL AS before_cost,NULL AS after_cost,NULL AS before_price,NULL AS after_price,NULL AS unit, o.created_by_name AS applicant
      FROM order_items i JOIN orders o ON o.id=i.order_id
      WHERE i.product_id=? AND o.warehouse_id=? AND o.status IN ('active','void')
      UNION ALL
      SELECT 'void',i.id,o.id,o.number,o.type,o.kind,o.status,
        o.voided_at,o.partner,o.void_reason,'',i.quantity,
        CASE WHEN o.stock_applied=0 THEN NULL WHEN o.type='in' THEN -i.quantity ELSE i.quantity END,NULL,NULL,NULL,NULL,NULL,NULL,NULL, o.created_by_name
      FROM order_items i JOIN orders o ON o.id=i.order_id
      WHERE i.product_id=? AND o.warehouse_id=? AND o.status='void'
      UNION ALL
      SELECT a.kind,a.id,NULL,'','','','',a.created_at,'',a.reason,'',
        NULL,ROUND(a.after_stock-a.before_stock,6),a.before_stock,a.after_stock,NULL,NULL,NULL,NULL,NULL, ''
      FROM stock_adjustments a JOIN products p ON p.id=a.product_id
      WHERE a.product_id=? AND p.warehouse_id=?
      UNION ALL
      SELECT 'price_change',c.id,NULL,'','','','',c.created_at,'','',c.created_by_name,
        NULL,NULL,NULL,NULL,c.before_cost,c.after_cost,c.before_price,c.after_price,NULL, c.created_by_name
      FROM product_changes c JOIN products p ON p.id=c.product_id
      WHERE c.product_id=? AND p.warehouse_id=?
      UNION ALL
      SELECT 'production_in',o.id,NULL,o.number,'in','production',o.status,
        o.completed_at,'',o.note,o.completed_by_name,o.completed_quantity,o.completed_quantity,NULL,NULL,NULL,NULL,NULL,NULL,o.unit, o.created_by_name
      FROM production_orders o WHERE o.product_id=? AND o.warehouse_id=? AND o.completed_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM production_batches b WHERE b.production_id=o.id)
      UNION ALL
      SELECT 'production_out',i.id,NULL,o.number,'out','production',o.status,
        o.completed_at,'',o.note,o.completed_by_name,i.actual_quantity,-i.actual_quantity,NULL,NULL,NULL,NULL,NULL,NULL,i.unit, o.created_by_name
      FROM production_items i JOIN production_orders o ON o.id=i.production_id
      WHERE i.product_id=? AND o.warehouse_id=? AND o.material_workflow=0 AND o.completed_at IS NOT NULL AND i.actual_quantity>0 AND NOT EXISTS (SELECT 1 FROM production_batches b WHERE b.production_id=o.id)
      UNION ALL
      SELECT 'production_void_out',o.id,NULL,o.number,'out','production',o.status,
        o.voided_at,'',o.void_reason,o.voided_by_name,o.completed_quantity,-o.completed_quantity,NULL,NULL,NULL,NULL,NULL,NULL,o.unit, o.created_by_name
      FROM production_orders o WHERE o.product_id=? AND o.warehouse_id=? AND o.completed_at IS NOT NULL AND o.status='void' AND NOT EXISTS (SELECT 1 FROM production_batches b WHERE b.production_id=o.id)
      UNION ALL
      SELECT 'production_void_in',i.id,NULL,o.number,'in','production',o.status,
        o.voided_at,'',o.void_reason,o.voided_by_name,i.actual_quantity,i.actual_quantity,NULL,NULL,NULL,NULL,NULL,NULL,i.unit, o.created_by_name
      FROM production_items i JOIN production_orders o ON o.id=i.production_id
      WHERE i.product_id=? AND o.warehouse_id=? AND o.material_workflow=0 AND o.completed_at IS NOT NULL AND o.status='void' AND i.actual_quantity>0 AND NOT EXISTS (SELECT 1 FROM production_batches b WHERE b.production_id=o.id)
      UNION ALL
      SELECT 'production_scrap_in',i.id,NULL,o.number,'in','production',o.status,
        o.completed_at,'',i.note,o.completed_by_name,i.actual_quantity,i.actual_quantity,NULL,NULL,NULL,NULL,NULL,NULL,i.unit, o.created_by_name
      FROM production_scraps i JOIN production_orders o ON o.id=i.production_id
      WHERE i.product_id=? AND o.warehouse_id=? AND o.completed_at IS NOT NULL AND i.actual_quantity>0 AND i.disposition='stock' AND NOT EXISTS (SELECT 1 FROM production_batches b WHERE b.production_id=o.id)
      UNION ALL
      SELECT 'production_scrap_void_out',i.id,NULL,o.number,'out','production',o.status,
        o.voided_at,'',o.void_reason,o.voided_by_name,i.actual_quantity,-i.actual_quantity,NULL,NULL,NULL,NULL,NULL,NULL,i.unit, o.created_by_name
      FROM production_scraps i JOIN production_orders o ON o.id=i.production_id
      WHERE i.product_id=? AND o.warehouse_id=? AND o.completed_at IS NOT NULL AND o.status='void' AND i.actual_quantity>0 AND i.disposition='stock' AND NOT EXISTS (SELECT 1 FROM production_batches b WHERE b.production_id=o.id)
      UNION ALL
      SELECT 'production_in','batch:' || b.id,NULL,o.number,'in','production',b.status,
        b.created_at,'','第 ' || b.batch_number || ' 批 · ' || b.note,b.created_by_name,b.completed_quantity,b.completed_quantity,NULL,NULL,NULL,NULL,NULL,NULL,o.unit, b.created_by_name
      FROM production_batches b JOIN production_orders o ON o.id=b.production_id
      WHERE o.product_id=? AND o.warehouse_id=? AND b.receipt_required=0
      UNION ALL
      SELECT 'production_out','batch:' || i.id,NULL,o.number,'out','production',b.status,
        b.created_at,'','第 ' || b.batch_number || ' 批 · ' || b.note,b.created_by_name,i.actual_quantity,-i.actual_quantity,NULL,NULL,NULL,NULL,NULL,NULL,r.unit, b.created_by_name
      FROM production_batches b JOIN production_orders o ON o.id=b.production_id JOIN production_batch_items i ON i.batch_id=b.id JOIN production_items r ON r.production_id=o.id AND r.product_id=i.product_id
      WHERE i.product_id=? AND o.warehouse_id=? AND o.material_workflow=0 AND i.actual_quantity>0
      UNION ALL
      SELECT 'production_void_out','batch:' || b.id,NULL,o.number,'out','production',b.status,
        b.voided_at,'','第 ' || b.batch_number || ' 批 · ' || b.void_reason,b.voided_by_name,b.completed_quantity,-b.completed_quantity,NULL,NULL,NULL,NULL,NULL,NULL,o.unit, b.created_by_name
      FROM production_batches b JOIN production_orders o ON o.id=b.production_id
      WHERE o.product_id=? AND o.warehouse_id=? AND b.status='void' AND b.receipt_required=0
      UNION ALL
      SELECT 'production_void_in','batch:' || i.id,NULL,o.number,'in','production',b.status,
        b.voided_at,'','第 ' || b.batch_number || ' 批 · ' || b.void_reason,b.voided_by_name,i.actual_quantity,i.actual_quantity,NULL,NULL,NULL,NULL,NULL,NULL,r.unit, b.created_by_name
      FROM production_batches b JOIN production_orders o ON o.id=b.production_id JOIN production_batch_items i ON i.batch_id=b.id JOIN production_items r ON r.production_id=o.id AND r.product_id=i.product_id
      WHERE i.product_id=? AND o.warehouse_id=? AND o.material_workflow=0 AND b.status='void' AND i.actual_quantity>0
      UNION ALL
      SELECT 'production_scrap_in','batch:' || i.id,NULL,o.number,'in','production',b.status,
        b.created_at,'','第 ' || b.batch_number || ' 批 · ' || b.note,b.created_by_name,i.actual_quantity,i.actual_quantity,NULL,NULL,NULL,NULL,NULL,NULL,r.unit, b.created_by_name
      FROM production_batches b JOIN production_orders o ON o.id=b.production_id JOIN production_batch_scraps i ON i.batch_id=b.id JOIN production_scraps r ON r.production_id=o.id AND r.product_id=i.product_id
      WHERE i.product_id=? AND o.warehouse_id=? AND i.actual_quantity>0 AND i.disposition='stock' AND b.receipt_required=0
      UNION ALL
      SELECT 'production_scrap_void_out','batch:' || i.id,NULL,o.number,'out','production',b.status,
        b.voided_at,'','第 ' || b.batch_number || ' 批 · ' || b.void_reason,b.voided_by_name,i.actual_quantity,-i.actual_quantity,NULL,NULL,NULL,NULL,NULL,NULL,r.unit, b.created_by_name
      FROM production_batches b JOIN production_orders o ON o.id=b.production_id JOIN production_batch_scraps i ON i.batch_id=b.id JOIN production_scraps r ON r.production_id=o.id AND r.product_id=i.product_id
      WHERE i.product_id=? AND o.warehouse_id=? AND b.status='void' AND i.actual_quantity>0 AND i.disposition='stock' AND b.receipt_required=0
      UNION ALL
      SELECT CASE WHEN i.kind='product' THEN 'production_in' ELSE 'production_scrap_in' END,
        'receipt:' || i.id,NULL,d.number,'in','production',d.status,d.confirmed_at,'',d.production_number || ' · 第 ' || d.batch_number || ' 批',d.confirmed_by_name,
        i.quantity,i.quantity,NULL,NULL,NULL,NULL,NULL,NULL,i.unit, d.created_by_name
      FROM production_receipt_items i JOIN production_receipts d ON d.id=i.document_id
      WHERE i.product_id=? AND d.warehouse_id=? AND d.confirmed_at IS NOT NULL
      UNION ALL
      SELECT CASE WHEN i.kind='product' THEN 'production_void_out' ELSE 'production_scrap_void_out' END,
        'receipt:' || i.id,NULL,d.number,'out','production',d.status,d.voided_at,'',d.void_reason,d.voided_by_name,
        i.quantity,-i.quantity,NULL,NULL,NULL,NULL,NULL,NULL,i.unit, d.created_by_name
      FROM production_receipt_items i JOIN production_receipts d ON d.id=i.document_id
      WHERE i.product_id=? AND d.warehouse_id=? AND d.confirmed_at IS NOT NULL AND d.status='void'
      UNION ALL
      SELECT 'production_in','stage-receipt:' || r.id,NULL,r.number,'in','production',r.status,r.confirmed_at,'',o.number || ' · 半成品入库',r.confirmed_by_name,
        r.quantity,r.quantity,NULL,NULL,NULL,NULL,NULL,NULL,s.unit, r.created_by_name
      FROM production_stage_receipts r JOIN production_orders o ON o.id=r.production_id JOIN production_stage_batches b ON b.id=r.source_batch_id JOIN production_stages s ON s.id=b.stage_id
      WHERE s.product_id=? AND r.warehouse_id=? AND r.confirmed_at IS NOT NULL
      UNION ALL
      SELECT 'production_void_out','stage-receipt:' || r.id,NULL,r.number,'out','production',r.status,r.voided_at,'',r.void_reason,r.voided_by_name,
        r.quantity,-r.quantity,NULL,NULL,NULL,NULL,NULL,NULL,s.unit, r.created_by_name
      FROM production_stage_receipts r JOIN production_stage_batches b ON b.id=r.source_batch_id JOIN production_stages s ON s.id=b.stage_id
      WHERE s.product_id=? AND r.warehouse_id=? AND r.confirmed_at IS NOT NULL AND r.status='void'
      UNION ALL
      SELECT CASE WHEN d.type='out' THEN 'production_material_out' ELSE 'production_material_in' END,
        'material:' || i.id,NULL,d.number,d.type,'production',d.status,d.confirmed_at,'',d.production_number || ' · ' || d.note,d.confirmed_by_name,
        i.quantity,CASE WHEN d.type='out' THEN -i.quantity ELSE i.quantity END,NULL,NULL,NULL,NULL,NULL,NULL,i.unit, d.created_by_name
      FROM production_material_document_items i JOIN production_material_documents d ON d.id=i.document_id
      WHERE i.product_id=? AND d.warehouse_id=? AND d.status='confirmed' AND d.type='in'
      UNION ALL
      SELECT 'production_material_out','material-issue:' || i.id,NULL,s.number,'out','production','confirmed',s.confirmed_at,'',d.production_number || ' · ' || d.note,s.confirmed_by_name,
        i.quantity,-i.quantity,NULL,i.after_stock,NULL,NULL,NULL,NULL,p.unit, d.created_by_name
      FROM production_material_issue_items i JOIN production_material_issues s ON s.id=i.issue_id
      JOIN production_material_documents d ON d.id=s.document_id
      JOIN production_material_document_items p ON p.document_id=d.id AND p.product_id=i.product_id
      WHERE i.product_id=? AND d.warehouse_id=?
    ), balances AS (
      SELECT *, CASE WHEN delta IS NULL THEN NULL ELSE
        COALESCE(after_stock, ROUND(${product.stock} - COALESCE(SUM(delta) OVER (
          ORDER BY created_at DESC,event_id DESC,event DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0),6)) END AS balance
      FROM events
    ) SELECT * FROM balances WHERE CASE
      WHEN event IN ('order','void') THEN 1
      WHEN event='price_change' THEN ${can('finance')}
      WHEN event IN ('stocktake','reduce','increase') THEN ${can('stocktake')}
      WHEN event='production_material_out' THEN ${Number(hasPermission(req.user, 'production') || hasPermission(req.user, 'sale'))}
      WHEN event='production_material_in' OR event_id LIKE 'receipt:%' OR event_id LIKE 'stage-receipt:%'
        THEN ${Number(hasPermission(req.user, 'production') || hasPermission(req.user, 'purchase'))}
      ELSE ${can('production')} END
    ORDER BY created_at DESC,event_id DESC,event DESC LIMIT ? OFFSET ?`)
      .all(...Array.from({ length: 22 }, () => [product.id, req.warehouse.id]).flat(), limit + 1, offset);
    const records = rows.slice(0, limit).map(row => {
      if (row.event === 'price_change') return row;
      const { before_cost, after_cost, before_price, after_price, ...record } = row;
      return record;
    });
    res.json({ records, has_more: rows.length > limit });
  });
}
