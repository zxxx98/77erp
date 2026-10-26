import { hasPermission } from '../shared/permissions.js';
import { validQuantity, addQuantity } from '../shared/quantity.js';
import { validateProcessGraph, processProgress } from '../shared/process-routes.js';

export const processRouteTables = ['process_routes'];
export const productionOperationTables = ['production_routes', 'production_operation_reports'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const id = value => Number.isSafeInteger(value) && value > 0;
const actor = req => req.user.name || req.user.username;
const parseGraph = value => { try { const graph = JSON.parse(value); validateProcessGraph(graph); return graph; } catch (error) { fail(error.message); } };

export function migrateProcessRoutes(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS process_routes (
    id INTEGER PRIMARY KEY, warehouse_id INTEGER NOT NULL REFERENCES warehouses(id), name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), graph TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, created_by_name TEXT NOT NULL, updated_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(warehouse_id,name));
    CREATE TABLE IF NOT EXISTS production_routes (
    id INTEGER PRIMARY KEY, production_id INTEGER NOT NULL REFERENCES production_orders(id), path TEXT NOT NULL,
    route_id INTEGER NOT NULL REFERENCES process_routes(id), route_version INTEGER NOT NULL, route_name TEXT NOT NULL,
    graph TEXT NOT NULL, UNIQUE(production_id,path));
    CREATE TABLE IF NOT EXISTS production_operation_reports (
    id INTEGER PRIMARY KEY, production_id INTEGER NOT NULL REFERENCES production_orders(id), route_snapshot_id INTEGER NOT NULL REFERENCES production_routes(id),
    node_id TEXT NOT NULL, quantity REAL NOT NULL CHECK(quantity>0), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','void')),
    worker_id INTEGER, worker_name TEXT NOT NULL, registered_by INTEGER, registered_by_name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, output_kind TEXT, output_batch_id INTEGER,
    void_reason TEXT NOT NULL DEFAULT '', voided_by_name TEXT NOT NULL DEFAULT '', voided_at TEXT,
    created_sequence INTEGER NOT NULL, voided_sequence INTEGER);
    CREATE INDEX IF NOT EXISTS operation_reports_route ON production_operation_reports(route_snapshot_id,id);
    CREATE INDEX IF NOT EXISTS operation_reports_order ON production_operation_reports(production_id,id);
    CREATE INDEX IF NOT EXISTS production_routes_source ON production_routes(route_id);
    INSERT OR IGNORE INTO app_metadata(key,value) VALUES ('process_route_version','0');`);
  for (const [table, column] of [['products', 'default_route_id'], ['boms', 'route_override_id']])
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column))
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} INTEGER REFERENCES process_routes(id)`);
  const advance = `UPDATE app_metadata SET value=MAX(CAST(value AS INTEGER),(SELECT COALESCE(MAX(version),0) FROM process_routes))+1 WHERE key='process_route_version';
    UPDATE process_routes SET version=(SELECT CAST(value AS INTEGER) FROM app_metadata WHERE key='process_route_version') WHERE id=NEW.id;`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS process_route_version_insert AFTER INSERT ON process_routes BEGIN ${advance} END;
    CREATE TRIGGER IF NOT EXISTS process_route_version_update AFTER UPDATE OF name,note,enabled,graph,updated_at ON process_routes BEGIN ${advance} END;`);
}

export function routeBinding(db, warehouseId, value, previous = null) {
  if (value === undefined) return previous;
  if (value === null) return null;
  if (!id(value)) fail('请选择有效工艺路线。');
  const route = db.prepare('SELECT enabled FROM process_routes WHERE id=? AND warehouse_id=?').get(value, warehouseId);
  if (!route) fail('工艺路线不存在或不属于当前仓库。');
  if (!route.enabled && value !== previous) fail('请选择已启用的工艺路线。');
  return value;
}

export function clearProcessRoutes(db, warehouseId) {
  if (warehouseId === undefined) {
    db.exec('UPDATE products SET default_route_id=NULL; UPDATE boms SET route_override_id=NULL; DELETE FROM process_routes;');
  } else {
    db.prepare('UPDATE products SET default_route_id=NULL WHERE warehouse_id=?').run(warehouseId);
    db.prepare('UPDATE boms SET route_override_id=NULL WHERE warehouse_id=?').run(warehouseId);
    db.prepare('DELETE FROM process_routes WHERE warehouse_id=?').run(warehouseId);
  }
}
export function deleteProductionOperations(db, productionId) {
  for (const table of ['production_operation_reports', 'production_routes']) {
    if (productionId === undefined) db.exec(`DELETE FROM ${table}`);
    else db.prepare(`DELETE FROM ${table} WHERE production_id=?`).run(productionId);
  }
}

export function installProcessRoutes(app, db, { operationRequest, saveOperationRequest }) {
  const get = (warehouseId, routeId) => {
    const row = db.prepare('SELECT * FROM process_routes WHERE id=? AND warehouse_id=?').get(Number(routeId), warehouseId);
    if (!row) fail('工艺路线不存在或不属于当前仓库。', 404);
    return { ...row, graph: parseGraph(row.graph), products: db.prepare('SELECT id,name FROM products WHERE default_route_id=? ORDER BY id').all(row.id),
      boms: db.prepare('SELECT id,name FROM boms WHERE route_override_id=? ORDER BY id').all(row.id) };
  };
  const route = (fn, write = false) => (req, res) => {
    try {
      if (!(write ? hasPermission(req.user, 'bom') : ['bom','products','production'].some(key => hasPermission(req.user, key)))) fail('需要工艺路线权限。', 403);
      if (write) db.exec('BEGIN IMMEDIATE');
      const request = write ? operationRequest(db, req) : null;
      const result = request?.previous || fn(req);
      if (write) { if (!request.previous) saveOperationRequest(db, request, result); db.exec('COMMIT'); }
      res.json(result);
    } catch (error) { if (write && db.isTransaction) db.exec('ROLLBACK'); res.status(error.status || 400).json({ error: error.message.includes('UNIQUE') ? '工艺路线名称已存在。' : error.message }); }
  };
  const save = req => {
    const old = req.params.id ? get(req.warehouse.id, req.params.id) : null, body = req.body;
    if (old && body.version !== old.version) fail('工艺路线已变化，请重新读取后核对。当前填写内容已保留。', 409);
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100 || typeof body.note !== 'string' || body.note.length > 1000 || ![0,1].includes(body.enabled)) fail('路线名称、说明或启用状态无效。');
    validateProcessGraph(body.graph);
    const at = new Date().toISOString();
    let routeId = old?.id;
    if (old) db.prepare('UPDATE process_routes SET name=?,note=?,enabled=?,graph=?,updated_by_name=?,updated_at=? WHERE id=?')
      .run(body.name.trim(), body.note, body.enabled, JSON.stringify(body.graph), actor(req), at, routeId);
    else routeId = Number(db.prepare('INSERT INTO process_routes(warehouse_id,name,note,enabled,graph,created_by_name,updated_by_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(req.warehouse.id, body.name.trim(), body.note, body.enabled, JSON.stringify(body.graph), actor(req), actor(req), at, at).lastInsertRowid);
    return get(req.warehouse.id, routeId);
  };
  app.get('/api/process-routes', route(req => {
    const { q = '', status = 'all', offset = '0', limit = '30' } = req.query;
    if (typeof q !== 'string' || q.length > 100 || !['all','enabled','disabled'].includes(status) || !/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset)) || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100) fail('工艺路线筛选或分页参数无效。');
    const clauses = ['warehouse_id=?'], params = [req.warehouse.id];
    if (status !== 'all') { clauses.push('enabled=?'); params.push(status === 'enabled' ? 1 : 0); }
    if (q.trim()) { clauses.push("name LIKE ? ESCAPE '\\'"); params.push(`%${q.trim().replace(/[\\%_]/g, c => `\\${c}`)}%`); }
    const where = clauses.join(' AND '), total = db.prepare(`SELECT COUNT(*) n FROM process_routes WHERE ${where}`).get(...params).n;
    const routes = db.prepare(`SELECT * FROM process_routes WHERE ${where} ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset))
      .map(row => ({ ...row, graph: parseGraph(row.graph), product_count: db.prepare('SELECT COUNT(*) n FROM products WHERE default_route_id=?').get(row.id).n, bom_count: db.prepare('SELECT COUNT(*) n FROM boms WHERE route_override_id=?').get(row.id).n }));
    return { routes, total, has_more: Number(offset) + routes.length < total };
  }));
  app.get('/api/process-routes/:id', route(req => get(req.warehouse.id, req.params.id)));
  app.post('/api/process-routes', route(save, true));
  app.post('/api/process-routes/:id', route(save, true));
  app.post('/api/process-routes/:id/status', route(req => {
    const current = get(req.warehouse.id, req.params.id);
    if (req.body.version !== current.version) fail('工艺路线已变化，请刷新后操作。', 409);
    if (![0,1].includes(req.body.enabled)) fail('启用状态无效。');
    db.prepare('UPDATE process_routes SET enabled=?,updated_by_name=?,updated_at=? WHERE id=?').run(req.body.enabled, actor(req), new Date().toISOString(), current.id);
    return get(req.warehouse.id, current.id);
  }, true));
}

