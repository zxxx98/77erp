import { recordProductChange } from './product-changes.js';
import { randomUUID } from 'node:crypto';
import { clearBom } from './bom.js';
import { copyCategoryToWarehouse } from './catalog.js';

export function migrateWarehouses(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS warehouses (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);`);
  if (db.prepare('PRAGMA table_info(products)').all().some(c => c.name === 'warehouse_id')) return;
  // Rebuild without the old global barcode constraint; existing IDs and references stay intact.
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='products'").get().sql;
  const fields = db.prepare('PRAGMA table_info(products)').all().map(c => c.name).join(',');
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO warehouses(id,name,created_at) VALUES (1,?,?)').run(db.prepare('SELECT warehouse_name FROM settings WHERE id=1').get().warehouse_name, new Date().toISOString());
    db.exec(schema.replace(/CREATE TABLE products/i, 'CREATE TABLE products_multi').replace(/barcode TEXT NOT NULL UNIQUE/i, 'barcode TEXT NOT NULL'));
    db.exec(`INSERT INTO products_multi (${fields}) SELECT ${fields} FROM products; DROP TABLE products; ALTER TABLE products_multi RENAME TO products;
      ALTER TABLE products ADD COLUMN warehouse_id INTEGER NOT NULL DEFAULT 1 REFERENCES warehouses(id);
      ALTER TABLE products ADD COLUMN sync_key TEXT NOT NULL DEFAULT '';
      CREATE UNIQUE INDEX products_warehouse_barcode ON products(warehouse_id,barcode);
      CREATE UNIQUE INDEX products_warehouse_sync ON products(warehouse_id,sync_key) WHERE sync_key!='';
      ALTER TABLE orders ADD COLUMN warehouse_id INTEGER NOT NULL DEFAULT 1 REFERENCES warehouses(id);`);
    const update = db.prepare('UPDATE products SET sync_key=? WHERE id=?');
    for (const p of db.prepare('SELECT id FROM products').all()) update.run(randomUUID(), p.id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
}

export function installWarehouses(app, db) {
  db.exec(`INSERT INTO app_metadata(key,value) VALUES ('warehouse_sequence',(SELECT MAX(id) FROM warehouses))
    ON CONFLICT(key) DO UPDATE SET value=MAX(CAST(value AS INTEGER),CAST(excluded.value AS INTEGER));`);
  const warehouses = () => db.prepare('SELECT * FROM warehouses ORDER BY id').all();
  app.use('/api', (req, res, next) => {
    // Express accepts case variants and trailing slashes for these routes.
    const path = req.path.toLowerCase().replace(/\/+$/, '');
    if (path.startsWith('/auth/')) return next();
    const raw = req.query.warehouse_id ?? req.get('X-Warehouse-ID') ?? '1';
    const id = Number(raw);
    req.warehouse = Number.isSafeInteger(id) && id > 0 && /^\d+$/.test(String(raw)) ? db.prepare('SELECT * FROM warehouses WHERE id=?').get(id) : null;
    if (!req.warehouse) return res.status(400).json({ error: '仓库不存在，请重新选择仓库。' });
    // Guard every route accepting existing business IDs, including financial corrections.
    const checks = [];
    const match = /^\/(products|orders|templates|payments|categories)\/([^/]+)(?:\/|$)/.exec(path);
    if (match && !(match[1] === 'products' && ['barcode','import','export','batch'].includes(match[2])) && !(match[1] === 'orders' && match[2] === 'export')) checks.push([match[1], Number(match[2])]);
    if (path === '/templates' && req.body?.id != null) checks.push(['templates', req.body.id]);
    if (['/orders', '/stocktakes', '/templates'].includes(path)) {
      for (const item of Array.isArray(req.body?.items) ? req.body.items : []) checks.push(['products', item?.product_id]);
    }
    for (const [table, itemId] of checks) {
      if (!Number.isSafeInteger(itemId)) return res.status(400).json({ error: '物料或单据编号无效。' });
      const row = table === 'payments'
        ? db.prepare('SELECT o.warehouse_id FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=?').get(itemId)
        : db.prepare(`SELECT warehouse_id${table === 'templates' ? ',created_by' : ''} FROM ${table} WHERE id=?`).get(itemId);
      if (table === 'templates' && row && req.user.role !== 'admin' && row.created_by !== req.user.id)
        return res.status(404).json({ error: '模板不存在或无权访问。' });
      if (row && row.warehouse_id !== id) return res.status(400).json({ error: table === 'categories' ? '该分类不属于当前仓库。' : '该物料、单据或模板不属于当前仓库。' });
    }
    next();
  });
  app.get('/api/warehouses', (_, res) => res.json(warehouses()));
  app.post('/api/warehouses', (req, res) => {
    try {
      const name = warehouseName(req.body?.name);
      const reuse = req.body?.reuse_catalog ?? false;
      if (typeof reuse !== 'boolean') throw new Error('请选择是否复用当前仓库的分类和物料。');
      db.exec('BEGIN IMMEDIATE');
      // A deleted warehouse ID must not later select an unrelated warehouse in an older browser tab.
      db.exec("UPDATE app_metadata SET value=MAX(CAST(value AS INTEGER),(SELECT MAX(id) FROM warehouses))+1 WHERE key='warehouse_sequence'");
      const id = Number(db.prepare("SELECT value FROM app_metadata WHERE key='warehouse_sequence'").get().value);
      db.prepare('INSERT INTO warehouses(id,name,created_at) VALUES (?,?,?)').run(id, name, new Date().toISOString());
      if (reuse) {
        for (const category of db.prepare('SELECT id FROM categories WHERE warehouse_id=? ORDER BY id').all(req.warehouse.id))
          copyCategoryToWarehouse(db, category.id, id);
        for (const product of db.prepare('SELECT id,active FROM products WHERE warehouse_id=? ORDER BY id').all(req.warehouse.id)) {
          syncProduct(db, product.id, [id], req.user);
          db.prepare('UPDATE products SET active=? WHERE warehouse_id=? AND sync_key=(SELECT sync_key FROM products WHERE id=?)').run(product.active, id, product.id);
        }
      }
      db.exec('COMMIT');
      res.status(201).json({ id, name });
    } catch (e) {
      if (db.isTransaction) db.exec('ROLLBACK');
      res.status(400).json({ error: e.message.includes('UNIQUE') ? '仓库名称已存在。' : e.message });
    }
  });
  app.put('/api/warehouses/:id', (req, res) => {
    try {
      const name = warehouseName(req.body?.name);
      db.exec('BEGIN IMMEDIATE');
      if (!db.prepare('UPDATE warehouses SET name=? WHERE id=?').run(name, req.params.id).changes) throw new Error('仓库不存在。');
      if (Number(req.params.id) === 1) db.prepare('UPDATE settings SET warehouse_name=? WHERE id=1').run(name);
      db.exec('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      if (db.isTransaction) db.exec('ROLLBACK');
      res.status(400).json({ error: e.message.includes('UNIQUE') ? '仓库名称已存在。' : e.message });
    }
  });
  app.delete('/api/warehouses/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) throw new Error('仓库编号无效。');
      if (id === 1) throw new Error('主仓库是系统默认仓库，不能删除。');
      db.exec('BEGIN IMMEDIATE');
      if (!db.prepare('SELECT 1 FROM warehouses WHERE id=?').get(id)) throw new Error('仓库不存在。');
      if (db.prepare('SELECT 1 FROM products WHERE warehouse_id=? AND stock!=0 LIMIT 1').get(id))
        throw new Error('仓库仍有库存，不能删除，请先清空所有物料库存。');
      if (db.prepare('SELECT 1 FROM quality_acceptances WHERE warehouse_id=? LIMIT 1').get(id))
        throw new Error('仓库仍有验收单，不能删除。');
      if (db.prepare('SELECT 1 FROM production_orders WHERE warehouse_id=? LIMIT 1').get(id))
        throw new Error('仓库仍有生产单，不能删除，请保留生产历史。');
      if (db.prepare('SELECT 1 FROM quality_templates WHERE warehouse_id=? LIMIT 1').get(id))
        throw new Error('仓库仍有品质模板及历史版本，不能删除。');
      for (const table of ['stock_qr_previews', 'stock_qr_usages', 'stock_qr_revisions', 'stock_qr_items'])
        db.prepare(`DELETE FROM ${table} WHERE stock_qr_id IN (SELECT id FROM stock_qr_codes WHERE warehouse_id=?)`).run(id);
      db.prepare('DELETE FROM stock_qr_codes WHERE warehouse_id=?').run(id);
      db.prepare('DELETE FROM templates WHERE warehouse_id=?').run(id);
      clearBom(db, id);
      db.prepare('DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE warehouse_id=?)').run(id);
      db.prepare('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE warehouse_id=?)').run(id);
      // Original orders and their returns belong to the same warehouse and are removed together.
      db.prepare('DELETE FROM orders WHERE warehouse_id=?').run(id);
      db.prepare('DELETE FROM stock_adjustments WHERE product_id IN (SELECT id FROM products WHERE warehouse_id=?)').run(id);
      db.prepare('DELETE FROM product_changes WHERE product_id IN (SELECT id FROM products WHERE warehouse_id=?)').run(id);
      db.prepare('DELETE FROM products WHERE warehouse_id=?').run(id);
      // Delete the category tree in one statement so parent references are checked together.
      db.prepare('DELETE FROM categories WHERE warehouse_id=?').run(id);
      db.prepare('DELETE FROM warehouses WHERE id=?').run(id);
      const config = db.prepare('SELECT warehouse_ids FROM notification_settings WHERE id=1').get();
      const selected = JSON.parse(config.warehouse_ids);
      if (selected.includes(id)) {
        const remaining = selected.filter(value => value !== id);
        // An empty selection means all warehouses, so disable when the sole selected warehouse is removed.
        db.prepare('UPDATE notification_settings SET warehouse_ids=?,enabled=CASE WHEN ?=0 THEN 0 ELSE enabled END,version=version+1 WHERE id=1')
          .run(JSON.stringify(remaining), remaining.length);
      }
      const expressionRow = db.prepare("SELECT value FROM app_metadata WHERE key='stock_expression'").get();
      if (expressionRow) {
        try {
          const expression = JSON.parse(expressionRow.value);
          if (expression?.left === id) db.prepare("DELETE FROM app_metadata WHERE key='stock_expression'").run();
          else if (expression?.terms?.some(term => term.warehouse_id === id))
            db.prepare("UPDATE app_metadata SET value=? WHERE key='stock_expression'")
              .run(JSON.stringify({ ...expression, terms: expression.terms.filter(term => term.warehouse_id !== id) }));
        } catch { db.prepare("DELETE FROM app_metadata WHERE key='stock_expression'").run(); }
      }
      db.exec('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      if (db.isTransaction) db.exec('ROLLBACK');
      res.status(400).json({ error: e.message });
    }
  });
  return { warehouses };
}

function warehouseName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 60) throw new Error('请填写 1–60 字的仓库名称。');
  return name.trim();
}

// Caller holds the product save transaction. Stock and its valuation are never copied.
export function syncProduct(db, id, targets, user) {
  if (targets === undefined) return;
  if (!Array.isArray(targets) || targets.length > 100 || new Set(targets).size !== targets.length || targets.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('请选择有效的同步仓库。');
  const product = db.prepare('SELECT * FROM products WHERE id=?').get(id);
  if (!product.sync_key) {
    product.sync_key = randomUUID();
    db.prepare('UPDATE products SET sync_key=? WHERE id=?').run(product.sync_key, id);
  }
  const fields = ['name','barcode','category','unit','cost','price','threshold','color','category_id','image','specification','note','customer_part_numbers','production_type','is_fixed_asset','unit_round_up','inspection_date','inspection_interval','inspection_unit'];
  for (const target of targets) {
    if (target === product.warehouse_id || !db.prepare('SELECT 1 FROM warehouses WHERE id=?').get(target)) throw new Error('同步目标仓库不存在或与当前仓库相同。');
    const existing = db.prepare('SELECT * FROM products WHERE warehouse_id=? AND sync_key=?').get(target, product.sync_key);
    const collision = db.prepare('SELECT id FROM products WHERE warehouse_id=? AND barcode=?').get(target, product.barcode);
    if (collision && collision.id !== existing?.id) throw new Error('目标仓库已有同条码的独立物料，请先核对条码，未保存任何修改。');
    const categoryId = copyCategoryToWarehouse(db, product.category_id, target);
    const values = fields.map(field => field === 'category_id' ? categoryId : product[field]);
    if (existing) {
      db.prepare(`UPDATE products SET ${fields.map(f => `${f}=?`).join(',')} WHERE id=?`).run(...values, existing.id);
      recordProductChange(db, existing, product, user);
    }
    else db.prepare(`INSERT INTO products (${fields.join(',')},warehouse_id,sync_key,created_at) VALUES (${fields.map(() => '?').join(',')},?,?,?)`).run(...values, target, product.sync_key, new Date().toISOString());
  }
}
