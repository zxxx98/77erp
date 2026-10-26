import { getStockExpression } from './stock-compare.js';
import { inspectionToday } from '../shared/inspection.js';

// Transactional counters let clients check for changes without reading business lists.
// Sessions, background jobs and other transient writes must not invalidate the page.
export function installDataUpdates(app, db) {
  db.exec('CREATE TABLE IF NOT EXISTS data_revisions (scope TEXT PRIMARY KEY, revision INTEGER NOT NULL)');
  const tables = {
    products: row => `'warehouse:' || ${row}.warehouse_id`,
    orders: row => `'warehouse:' || ${row}.warehouse_id`,
    categories: row => `'warehouse:' || ${row}.warehouse_id`,
    templates: row => `'warehouse:' || ${row}.warehouse_id`,
    quality_acceptances: row => `'warehouse:' || ${row}.warehouse_id`,
    quality_templates: row => `'warehouse:' || ${row}.warehouse_id`,
    quality_charts: row => `'warehouse:' || ${row}.warehouse_id`,
    process_routes: row => `'warehouse:' || ${row}.warehouse_id`,
    production_routes: row => `'warehouse:' || (SELECT warehouse_id FROM production_orders WHERE id=${row}.production_id)`,
    production_operation_reports: row => `'warehouse:' || (SELECT warehouse_id FROM production_orders WHERE id=${row}.production_id)`,
    boms: row => `'warehouse:' || ${row}.warehouse_id`,
    bom_items: row => `'warehouse:' || (SELECT warehouse_id FROM boms WHERE id=${row}.bom_id)`,
    bom_scraps: row => `'warehouse:' || (SELECT warehouse_id FROM boms WHERE id=${row}.bom_id)`,
    production_scraps: row => `'warehouse:' || (SELECT warehouse_id FROM production_orders WHERE id=${row}.production_id)`,
    production_orders: row => `'warehouse:' || ${row}.warehouse_id`,
    production_receipts: row => `'warehouse:' || ${row}.warehouse_id`,
    production_receipt_items: row => `'warehouse:' || (SELECT warehouse_id FROM production_receipts WHERE id=${row}.document_id)`,
    production_material_documents: row => `'warehouse:' || ${row}.warehouse_id`,
    production_material_document_items: row => `'warehouse:' || (SELECT warehouse_id FROM production_material_documents WHERE id=${row}.document_id)`,
    production_bom_nodes: row => `'warehouse:' || (SELECT warehouse_id FROM production_orders WHERE id=${row}.production_id)`,
    production_stages: row => `'warehouse:' || (SELECT warehouse_id FROM production_orders WHERE id=${row}.production_id)`,
    production_stage_batches: row => `'warehouse:' || (SELECT warehouse_id FROM production_orders WHERE id=${row}.production_id)`,
    production_stage_inputs: row => `'warehouse:' || (SELECT o.warehouse_id FROM production_stage_batches b JOIN production_orders o ON o.id=b.production_id WHERE b.id=${row}.batch_id)`,
    production_stage_components: row => `'warehouse:' || (SELECT o.warehouse_id FROM production_stage_batches b JOIN production_orders o ON o.id=b.production_id WHERE b.id=${row}.batch_id)`,
    production_stage_allocations: row => `'warehouse:' || (SELECT o.warehouse_id FROM production_stage_inputs i JOIN production_stage_batches b ON b.id=i.batch_id JOIN production_orders o ON o.id=b.production_id WHERE i.id=${row}.input_id)`,
    production_stage_allocation_components: row => `'warehouse:' || (SELECT o.warehouse_id FROM production_stage_allocations a JOIN production_stage_inputs i ON i.id=a.input_id JOIN production_stage_batches b ON b.id=i.batch_id JOIN production_orders o ON o.id=b.production_id WHERE a.id=${row}.allocation_id)`,
    production_items: row => `'warehouse:' || (SELECT warehouse_id FROM production_orders WHERE id=${row}.production_id)`,
    production_batches: row => `'warehouse:' || (SELECT warehouse_id FROM production_orders WHERE id=${row}.production_id)`,
    production_batch_items: row => `'warehouse:' || (SELECT o.warehouse_id FROM production_batches b JOIN production_orders o ON o.id=b.production_id WHERE b.id=${row}.batch_id)`,
    production_batch_scraps: row => `'warehouse:' || (SELECT o.warehouse_id FROM production_batches b JOIN production_orders o ON o.id=b.production_id WHERE b.id=${row}.batch_id)`,
    order_items: row => `'warehouse:' || (SELECT warehouse_id FROM orders WHERE id=${row}.order_id)`,
    payments: row => `'warehouse:' || (SELECT warehouse_id FROM orders WHERE id=${row}.order_id)`,
    stock_adjustments: row => `'warehouse:' || (SELECT warehouse_id FROM products WHERE id=${row}.product_id)`,
    stock_qr_codes: row => `'warehouse:' || ${row}.warehouse_id`,
    users: row => `'user:' || ${row}.id`,
    positions: () => "'global'",
    production_groups: () => "'global'",
    announcement_reads: row => `'user:' || ${row}.user_id`,
    warehouses: () => "'global'",
    contacts: () => "'global'",
    settings: () => "'global'",
    announcements: () => "'global'",
    app_metadata: () => "'global'",
  };
  for (const [table, scope] of Object.entries(tables)) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
    for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
      const row = event === 'DELETE' ? 'OLD' : 'NEW';
      const conditions = [];
      if (event === 'UPDATE') conditions.push(`(${columns.map(column => `OLD.${column} IS NOT NEW.${column}`).join(' OR ')})`);
      if (table === 'app_metadata') conditions.push(`${row}.key IN ('instance_id','product_units','stock_expression')`);
      const scopes = event === 'UPDATE' ? [scope('OLD'), scope('NEW')] : [scope(row)];
      db.exec(`CREATE TRIGGER IF NOT EXISTS data_revision_${table}_${event} AFTER ${event} ON ${table}
        ${conditions.length ? `WHEN ${conditions.join(' AND ')}` : ''}
        BEGIN
          INSERT INTO data_revisions(scope,revision)
          SELECT scope,1 FROM (${scopes.map(value => `SELECT ${value} AS scope`).join(' UNION ')}) WHERE scope IS NOT NULL
          ON CONFLICT(scope) DO UPDATE SET revision=revision+1;
        END`);
    }
  }
  const counter = db.prepare('SELECT revision FROM data_revisions WHERE scope=?');
  const revision = req => {
    // Cross-warehouse stock comparisons also depend on the configured warehouses.
    const expression = getStockExpression(db);
    const warehouseIds = [...new Set([req.warehouse.id, ...(expression ? [expression.left, ...expression.terms.map(term => term.warehouse_id)] : [])])].sort((a, b) => a - b);
    return JSON.stringify([
      db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value,
      // Calendar-based reminders change at midnight even without a database write.
      inspectionToday(),
      ...['global', `user:${req.user.id}`, ...warehouseIds.map(id => `warehouse:${id}`)].map(scope => counter.get(scope)?.revision || 0),
    ]);
  };
  app.get('/api/updates', (req, res) => res.json({ revision: revision(req), user_id: req.user.id }));
  return revision;
}