export function captureProductionRoutes(db, order) {
  const layers = order.stage_workflow ? db.prepare('SELECT path,bom_id,product_id FROM production_stages WHERE production_id=?').all(order.id)
    : [{ path: '', bom_id: order.bom_id, product_id: order.product_id }];
  for (const layer of layers) {
    const binding = db.prepare('SELECT COALESCE(b.route_override_id,p.default_route_id) route_id FROM boms b JOIN products p ON p.id=b.product_id WHERE b.id=?').get(layer.bom_id);
    if (!binding?.route_id) continue;
    const route = db.prepare('SELECT * FROM process_routes WHERE id=? AND warehouse_id=?').get(binding.route_id, order.warehouse_id);
    if (!route?.enabled) fail('生产物料关联的工艺路线已停用，请先重新配置。', 409);
    parseGraph(route.graph);
    db.prepare('INSERT INTO production_routes(production_id,path,route_id,route_version,route_name,graph) VALUES (?,?,?,?,?,?)').run(order.id, layer.path, route.id, route.version, route.name, route.graph);
  }
}

export function readProductionRoutes(db, order) {
  order.operation_routes = db.prepare('SELECT * FROM production_routes WHERE production_id=? ORDER BY id').all(order.id).map(row => {
    const graph = parseGraph(row.graph), all = db.prepare('SELECT * FROM production_operation_reports WHERE route_snapshot_id=? ORDER BY id').all(row.id);
    return { ...row, graph, operations: processProgress(graph, all), reports: all.slice(-100).reverse(), report_count: all.length };
  });
}

