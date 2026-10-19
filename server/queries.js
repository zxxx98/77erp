import { orderLineAmount } from '../shared/money.js';
import { hasPermission } from '../shared/permissions.js';
import { settlementFromPaid } from './commerce.js';

const fail = (message) => {
  throw new Error(message);
};
const route = (fn) => (req, res) => {
  try {
    res.json(fn(req));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
// Escape LIKE wildcards so a user-typed % or _ matches literally.
const pattern = (value) => `%${String(value).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const dateKey = (value, fallback) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
    ? value
    : fallback;
const choice = (value, allowed, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !allowed.includes(value)) fail('筛选参数无效。');
  return value;
};
const paging = (query) => {
  const rawLimit = query.limit ?? '30', rawOffset = query.offset ?? '0';
  if (typeof rawLimit !== 'string' || !/^\d+$/.test(rawLimit) || typeof rawOffset !== 'string' || !/^\d+$/.test(rawOffset))
    fail('分页参数无效。');
  const limit = Number(rawLimit), offset = Number(rawOffset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset)) fail('分页参数超出范围。');
  return { limit, offset };
};
const search = (value) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 100) fail('搜索关键词无效。');
  return value.trim();
};

// Read-only list, detail and aggregate endpoints for large workspaces. The
// existing /api/data payload stays unchanged for older clients.
export function installQueries(app, db) {
  const financial = (req) => hasPermission(req.user, 'finance');
  const hidesCosts = (req) => !financial(req) && !req.user.legacy_permissions;
  const categoryBranch = (warehouseId, categoryId) => {
    const categories = db.prepare('SELECT id,parent_id FROM categories WHERE warehouse_id=?').all(warehouseId);
    const children = new Map();
    for (const category of categories)
      children.set(category.parent_id ?? null, [...(children.get(category.parent_id ?? null) || []), category.id]);
    const branch = [], queue = [categoryId];
    while (queue.length) {
      const id = queue.pop();
      if (branch.includes(id)) continue;
      branch.push(id);
      queue.push(...(children.get(id) || []));
    }
    return branch;
  };
  const itemSummary = (orderIds) => {
    const summary = new Map();
    if (!orderIds.length) return summary;
    const placeholders = orderIds.map(() => '?').join(',');
    for (const row of db
      .prepare(`SELECT order_id,COUNT(*) AS item_count,SUM(quantity) AS quantity FROM order_items WHERE order_id IN (${placeholders}) GROUP BY order_id`)
      .all(...orderIds))
      summary.set(row.order_id, { item_count: row.item_count, item_quantity: row.quantity, item_names: [] });
    for (const row of db
      .prepare(`SELECT order_id,name FROM order_items WHERE order_id IN (${placeholders}) ORDER BY order_id,id`)
      .all(...orderIds)) {
      const entry = summary.get(row.order_id);
      if (entry && entry.item_names.length < 3) entry.item_names.push(row.name);
    }
    return summary;
  };
  const withSettlement = (req, orders) => {
    if (!financial(req) || !orders.length) return orders;
    const placeholders = orders.map(() => '?').join(',');
    const paid = new Map(
      db
        .prepare(`SELECT order_id,SUM(amount_cents) AS amount FROM payments WHERE reversed_at IS NULL AND order_id IN (${placeholders}) GROUP BY order_id`)
        .all(...orders.map((o) => o.id))
        .map((row) => [row.order_id, row.amount]),
    );
    return orders.map((order) => Object.assign(order, settlementFromPaid(order, paid.get(order.id) || 0)));
  };

  app.get('/api/products/:id', (req, res, next) => {
    if (!/^\d+$/.test(req.params.id)) return next();
    const product = db.prepare('SELECT * FROM products WHERE id=? AND warehouse_id=?').get(Number(req.params.id), req.warehouse.id);
    if (!product) return res.status(404).json({ error: '物料不存在。' });
    if (hidesCosts(req)) delete product.inventory_value_cents;
    res.json({ product });
  });

  app.get(
    '/api/products',
    route((req) => {
      const { limit, offset } = paging(req.query);
      const status = choice(req.query.status, ['all', 'active', 'inactive'], 'all');
      const stock = choice(req.query.stock, ['all', 'low', 'empty'], 'all');
      const query = search(req.query.q);
      const clauses = ['warehouse_id=?'], params = [req.warehouse.id];
      if (status === 'active') clauses.push('active!=0');
      if (status === 'inactive') clauses.push('active=0');
      if (stock === 'low') clauses.push('threshold>0 AND stock<=threshold');
      if (stock === 'empty') clauses.push('threshold>0 AND stock=0');
      if (req.query.category_id !== undefined && req.query.category_id !== '' && req.query.category_id !== 'all') {
        const raw = String(req.query.category_id);
        if (!/^\d+$/.test(raw)) fail('分类筛选无效。');
        const branch = categoryBranch(req.warehouse.id, Number(raw));
        if (!branch.length) return { products: [], total: 0, has_more: false, next_offset: offset };
        clauses.push(`category_id IN (${branch.map(() => '?').join(',')})`);
        params.push(...branch);
      }
      if (query) {
        clauses.push(`(name LIKE ? ESCAPE '\\' OR barcode LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' OR specification LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\')`);
        const value = pattern(query);
        params.push(value, value, value, value, value);
      }
      const where = clauses.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) AS n FROM products WHERE ${where}`).get(...params).n;
      const rows = db
        .prepare(`SELECT * FROM products WHERE ${where} ORDER BY id LIMIT ? OFFSET ?`)
        .all(...params, limit, offset);
      if (hidesCosts(req)) for (const row of rows) delete row.inventory_value_cents;
      return { products: rows, total, has_more: offset + rows.length < total, next_offset: offset + rows.length };
    }),
  );

  app.get(
    '/api/orders',
    route((req) => {
      const { limit, offset } = paging(req.query);
      const type = choice(req.query.type, ['in', 'out'], null);
      const kind = choice(req.query.kind, ['normal', 'return', 'transfer'], null);
      const status = choice(req.query.status, ['active', 'void'], null);
      const business = choice(req.query.business, ['in', 'out'], null);
      const from = dateKey(req.query.from, null), to = dateKey(req.query.to, null);
      if (from && to && from > to) fail('请选择有效的起止日期。');
      const query = search(req.query.q), partner = search(req.query.partner);
      const clauses = ['o.warehouse_id=?'], params = [req.warehouse.id];
      if (type) { clauses.push('o.type=?'); params.push(type); }
      if (kind) { clauses.push('o.kind=?'); params.push(kind); }
      // Business direction folds returns into the side they correct, like the UI.
      if (business === 'in') clauses.push("((o.kind='normal' AND o.type='in') OR (o.kind='return' AND o.type='out'))");
      if (business === 'out') clauses.push("((o.kind='normal' AND o.type='out') OR (o.kind='return' AND o.type='in'))");
      if (status) { clauses.push('o.status=?'); params.push(status); }
      if (from) { clauses.push('substr(o.created_at,1,10)>=?'); params.push(from); }
      if (to) { clauses.push('substr(o.created_at,1,10)<=?'); params.push(to); }
      if (partner) { clauses.push("o.partner LIKE ? ESCAPE '\\'"); params.push(pattern(partner)); }
      if (query) {
        clauses.push(`(o.number LIKE ? ESCAPE '\\' OR o.partner LIKE ? ESCAPE '\\' OR EXISTS (
          SELECT 1 FROM order_items i WHERE i.order_id=o.id AND (i.name LIKE ? ESCAPE '\\' OR i.barcode LIKE ? ESCAPE '\\')))`);
        const value = pattern(query);
        params.push(value, value, value, value);
      }
      const where = clauses.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) AS n FROM orders o WHERE ${where}`).get(...params).n;
      const rows = db
        .prepare(`SELECT o.* FROM orders o WHERE ${where} ORDER BY o.created_at DESC,o.id DESC LIMIT ? OFFSET ?`)
        .all(...params, limit, offset);
      const aggregate = db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN o.status='active' AND o.kind!='transfer' THEN CASE WHEN o.kind='return' THEN -o.total ELSE o.total END ELSE 0 END),0) AS net_total,
        COALESCE(SUM(o.status='active'),0) AS active_count,
        COALESCE(SUM(CASE WHEN o.status='active' THEN (SELECT SUM(i.quantity) FROM order_items i WHERE i.order_id=o.id) ELSE 0 END),0) AS quantity
        FROM orders o WHERE ${where}`).get(...params);
      const counts = db.prepare(`SELECT COUNT(*) AS all_count,
        SUM((kind='normal' AND type='in') OR (kind='return' AND type='out')) AS in_count,
        SUM((kind='normal' AND type='out') OR (kind='return' AND type='in')) AS out_count,
        SUM(kind='transfer') AS transfer_count FROM orders WHERE warehouse_id=?`).get(req.warehouse.id);
      const summary = itemSummary(rows.map((order) => order.id));
      const orders = withSettlement(req, rows.map((order) => ({ ...order, ...(summary.get(order.id) || { item_count: 0, item_quantity: 0, item_names: [] }) })));
      return { orders, total, aggregate, counts, has_more: offset + orders.length < total, next_offset: offset + orders.length };
    }),
  );

  app.get(
    '/api/orders/:id',
    (req, res, next) => {
      const raw = req.params.id;
      // /api/orders/export and future literal paths stay reachable.
      if (!/^\d+$/.test(raw)) return next();
      const order = db.prepare('SELECT * FROM orders WHERE id=? AND warehouse_id=?').get(Number(raw), req.warehouse.id);
      if (!order) return res.status(404).json({ error: '单据不存在。' });
      const returned = new Map(
        db
          .prepare(`SELECT i.product_id,SUM(i.quantity) AS quantity FROM order_items i JOIN orders o ON o.id=i.order_id
            WHERE o.source_order_id=? AND o.status='active' GROUP BY i.product_id`)
          .all(order.id)
          .map((row) => [row.product_id, row.quantity]),
      );
      const hidden = hidesCosts(req);
      const items = db
        .prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id')
        .all(order.id)
        .map((item) => {
          const line = { ...item, amount_cents: orderLineAmount(item), returned_quantity: returned.get(item.product_id) || 0 };
          if (hidden) delete line.cost_cents;
          return line;
        });
      return res.json({ order: withSettlement(req, [order])[0] ? { ...withSettlement(req, [order])[0], items } : { ...order, items } });
    },
  );

  app.get(
    '/api/dashboard',
    route((req) => {
      const days = [7, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
      const counts = db
        .prepare(`SELECT COUNT(*) AS products, SUM(active!=0) AS active, SUM(stock) AS stock,
          SUM(CASE WHEN active!=0 THEN stock ELSE 0 END) AS active_stock,
          SUM(CASE WHEN active!=0 THEN inventory_value_cents ELSE 0 END) AS active_value,
          SUM(active!=0 AND threshold>0 AND stock>0 AND stock<=threshold) AS low_stock, SUM(active!=0 AND threshold>0 AND stock=0) AS out_of_stock,
          COALESCE(SUM(inventory_value_cents),0) AS inventory_value_cents FROM products WHERE warehouse_id=?`)
        .get(req.warehouse.id);
      const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      // Transfers never carry money, so they stay out of the trading trend.
      const trading = db
        .prepare("SELECT type,kind,total,created_at,status FROM orders WHERE warehouse_id=? AND substr(created_at,1,10)>=?")
        .all(req.warehouse.id, since)
        .filter((order) => order.status === 'active' && order.kind !== 'transfer')
        .map((order) => ({
          day: order.created_at.slice(0, 10),
          type: order.kind === 'return' ? (order.type === 'in' ? 'out' : 'in') : order.type,
          total: order.kind === 'return' ? -order.total : order.total,
        }));
      const totalsOf = (rows) => ({
        purchase_cents: Math.round(rows.filter((r) => r.type === 'in').reduce((sum, r) => sum + r.total, 0) * 100),
        sales_cents: Math.round(rows.filter((r) => r.type === 'out').reduce((sum, r) => sum + r.total, 0) * 100),
        purchase_count: rows.filter((r) => r.type === 'in').length,
        sales_count: rows.filter((r) => r.type === 'out').length,
      });
      const trend = [];
      for (let index = days - 1; index >= 0; index--) {
        const day = new Date(Date.now() - index * 86400000).toISOString().slice(0, 10);
        trend.push({ day, ...totalsOf(trading.filter((row) => row.day === day)) });
      }
      const recent = db
        .prepare('SELECT * FROM orders WHERE warehouse_id=? ORDER BY created_at DESC,id DESC LIMIT 5')
        .all(req.warehouse.id);
      const summary = itemSummary(recent.map((order) => order.id));
      return {
        days,
        products: {
          total: counts.products, active: counts.active || 0, stock: counts.stock || 0, active_stock: counts.active_stock || 0,
          active_value_cents: hidesCosts(req) ? undefined : counts.active_value || 0,
          low_stock: counts.low_stock || 0, out_of_stock: counts.out_of_stock || 0,
          inventory_value_cents: hidesCosts(req) ? undefined : counts.inventory_value_cents,
          low_stock_products: db
            .prepare('SELECT * FROM products WHERE warehouse_id=? AND active!=0 AND threshold>0 AND stock<=threshold ORDER BY stock,id LIMIT 5')
            .all(req.warehouse.id)
            .map((product) => { if (hidesCosts(req)) delete product.inventory_value_cents; return product; }),
        },
        today: { day: new Date().toISOString().slice(0, 10), ...totalsOf(trading.filter((row) => row.day === new Date().toISOString().slice(0, 10))) },
        trend,
        recent_orders: withSettlement(req, recent.map((order) => ({ ...order, ...(summary.get(order.id) || { item_count: 0, item_quantity: 0, item_names: [] }) }))),
        category_counts: db.prepare('SELECT category_id,COUNT(*) AS total,SUM(active!=0) AS active FROM products WHERE warehouse_id=? GROUP BY category_id').all(req.warehouse.id),
        warehouses: db.prepare('SELECT * FROM warehouses ORDER BY id').all(),
      };
    }),
  );
}
