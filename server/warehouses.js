import { randomUUID } from 'node:crypto';

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
      ALTER TABLE orders ADD COLUMN warehouse_id INTEGER NOT NULL DEFAULT 1 REFERENCES warehouses(id);
      ALTER TABLE drafts ADD COLUMN warehouse_id INTEGER NOT NULL DEFAULT 1 REFERENCES warehouses(id);`);
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
    const match = /^\/(products|orders|drafts|payments)\/([^/]+)(?:\/|$)/.exec(path);
    if (match && !(match[1] === 'products' && ['barcode','import'].includes(match[2]))) checks.push([match[1], Number(match[2])]);
    if (path === '/orders' && req.body?.draft_id != null) checks.push(['drafts', req.body.draft_id]);
    if (path === '/drafts' && req.body?.id != null) checks.push(['drafts', req.body.id]);
    if (['/orders', '/stocktakes', '/drafts'].includes(path)) {
      for (const item of Array.isArray(req.body?.items) ? req.body.items : []) checks.push(['products', item?.product_id]);
    }
    for (const [table, itemId] of checks) {
      if (!Number.isSafeInteger(itemId)) return res.status(400).json({ error: '商品或单据编号无效。' });
      const row = table === 'payments'
        ? db.prepare('SELECT o.warehouse_id FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=?').get(itemId)
        : db.prepare(`SELECT warehouse_id FROM ${table} WHERE id=?`).get(itemId);
      if (row && row.warehouse_id !== id) return res.status(400).json({ error: '该商品、单据或草稿不属于当前仓库。' });
    }
    next();
  });
  app.get('/api/warehouses', (_, res) => res.json(warehouses()));
  app.post('/api/warehouses', (req, res) => {
    try {
      const name = warehouseName(req.body?.name);
      const result = db.prepare('INSERT INTO warehouses(name,created_at) VALUES (?,?)').run(name, new Date().toISOString());
      res.status(201).json({ id: Number(result.lastInsertRowid), name });
    } catch (e) { res.status(400).json({ error: e.message.includes('UNIQUE') ? '仓库名称已存在。' : e.message }); }
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
  return { warehouses };
}

function warehouseName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 60) throw new Error('请填写 1–60 字的仓库名称。');
  return name.trim();
}

// Caller holds the product save transaction. Stock and its valuation are never copied.
export function syncProduct(db, id, targets) {
  if (targets === undefined) return;
  if (!Array.isArray(targets) || targets.length > 100 || new Set(targets).size !== targets.length || targets.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('请选择有效的同步仓库。');
  const product = db.prepare('SELECT * FROM products WHERE id=?').get(id);
  if (!product.sync_key) {
    product.sync_key = randomUUID();
    db.prepare('UPDATE products SET sync_key=? WHERE id=?').run(product.sync_key, id);
  }
  const fields = ['name','barcode','category','unit','cost','price','threshold','color','category_id','image','specification','note'];
  for (const target of targets) {
    if (target === product.warehouse_id || !db.prepare('SELECT 1 FROM warehouses WHERE id=?').get(target)) throw new Error('同步目标仓库不存在或与当前仓库相同。');
    const existing = db.prepare('SELECT * FROM products WHERE warehouse_id=? AND sync_key=?').get(target, product.sync_key);
    const collision = db.prepare('SELECT id FROM products WHERE warehouse_id=? AND barcode=?').get(target, product.barcode);
    if (collision && collision.id !== existing?.id) throw new Error('目标仓库已有同条码的独立商品，请先核对条码，未保存任何修改。');
    const values = fields.map(field => product[field]);
    if (existing) db.prepare(`UPDATE products SET ${fields.map(f => `${f}=?`).join(',')} WHERE id=?`).run(...values, existing.id);
    else db.prepare(`INSERT INTO products (${fields.join(',')},warehouse_id,sync_key,created_at) VALUES (${fields.map(() => '?').join(',')},?,?,?)`).run(...values, target, product.sync_key, new Date().toISOString());
  }
}