function operationWorker(db, req, order) {
  const workerId = req.body.worker_id ?? req.user.id;
  if (!id(workerId)) fail('请选择有效作业员工。');
  const worker = db.prepare('SELECT id,name,username,active,production_group_id FROM users WHERE id=?').get(workerId);
  if (!worker?.active || workerId !== req.user.id && (!hasPermission(req.user, 'production') || !order.production_group_id || worker.production_group_id !== order.production_group_id)) fail('仅可选择本人或本单生产组的有效员工。', 403);
  return worker;
}
function operationInput(db, req, order, path, quantity, output) {
  const route = order.operation_routes?.find(r => r.path === path);
  if (!route) { if (req.body.operation_node_id !== undefined) fail('此生产层没有工艺路线。'); return null; }
  if (req.body.operation_schema_version !== 1) fail('此单使用工序登记，请刷新页面后按工序操作。', 409);
  const node = route.operations.find(n => n.id === req.body.operation_node_id);
  if (!node || node.is_output !== output) fail(output ? '请从最终产出工序登记产量和实际耗料。' : '最终工序请使用产出登记入口。');
  const layer = order.stages?.find(s => s.path === path) || order;
  const product = db.prepare('SELECT active,unit,unit_round_up FROM products WHERE id=? AND warehouse_id=?').get(layer.product_id,order.warehouse_id);
  if (!product?.active || product.unit !== layer.unit || product.unit_round_up !== layer.unit_round_up) fail('生产物料已停用、单位或取整规则已变化，请先核对。',409);
  if (!validQuantity(quantity, true) || layer.unit_round_up && !Number.isInteger(quantity)) fail('工序数量需为正数，最多 4 位小数，并符合物料取整规则。');
  if (!validQuantity(addQuantity(node.completed_quantity, quantity), true)) fail('工序累计数量超出范围。');
  if (node.available_quantity !== null && quantity > node.available_quantity) fail('前置工序可用数量不足，请先核对前序报工。', 409);
  if (typeof req.body.note !== 'string' && req.body.note !== undefined || (req.body.note?.length ?? 0) > 500) fail('工序说明最多 500 字。');
  if (db.prepare('SELECT COUNT(*) n FROM production_operation_reports WHERE production_id=?').get(order.id).n >= 10000) fail('每张生产单最多登记 10000 条工序记录。');
  return { route, node, worker: operationWorker(db, req, order) };
}
function nextOperationSequence(db, productionId) {
  return db.prepare('SELECT COALESCE(MAX(MAX(created_sequence,COALESCE(voided_sequence,0))),0)+1 value FROM production_operation_reports WHERE production_id=?').get(productionId).value;
}
function insertReport(db, req, order, input, quantity, kind = null, batchId = null) {
  if (!input) return;
  db.prepare(`INSERT INTO production_operation_reports(production_id,route_snapshot_id,node_id,quantity,worker_id,worker_name,registered_by,registered_by_name,note,created_at,output_kind,output_batch_id,created_sequence) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(order.id, input.route.id, input.node.id, quantity, input.worker.id, input.worker.name || input.worker.username, req.user.id, actor(req), req.body.note?.trim() || '', new Date().toISOString(), kind, batchId, nextOperationSequence(db, order.id));
}
export function recordOperationOutput(db, req, order, path, quantity, kind, batchId) {
  const input = operationInput(db, req, order, path, quantity, true);
  insertReport(db, req, order, input, quantity, kind, batchId);
  if (req.body.finish_order !== false) assertOperationsFinished(db, order.id);
}
export function voidOperationOutput(db, kind, batchId, owner, at, reason) {
  const report = db.prepare("SELECT production_id FROM production_operation_reports WHERE output_kind=? AND output_batch_id=? AND status='active'").get(kind,batchId);
  if (report) db.prepare("UPDATE production_operation_reports SET status='void',void_reason=?,voided_by_name=?,voided_at=?,voided_sequence=? WHERE output_kind=? AND output_batch_id=? AND status='active'").run(reason, owner, at, nextOperationSequence(db, report.production_id), kind, batchId);
}
export function assertOperationsFinished(db, productionId) {
  const order = { id: productionId }; readProductionRoutes(db, order);
  for (const route of order.operation_routes) {
    const output = route.operations.find(n => n.is_output).completed_quantity;
    if (route.operations.some(n => n.completed_quantity !== output)) fail('仍有工序在制数量，请完成流转或纠正错误报工后再结束生产。', 409);
  }
}

export function installProductionOperations(app, db, { route, current, version }) {
  app.get('/api/production-orders/:id/operation-workers', route(req => {
    const order = current(req);
    const workers = hasPermission(req.user, 'production') && order.production_group_id
      ? db.prepare('SELECT id,name,username FROM users WHERE active=1 AND (production_group_id=? OR id=?) ORDER BY id').all(order.production_group_id, req.user.id)
      : [{ id: req.user.id, name: req.user.name, username: req.user.username }];
    return { workers: workers.map(w => ({ id: w.id, name: w.name || w.username })) };
  }));
  app.get('/api/production-orders/:id/operations/reports', route(req => {
    const order = current(req), { snapshot_id, offset = '0', limit = '20' } = req.query;
    if (typeof snapshot_id !== 'string' || !/^\d+$/.test(snapshot_id) || !order.operation_routes.some(r => r.id === Number(snapshot_id)) ||
        typeof offset !== 'string' || !/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset)) || typeof limit !== 'string' || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100) fail('工序记录筛选或分页参数无效。');
    const total = db.prepare('SELECT COUNT(*) n FROM production_operation_reports WHERE production_id=? AND route_snapshot_id=?').get(order.id, Number(snapshot_id)).n;
    const reports = db.prepare('SELECT * FROM production_operation_reports WHERE production_id=? AND route_snapshot_id=? ORDER BY id DESC LIMIT ? OFFSET ?').all(order.id, Number(snapshot_id), Number(limit), Number(offset));
    return { reports, total, has_more: Number(offset) + reports.length < total };
  }));
  app.post('/api/production-orders/:id/operations/report', route(req => {
    const order = current(req); version(req, order);
    if (order.status !== 'in_progress') fail('仅生产中可以登记工序。', 409);
    if (typeof req.body.path !== 'string') fail('请选择生产层。');
    const input = operationInput(db, req, order, req.body.path, req.body.quantity, false);
    if (!input) fail('此生产层没有工艺路线。');
    insertReport(db, req, order, input, req.body.quantity);
    db.prepare('UPDATE production_orders SET updated_at=?,updated_by_name=? WHERE id=?').run(new Date().toISOString(), actor(req), order.id);
    return current(req);
  }, true));
  app.post('/api/production-orders/:id/operations/:reportId/void', route(req => {
    const order = current(req); version(req, order);
    if (!hasPermission(req.user, 'production') || !hasPermission(req.user, 'corrections')) fail('需要生产管理和单据纠正权限。', 403);
    if (order.status === 'void' || typeof req.body.reason !== 'string' || !req.body.reason.trim() || req.body.reason.length > 500) fail('请填写有效的工序作废原因。');
    const report = db.prepare('SELECT * FROM production_operation_reports WHERE id=? AND production_id=?').get(Number(req.params.reportId), order.id);
    if (!report || report.status !== 'active') fail('工序记录不存在或已作废。', 404);
    if (report.output_kind) fail('最终工序记录请通过对应产出批次作废。', 409);
    const snapshot = order.operation_routes.find(r => r.id === report.route_snapshot_id);
    const remaining = processProgress(snapshot.graph, db.prepare("SELECT * FROM production_operation_reports WHERE route_snapshot_id=? AND id!=?").all(snapshot.id, report.id));
    for (const node of remaining) for (const parent of node.predecessors)
      if (node.completed_quantity > remaining.find(n => n.id === parent).completed_quantity) fail('后序已有报工，请先作废依赖的后序记录。', 409);
    const at = new Date().toISOString();
    db.prepare("UPDATE production_operation_reports SET status='void',void_reason=?,voided_by_name=?,voided_at=?,voided_sequence=? WHERE id=?").run(req.body.reason.trim(), actor(req), at, nextOperationSequence(db, order.id), report.id);
    db.prepare("UPDATE production_orders SET status='draft',updated_at=?,updated_by_name=? WHERE id=?").run(at, actor(req), order.id);
    return current(req);
  }, true));
}

export function validateProcessRouteBackup(data) {
  const routes = new Map(data.process_routes.map(row => [row.id, row])), orders = new Map(data.production_orders.map(row => [row.id, row]));
  const warehouses = new Set(data.warehouses.map(row => row.id)), snapshots = new Map();
  const text = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || !!value.trim());
  const association = value => value === null || id(value);
  const names = new Set();
  for (const row of routes.values()) {
    if (!warehouses.has(row.warehouse_id) || !text(row.name, 100, true) || !text(row.note, 1000) || ![0,1].includes(row.enabled) || !id(row.version) ||
        !text(row.created_by_name, 100, true) || !text(row.updated_by_name, 100, true) || !Number.isFinite(Date.parse(row.created_at)) || !Number.isFinite(Date.parse(row.updated_at)) || names.has(`${row.warehouse_id}:${row.name}`)) fail('备份工艺路线无效。');
    names.add(`${row.warehouse_id}:${row.name}`); parseGraph(row.graph);
  }
  for (const [table, column] of [['products','default_route_id'], ['boms','route_override_id']]) for (const row of data[table]) {
    if (!association(row[column]) || row[column] !== null && routes.get(row[column])?.warehouse_id !== row.warehouse_id) fail('备份工艺路线绑定跨仓或无效。');
  }
  const keys = new Set();
  for (const row of data.production_routes) {
    const order = orders.get(row.production_id), key = `${row.production_id}:${row.path}`;
    if (!order || routes.get(row.route_id)?.warehouse_id !== order.warehouse_id || !id(row.route_version) || !text(row.route_name, 100, true) || typeof row.path !== 'string' || keys.has(key) ||
        (order.stage_workflow ? !data.production_stages.some(s => s.production_id === order.id && s.path === row.path) : row.path !== '')) fail('备份生产工艺快照无效。');
    keys.add(key); snapshots.set(row.id, { ...row, graph: parseGraph(row.graph), reports: [] });
  }
  const outputs = new Set();
  for (const row of data.production_operation_reports) {
    const snapshot = snapshots.get(row.route_snapshot_id), order = orders.get(row.production_id);
    if (!snapshot || snapshot.production_id !== row.production_id || !order || !validQuantity(row.quantity, true) || !['active','void'].includes(row.status) ||
        !association(row.worker_id) || !association(row.registered_by) || !text(row.worker_name,100,true) || !text(row.registered_by_name,100,true) || !text(row.note,500) ||
        !Number.isFinite(Date.parse(row.created_at)) || !id(row.created_sequence) || !text(row.void_reason,500) || !text(row.voided_by_name,100) ||
        (row.status === 'active' ? row.voided_sequence !== null || row.voided_at !== null || row.void_reason !== '' || row.voided_by_name !== '' : !id(row.voided_sequence) || row.voided_sequence <= row.created_sequence || !row.void_reason.trim() || !row.voided_by_name.trim() || !Number.isFinite(Date.parse(row.voided_at)) || row.voided_at < row.created_at)) fail('备份工序登记无效。');
    const node = snapshot.graph.nodes.find(n => n.id === row.node_id), output = validateProcessGraph(snapshot.graph).output;
    if (!node) fail('备份工序登记节点无效。');
    const layer = order.stage_workflow ? data.production_stages.find(s => s.production_id === order.id && s.path === snapshot.path) : order;
    if (layer.unit_round_up && !Number.isInteger(row.quantity)) fail('备份工序数量不符合物料取整规则。');
    if (row.node_id === output) {
      const kind = order.stage_workflow ? 'stage' : 'batch', batch = (kind === 'stage' ? data.production_stage_batches : data.production_batches).find(b => b.id === row.output_batch_id);
      const key = `${kind}:${row.output_batch_id}`;
      if (row.output_kind !== kind || !batch || batch.production_id !== order.id || (kind === 'stage' && batch.path !== snapshot.path) || batch.completed_quantity !== row.quantity || batch.status !== row.status || outputs.has(key)) fail('备份最终工序与产出批次不一致。');
      outputs.add(key);
    } else if (row.output_kind !== null || row.output_batch_id !== null) fail('中间工序不能关联产出批次。');
    snapshot.reports.push(row);
  }
  // Persisted event sequences make same-millisecond registrations and corrections
  // unambiguous. Replay every route so balanced current totals cannot hide an
  // output that was reported before its predecessors existed.
  const sequences = new Map();
  for (const snapshot of snapshots.values()) {
    const events = snapshot.reports.flatMap(report => [{ sequence: report.created_sequence, report, create: true }, ...(report.status === 'void' ? [{ sequence: report.voided_sequence, report, create: false }] : [])]).sort((a,b) => a.sequence - b.sequence);
    const used = sequences.get(snapshot.production_id) || new Set(); sequences.set(snapshot.production_id,used);
    const active = new Map();
    for (const event of events) {
      if (used.has(event.sequence)) fail('备份工序事件顺序无效。'); used.add(event.sequence);
      if (event.create) active.set(event.report.id,{ ...event.report,status:'active' }); else active.delete(event.report.id);
      const progress = processProgress(snapshot.graph,[...active.values()]);
      for (const node of progress) for (const parent of node.predecessors)
        if (node.completed_quantity > progress.find(n => n.id === parent).completed_quantity) fail('备份工序事件顺序无效。');
    }
  }
  for (const snapshot of snapshots.values()) {
    const order = orders.get(snapshot.production_id), operations = processProgress(snapshot.graph, snapshot.reports);
    if (operations.some(n => !validQuantity(n.completed_quantity))) fail('备份工序累计数量无效。');
    for (const node of operations) for (const parent of node.predecessors) if (node.completed_quantity > operations.find(n => n.id === parent).completed_quantity) fail('备份工序前后数量不守恒。');
    const kind = order.stage_workflow ? 'stage' : 'batch';
    for (const batch of (kind === 'stage' ? data.production_stage_batches : data.production_batches).filter(b => b.production_id === order.id && (kind !== 'stage' || b.path === snapshot.path)))
      if (!outputs.has(`${kind}:${batch.id}`)) fail('备份产出批次缺少最终工序记录。');
    if (order.status === 'completed' && operations.some(n => n.completed_quantity !== operations.find(n => n.is_output).completed_quantity) ||
        order.status === 'void' && operations.some(n => n.completed_quantity !== 0)) fail('备份已结束生产单仍有工序在制数量。');
  }
}
