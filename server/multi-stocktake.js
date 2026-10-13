import { addQuantity } from '../shared/quantity.js';

const SEARCH_PAGE_SIZE = 30;
const placeholders = values => values.map(() => '?').join(',');
const fail = message => { throw new Error(message); };
const ids = (values, limit, message) => {
  if (!Array.isArray(values) || !values.length || values.length > limit ||
      values.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(values).size !== values.length)
    fail(message);
  return values;
};
const like = value => value.replace(/[\\%_]/g, '\\$&');

export function installMultiStocktake(app, db) {
  // Search the current warehouse on demand; never return its whole catalog for an empty query.
  app.get('/api/stocktakes/multi/products', (req, res) => {
    try {
      const query = req.query.q ?? '';
      const rawOffset = req.query.offset ?? '0';
      if (typeof query !== 'string' || query.length > 100 || typeof rawOffset !== 'string' ||
          !/^\d+$/.test(rawOffset) || !Number.isSafeInteger(Number(rawOffset)))
        fail('请输入有效的搜索内容，最多 100 字。');
      const term = query.trim(), offset = Number(rawOffset);
      if (!term) return res.json({ products: [], has_more: false });
      const pattern = `%${like(term)}%`;
      const products = db.prepare(`SELECT id,name,barcode,unit,specification,active FROM products
        WHERE warehouse_id=? AND (barcode LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\')
        ORDER BY CASE WHEN barcode=? THEN 0 WHEN barcode LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,name,id
        LIMIT ? OFFSET ?`).all(req.warehouse.id, pattern, pattern, term, `${like(term)}%`, SEARCH_PAGE_SIZE + 1, offset);
      res.json({ products: products.slice(0, SEARCH_PAGE_SIZE), has_more: products.length > SEARCH_PAGE_SIZE });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });

  // This is a read-only inventory snapshot, separate from submitting an actual stock adjustment.
  app.post('/api/stocktakes/multi/compare', (req, res) => {
    let reading = false;
    try {
      const warehouseIds = ids(req.body?.warehouse_ids, 100, '请选择 1–100 个仓库，仓库不能重复。');
      const productIds = ids(req.body?.product_ids, 1000, '请选择 1–1000 种商品，商品不能重复。');
      if (!warehouseIds.includes(req.warehouse.id)) fail('请选择当前仓库作为对照基准。');
      db.exec('BEGIN');
      reading = true;
      const warehouses = db.prepare(`SELECT id,name FROM warehouses WHERE id IN (${placeholders(warehouseIds)})`).all(...warehouseIds);
      if (warehouses.length !== warehouseIds.length) fail('仓库不存在，请重新选择。');
      const orderedIds = [req.warehouse.id, ...warehouseIds.filter(id => id !== req.warehouse.id)];
      const orderedWarehouses = orderedIds.map(id => warehouses.find(w => w.id === id));
      const products = db.prepare(`SELECT id,name,barcode,unit,specification,active,sync_key,stock FROM products
        WHERE warehouse_id=? AND id IN (${placeholders(productIds)})`).all(req.warehouse.id, ...productIds);
      if (products.length !== productIds.length) fail('商品已删除或不属于当前仓库，请重新选择。');
      const codes = products.map(p => p.barcode), keys = products.map(p => p.sync_key).filter(Boolean);
      const remote = db.prepare(`SELECT id,warehouse_id,barcode,unit,sync_key,stock FROM products
        WHERE warehouse_id IN (${placeholders(orderedIds)}) AND
        (barcode IN (${placeholders(codes)})${keys.length ? ` OR sync_key IN (${placeholders(keys)})` : ''})`)
        .all(...orderedIds, ...codes, ...keys);
      const byCode = new Map(), bySync = new Map();
      for (const p of remote) {
        byCode.set(JSON.stringify([p.warehouse_id, p.barcode]), p);
        if (p.sync_key) bySync.set(JSON.stringify([p.warehouse_id, p.sync_key]), p);
      }
      const byId = new Map(products.map(p => [p.id, p]));
      const rows = productIds.map(id => {
        const p = byId.get(id);
        return {
          product_id: p.id, name: p.name, barcode: p.barcode, unit: p.unit,
          specification: p.specification, active: p.active,
          cells: orderedIds.map(warehouseId => {
            const target = (p.sync_key && bySync.get(JSON.stringify([warehouseId, p.sync_key]))) ||
              byCode.get(JSON.stringify([warehouseId, p.barcode]));
            if (!target) return { warehouse_id: warehouseId, quantity: null, unit: null, difference: null, status: 'missing' };
            const sameUnit = target.unit === p.unit;
            return { warehouse_id: warehouseId, quantity: target.stock, unit: target.unit,
              difference: sameUnit ? addQuantity(target.stock, -p.stock) : null,
              status: sameUnit ? 'matched' : 'unit_mismatch' };
          }),
        };
      });
      const result = { current_warehouse_id: req.warehouse.id, warehouses: orderedWarehouses, rows, captured_at: new Date().toISOString() };
      db.exec('COMMIT');
      reading = false;
      res.json(result);
    } catch (error) {
      if (reading) db.exec('ROLLBACK');
      res.status(400).json({ error: error.message });
    }
  });
}
