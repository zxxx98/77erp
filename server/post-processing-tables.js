import { createHash } from 'node:crypto';
import { hasPermission } from '../shared/permissions.js';
import { validQuantity } from '../shared/quantity.js';
import { processGraphWithPrices } from '../shared/process-routes.js';
import { normalizePostMaterials } from './post-processing-materials.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const id = value => Number.isSafeInteger(value) && value > 0;
const text = (value, max) => typeof value === 'string' && value.length <= max;
const changed = '后处理工序表已变化，请重新选择后保存。';

export function migratePostProcessingTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS post_processing_tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT, warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    name TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), version INTEGER NOT NULL DEFAULT 1,
    operations TEXT NOT NULL, UNIQUE(warehouse_id,name))`);
}

function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 50) fail('后处理工序表需要 1 至 50 道工序。');
  const keys = new Set();
  for (const row of rows) {
    if (!row || !id(row.route_id) || !id(row.route_version) || !text(row.node_id, 100) || !row.node_id.trim() ||
        !(row.price_table_id == null || text(row.price_table_id, 100)) || !validQuantity(row.product_coefficient, true))
      fail('请选择有效后处理工序并填写正数成品系数，最多 4 位小数。');
    const key = JSON.stringify([row.route_id, row.node_id]);
    if (keys.has(key)) fail('同一道后处理工序不能重复添加。');
    keys.add(key);
  }
}

function resolveRow(db, warehouseId, row, checkVersion = false) {
  const route = db.prepare('SELECT * FROM process_routes WHERE id=? AND warehouse_id=?').get(row.route_id, warehouseId);
  if (!route?.enabled || route.route_kind !== 'post_processing') fail('请选择当前仓库已启用的后处理工艺。');
  if (checkVersion && route.version !== row.route_version) fail('后处理工艺已变化，请重新选择后保存。', 409);
  const graph = processGraphWithPrices(JSON.parse(route.graph), row.price_table_id);
  const node = graph.nodes.find(node => node.id === row.node_id);
  if (!node) fail('所选后处理工序不存在。');
  return { route_id: route.id, route_version: route.version, route_name: route.name, node_id: node.id, name: node.name,
    price_table_id: graph.price_table_id ?? null, price_table_name: graph.price_table_name ?? '',
    product_coefficient: row.product_coefficient, materials: normalizePostMaterials(db, warehouseId, node.materials, true) };
}

function getTable(db, warehouseId, tableId) {
  const table = db.prepare('SELECT * FROM post_processing_tables WHERE warehouse_id=? AND id=?').get(warehouseId, tableId);
  if (!table) fail('后处理工序表不存在或不属于当前仓库。', 404);
  return { ...table, operations: JSON.parse(table.operations) };
}

function preview(db, warehouseId, tableId) {
  if (!id(tableId)) fail('请选择有效的后处理工序表。');
  const table = getTable(db, warehouseId, tableId);
  if (!table.enabled) fail('后处理工序表已停用，请重新选择。', 409);
  const operations = table.operations.map(row => resolveRow(db, warehouseId, row));
  const instance = db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value;
  const token = createHash('sha256').update(JSON.stringify([instance, warehouseId, table.id, table.version, operations])).digest('hex');
  return { ...table, operations, token };
}

export function productionPostProcessingTable(db, warehouseId, body, productId) {
  if (body.post_processing_operations !== undefined) fail('不能同时选择后处理工序表和单独的后处理工序。');
  if (body.post_processing_table_id === null) return [];
  const table = preview(db, warehouseId, body.post_processing_table_id);
  if (body.post_processing_table_token !== table.token) fail(changed, 409);
  if (table.operations.some(row => row.materials.some(material => material.product_id === productId))) fail('成品不能作为自身的后处理材料。');
  return table.operations;
}

export function postProcessingTableReferencesRoute(db, routeId) {
  return db.prepare(`SELECT 1 FROM post_processing_tables, json_each(operations)
    WHERE json_extract(value,'$.route_id')=? LIMIT 1`).get(routeId);
}

export function installPostProcessingTables(app, db, { operationRequest, saveOperationRequest }) {
  const endpoint = (fn, manage = false, write = false) => (req, res) => {
    try {
      if (!hasPermission(req.user, 'bom') && (manage || !hasPermission(req.user, 'production'))) fail('需要后处理工序表权限。', 403);
      if (write) db.exec('BEGIN IMMEDIATE');
      const request = write ? operationRequest(db, req) : null;
      const result = request?.previous || fn(req);
      if (write) {
        if (!request.previous) saveOperationRequest(db, request, result);
        db.exec('COMMIT');
      }
      res.json(result);
    } catch (error) {
      if (write && db.isTransaction) db.exec('ROLLBACK');
      res.status(error.status || 400).json({ error: error.message.includes('UNIQUE') ? '后处理工序表名称已存在。' : error.message });
    }
  };
  const path = '/api/post-processing-tables';
  const current = req => getTable(db, req.warehouse.id, Number(req.params.id));
  const checkVersion = (req, table) => { if (req.body.version !== table.version) fail(changed, 409); };
  app.get(path, endpoint(req => {
    const manage = req.query.scope === 'manage';
    if (manage && !hasPermission(req.user, 'bom')) fail('需要后处理工序表权限。', 403);
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const limit = 30;
    const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const tables = db.prepare(`SELECT id,name,version,enabled,json_array_length(operations) operation_count
      FROM post_processing_tables WHERE warehouse_id=? ${manage ? '' : 'AND enabled=1'} AND instr(lower(name),lower(?))>0
      ORDER BY name,id LIMIT ? OFFSET ?`).all(req.warehouse.id, search, limit + 1, offset);
    return { tables: tables.slice(0, limit), has_more: tables.length > limit, next_offset: offset + limit };
  }));
  app.get(`${path}/:id/preview`, endpoint(req => preview(db, req.warehouse.id, Number(req.params.id))));
  app.get(`${path}/:id`, endpoint(req => {
    const table = current(req);
    return { ...table, operations: table.operations.map(row => {
      try { return resolveRow(db, req.warehouse.id, row); } catch { return row; }
    }) };
  }, true));
  const save = req => {
    const old = req.params.id ? current(req) : null;
    if (old) checkVersion(req, old);
    const { name, enabled, operations } = req.body;
    if (!text(name, 100) || !name.trim() || ![0,1].includes(enabled)) fail('后处理工序表名称或启用状态无效。');
    validateRows(operations);
    const rows = operations.map(row => resolveRow(db, req.warehouse.id, row, true));
    const tableId = old ? old.id : Number(db.prepare('INSERT INTO post_processing_tables(warehouse_id,name,enabled,operations) VALUES (?,?,?,?)')
      .run(req.warehouse.id, name.trim(), enabled, JSON.stringify(rows)).lastInsertRowid);
    if (old) db.prepare('UPDATE post_processing_tables SET name=?,enabled=?,operations=?,version=version+1 WHERE id=?')
      .run(name.trim(), enabled, JSON.stringify(rows), tableId);
    return getTable(db, req.warehouse.id, tableId);
  };
  app.post(path, endpoint(save, true, true));
  app.post(`${path}/:id`, endpoint(save, true, true));
  app.post(`${path}/:id/status`, endpoint(req => {
    const table = current(req);
    checkVersion(req, table);
    if (![0,1].includes(req.body.enabled)) fail('后处理工序表名称或启用状态无效。');
    if (req.body.enabled) for (const row of table.operations) resolveRow(db, req.warehouse.id, row);
    db.prepare('UPDATE post_processing_tables SET enabled=?,version=version+1 WHERE id=?').run(req.body.enabled, table.id);
    return getTable(db, req.warehouse.id, table.id);
  }, true, true));
  app.post(`${path}/:id/delete`, endpoint(req => {
    const table = current(req);
    checkVersion(req, table);
    db.prepare('DELETE FROM post_processing_tables WHERE id=?').run(table.id);
    return { ok: true };
  }, true, true));
}

export function validatePostProcessingTableBackup(data) {
  const routes = new Map(data.process_routes.map(row => [row.id, row]));
  const warehouses = new Set(data.warehouses.map(row => row.id));
  const names = new Set();
  for (const table of data.post_processing_tables) {
    const key = JSON.stringify([table.warehouse_id, table.name]);
    if (!warehouses.has(table.warehouse_id) || !text(table.name, 100) || !table.name || table.name !== table.name.trim() ||
        !id(table.version) || ![0,1].includes(table.enabled) || names.has(key)) fail('备份后处理工序表无效。');
    names.add(key);
    const operations = JSON.parse(table.operations);
    validateRows(operations);
    for (const row of operations) {
      const route = routes.get(row.route_id);
      if (route?.warehouse_id !== table.warehouse_id || route.route_kind !== 'post_processing' || !text(row.name, 100) || !text(row.route_name, 100))
        fail('备份后处理工序表关联无效。');
    }
  }
}
