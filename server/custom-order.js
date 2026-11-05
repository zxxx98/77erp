// Manual list ordering shared by BOM and process routes.
// `sort_order` is per warehouse; smaller values are shown first, ties fall back to newest id.
export const CUSTOM_ORDER_BY = 'sort_order ASC,id DESC';

export function migrateSortOrder(db, table) {
  if (db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === 'sort_order')) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`);
  // Keep the order users already see (recently updated first) as the initial custom order.
  db.exec(`UPDATE ${table} SET sort_order=(SELECT n FROM (SELECT id,ROW_NUMBER() OVER (PARTITION BY warehouse_id ORDER BY updated_at DESC,id DESC) n FROM ${table}) r WHERE r.id=${table}.id)`);
}

// SQL expression placing a new row before every existing row of the warehouse.
export const nextTopOrder = table => `(SELECT COALESCE(MIN(sort_order),1)-1 FROM ${table} WHERE warehouse_id=?)`;

/**
 * Move the given rows into the requested relative order. They keep occupying the same slots
 * of the full warehouse list, so reordering a filtered or paged subset never disturbs other rows.
 */
export function reorderRows(db, table, warehouseId, ids, fail, label) {
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 100 || new Set(ids).size !== ids.length ||
      ids.some(id => !Number.isSafeInteger(id) || id < 1)) fail(`${label}排序参数无效。`);
  const all = db.prepare(`SELECT id,sort_order FROM ${table} WHERE warehouse_id=? ORDER BY ${CUSTOM_ORDER_BY}`).all(warehouseId).map(row => row.id);
  const requested = new Set(ids);
  if (ids.some(id => !all.includes(id))) fail(`${label}不存在或不属于当前仓库，请刷新列表后重试。`, 409);
  const queue = [...ids];
  const next = all.map(id => requested.has(id) ? queue.shift() : id);
  const update = db.prepare(`UPDATE ${table} SET sort_order=? WHERE id=?`);
  const current = new Map(db.prepare(`SELECT id,sort_order FROM ${table} WHERE warehouse_id=?`).all(warehouseId).map(row => [row.id, row.sort_order]));
  next.forEach((id, index) => { if (current.get(id) !== index + 1) update.run(index + 1, id); });
  return { ok: true };
}
