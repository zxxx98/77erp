import { migrateSortOrder, nextTopOrder, reorderRows } from './custom-order.js';
import { saveOperationAcceptance, acceptancePermissionMessage, validateOperationRegistrationBackup } from './operation-acceptance.js';
import { operationAllocation } from '../shared/operation-overflow.js';
import { productionPools, stagePoolPaths, productionPoolOrder } from '../shared/production-pools.js';
import { isProductionAssignee } from '../shared/production-assignment.js';
import { hasPermission } from '../shared/permissions.js';
import { validQuantity, addQuantity } from '../shared/quantity.js';
import { exactQuantity, exactAdd, exactSubtract, exactMultiply, exactDivide, exactCompare, exactNumber, quantityFields, parseProductionQuantity as parseExactQuantity, validExactQuantity } from '../shared/exact-quantity.js';
import { allocate } from './commerce.js';
import { saveExactQuantity } from './exact-quantity.js';
import { reopenProductionQuantities } from './production-rounding.js';
import { validateProcessGraph, processProgress, productionRouteProgress, processGraphWithPrices, processPriceTables } from '../shared/process-routes.js';
import { validateOperationPrice } from '../shared/payroll.js';
import { postProcessingLimit, postProcessingUnit, productionOutputCompleted } from '../shared/post-processing.js';
import { productionTypes } from '../shared/product-production-type.js';
import { normalizePostMaterials, planPostMaterials, postMaterialPlanByProduct, totalPlannedMaterials, savePostMaterialItems, consumePostMaterials, readPostMaterialReport, postMaterialUsage, sumPostMaterialCosts, validatePostMaterialGraph, validatePostMaterialReport, stripLegacyPostMaterials } from './post-processing-materials.js';

export const processRouteTables = ['process_routes'];
export const productionOperationTables = ['production_routes', 'production_operation_reports', 'production_operation_registrations'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const routeKinds = ['production', 'post_processing'];
const id = value => Number.isSafeInteger(value) && value > 0;
const actor = req => req.operationRegistrar?.registered_by_name || req.user.name || req.user.username;
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
  if (!db.prepare('PRAGMA table_info(production_operation_reports)').all().some(c => c.name === 'acceptance_id'))
    db.exec('ALTER TABLE production_operation_reports ADD COLUMN acceptance_id INTEGER REFERENCES quality_acceptances(id)');
  if (!db.prepare('PRAGMA table_info(production_operation_reports)').all().some(c => c.name === 'multiplier'))
    db.exec('ALTER TABLE production_operation_reports ADD COLUMN multiplier REAL NOT NULL DEFAULT 1 CHECK(multiplier>0)');
  if (!db.prepare('PRAGMA table_info(production_operation_reports)').all().some(c => c.name === 'split_from_id'))
    db.exec('ALTER TABLE production_operation_reports ADD COLUMN split_from_id INTEGER REFERENCES production_operation_reports(id)');
  if (!db.prepare('PRAGMA table_info(process_routes)').all().some(c => c.name === 'route_kind'))
    db.exec("ALTER TABLE process_routes ADD COLUMN route_kind TEXT NOT NULL DEFAULT 'production' CHECK(route_kind IN ('production','post_processing'))");
  if (!db.prepare('PRAGMA table_info(production_routes)').all().some(c => c.name === 'product_coefficient'))
    db.exec('ALTER TABLE production_routes ADD COLUMN product_coefficient REAL CHECK(product_coefficient>0)');
  for (const [table, column] of [['production_routes', 'additional_quantity'], ['production_routes', 'additional_materials'], ['production_operation_reports', 'material_items']])
    if (db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column))
      db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  if (!db.prepare('PRAGMA table_info(production_operation_reports)').all().some(c => c.name === 'post_materials')) {
    db.exec('SAVEPOINT migrate_post_materials');
    try {
      db.exec("ALTER TABLE production_operation_reports ADD COLUMN post_materials TEXT NOT NULL DEFAULT '[]'");
      for (const table of ['process_routes', 'production_routes']) {
        const update = db.prepare(`UPDATE ${table} SET graph=? WHERE id=?`);
        for (const row of db.prepare(`SELECT id,graph FROM ${table} WHERE graph LIKE '%"materials"%'`).all()) {
          const graph = stripLegacyPostMaterials(row.graph);
          if (graph !== row.graph) update.run(graph, row.id);
        }
      }
      db.exec('RELEASE migrate_post_materials');
    } catch (error) {
      db.exec('ROLLBACK TO migrate_post_materials; RELEASE migrate_post_materials');
      throw error;
    }
  }
  db.exec(`CREATE TABLE IF NOT EXISTS production_operation_registrations (
    id INTEGER PRIMARY KEY, production_id INTEGER NOT NULL REFERENCES production_orders(id),
    path TEXT NOT NULL, node_id TEXT NOT NULL, endpoint TEXT NOT NULL, body TEXT NOT NULL,
    registered_by INTEGER, registered_by_name TEXT NOT NULL, worker_id INTEGER, worker_name TEXT NOT NULL,
    production_group_id INTEGER, production_group_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','void')),
    acceptance_id INTEGER REFERENCES quality_acceptances(id), resolved_by_name TEXT NOT NULL DEFAULT '', resolved_at TEXT);
    CREATE INDEX IF NOT EXISTS operation_registrations_order ON production_operation_registrations(production_id,status,id);`);
  if (!db.prepare('PRAGMA table_info(production_operation_registrations)').all().some(c => c.name === 'kind'))
    db.exec("ALTER TABLE production_operation_registrations ADD COLUMN kind TEXT NOT NULL DEFAULT 'acceptance' CHECK(kind IN ('acceptance','settlement'))");
  if (!db.prepare('PRAGMA table_info(production_operation_registrations)').all().some(c => c.name === 'initial_issues'))
    db.exec("ALTER TABLE production_operation_registrations ADD COLUMN initial_issues TEXT NOT NULL DEFAULT '[]'");
  db.exec('CREATE INDEX IF NOT EXISTS operation_reports_acceptance ON production_operation_reports(acceptance_id,status)');
  for (const [table, column] of [['products', 'default_route_id'], ['boms', 'route_override_id']])
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column))
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} INTEGER REFERENCES process_routes(id)`);
  if (!db.prepare('PRAGMA table_info(boms)').all().some(c => c.name === 'route_price_table_id'))
    db.exec('ALTER TABLE boms ADD COLUMN route_price_table_id TEXT');
  migrateSortOrder(db, 'process_routes');
  const advance = `UPDATE app_metadata SET value=MAX(CAST(value AS INTEGER),(SELECT COALESCE(MAX(version),0) FROM process_routes))+1 WHERE key='process_route_version';
    UPDATE process_routes SET version=(SELECT CAST(value AS INTEGER) FROM app_metadata WHERE key='process_route_version') WHERE id=NEW.id;`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS process_route_version_insert AFTER INSERT ON process_routes BEGIN ${advance} END;
    DROP TRIGGER IF EXISTS process_route_version_update;
    CREATE TRIGGER process_route_version_update AFTER UPDATE OF name,note,enabled,graph,updated_at,route_kind ON process_routes BEGIN ${advance} END;`);
}

export function routeBinding(db, warehouseId, value, previous = null) {
  if (value === undefined) return previous;
  if (value === null) return null;
  if (!id(value)) fail('请选择有效工艺路线。');
  const route = db.prepare('SELECT enabled,route_kind FROM process_routes WHERE id=? AND warehouse_id=?').get(value, warehouseId);
  if (!route) fail('工艺路线不存在或不属于当前仓库。');
  if (route.route_kind !== 'production') fail('物料和BOM只能绑定生产工艺。');
  if (!route.enabled && value !== previous) fail('请选择已启用的工艺路线。');
  return value;
}

export function routePriceBinding(db, warehouseId, routeId, tableId) {
  if (tableId == null) return null;
  const route = routeId == null ? null : db.prepare('SELECT graph FROM process_routes WHERE id=? AND warehouse_id=?').get(routeId, warehouseId);
  if (typeof tableId !== 'string' || !route) fail('请选择有效工艺路线及单价表。');
  processGraphWithPrices(parseGraph(route.graph), tableId);
  return tableId === 'default' ? null : tableId;
}

export function clearProcessRoutes(db, warehouseId) {
  if (warehouseId === undefined) {
    db.exec('UPDATE products SET default_route_id=NULL; UPDATE boms SET route_override_id=NULL,route_price_table_id=NULL; DELETE FROM process_routes;');
  } else {
    db.prepare('UPDATE products SET default_route_id=NULL WHERE warehouse_id=?').run(warehouseId);
    db.prepare('UPDATE boms SET route_override_id=NULL,route_price_table_id=NULL WHERE warehouse_id=?').run(warehouseId);
    db.prepare('DELETE FROM process_routes WHERE warehouse_id=?').run(warehouseId);
  }
}
export function deleteProductionOperations(db, productionId) {
  for (const table of ['production_operation_registrations', 'production_operation_reports', 'production_routes']) {
    if (productionId === undefined) db.exec(`DELETE FROM ${table}`);
    else db.prepare(`DELETE FROM ${table} WHERE production_id=?`).run(productionId);
  }
}

const ROUTE_SORTS = {
  custom: 'sort_order ASC,id DESC',
  updated_desc: 'updated_at DESC,id DESC', updated_asc: 'updated_at ASC,id ASC',
  created_desc: 'created_at DESC,id DESC', created_asc: 'created_at ASC,id ASC',
  name_asc: 'name COLLATE NOCASE ASC,id ASC', name_desc: 'name COLLATE NOCASE DESC,id DESC',
};

export function listProcessRoutes(db, warehouseId, query = {}) {
  const { q = '', status = 'all', sort = 'custom', production_type = 'all', route_kind = 'all', offset = '0', limit = '30' } = query;
  if (typeof q !== 'string' || q.length > 100 || !['all', 'enabled', 'disabled'].includes(status) ||
      typeof sort !== 'string' || !Object.hasOwn(ROUTE_SORTS, sort) ||
      !['all', ...routeKinds].includes(route_kind) ||
      !['all', 'unset', '', ...productionTypes].includes(production_type) ||
      typeof offset !== 'string' || !/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset)) ||
      typeof limit !== 'string' || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100)
    fail('工艺路线筛选或分页参数无效。');
  const linkedProductSql = '(p.default_route_id=process_routes.id OR EXISTS (SELECT 1 FROM boms b WHERE b.warehouse_id=process_routes.warehouse_id AND b.product_id=p.id AND b.route_override_id=process_routes.id))';
  const clauses = ['warehouse_id=?'], params = [warehouseId];
  if (route_kind !== 'all') { clauses.push('route_kind=?'); params.push(route_kind); }
  if (status !== 'all') { clauses.push('enabled=?'); params.push(status === 'enabled' ? 1 : 0); }
  if (productionTypes.includes(production_type)) {
    clauses.push(`EXISTS (SELECT 1 FROM products p WHERE p.warehouse_id=process_routes.warehouse_id AND ${linkedProductSql} AND p.production_type=?)`);
    params.push(production_type);
  } else if (production_type === 'unset' || production_type === '') {
    clauses.push(`(EXISTS (SELECT 1 FROM products p WHERE p.warehouse_id=process_routes.warehouse_id AND ${linkedProductSql} AND p.production_type='') OR NOT EXISTS (SELECT 1 FROM products p WHERE p.warehouse_id=process_routes.warehouse_id AND ${linkedProductSql}))`);
  }
  if (q.trim()) {
    const trimmed = q.trim(), like = `%${trimmed.replace(/[\\%_]/g, c => `\\${c}`)}%`, exactId = trimmed.replace(/^#/, '');
    const typeSql = productionTypes.includes(production_type) ? ' AND p.production_type=?' : (production_type === 'unset' || production_type === '') ? " AND p.production_type=''" : '';
    clauses.push(`(name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM products p WHERE p.warehouse_id=process_routes.warehouse_id AND ${linkedProductSql}${typeSql} AND (p.name LIKE ? ESCAPE '\\' OR p.barcode LIKE ? ESCAPE '\\' OR CAST(p.id AS TEXT)=?)))`);
    params.push(like, ...(productionTypes.includes(production_type) ? [production_type] : []), like, like, exactId);
  }
  const where = clauses.join(' AND '), total = db.prepare(`SELECT COUNT(*) n FROM process_routes WHERE ${where}`).get(...params).n;
  const productStmt = db.prepare(`SELECT DISTINCT p.id,p.name,p.barcode,p.production_type FROM products p WHERE p.warehouse_id=? AND (p.default_route_id=? OR EXISTS (SELECT 1 FROM boms b WHERE b.warehouse_id=p.warehouse_id AND b.product_id=p.id AND b.route_override_id=?)) ORDER BY p.id`);
  const routes = db.prepare(`SELECT * FROM process_routes WHERE ${where} ORDER BY ${ROUTE_SORTS[sort]} LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset))
    .map(row => ({ ...row, graph: parseGraph(row.graph), products: productStmt.all(warehouseId, row.id, row.id), product_count: db.prepare('SELECT COUNT(*) n FROM products WHERE default_route_id=?').get(row.id).n, bom_count: db.prepare("SELECT COUNT(*) n FROM boms WHERE route_override_id=? OR EXISTS (SELECT 1 FROM json_each(boms.post_processing_operations) p WHERE json_extract(p.value,'$.route_id')=?)").get(row.id, row.id).n }));
  return { routes, total, has_more: Number(offset) + routes.length < total };
}

export function installProcessRoutes(app, db, { operationRequest, saveOperationRequest }) {
  const get = (warehouseId, routeId) => {
    const row = db.prepare('SELECT * FROM process_routes WHERE id=? AND warehouse_id=?').get(Number(routeId), warehouseId);
    if (!row) fail('工艺路线不存在或不属于当前仓库。', 404);
    return { ...row, graph: parseGraph(row.graph), products: db.prepare('SELECT id,name,barcode,production_type FROM products WHERE default_route_id=? ORDER BY id').all(row.id),
      boms: db.prepare("SELECT id,name FROM boms WHERE route_override_id=? OR EXISTS (SELECT 1 FROM json_each(boms.post_processing_operations) p WHERE json_extract(p.value,'$.route_id')=?) ORDER BY id").all(row.id, row.id) };
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
    const kind = body.route_kind === undefined ? old?.route_kind ?? 'production' : body.route_kind;
    if (!routeKinds.includes(kind)) fail('请选择有效的工艺类型。');
    if (old && old.route_kind !== kind && (old.products.length || old.boms.length ||
        db.prepare('SELECT 1 FROM production_routes WHERE route_id=? LIMIT 1').get(old.id)))
      fail('工艺已被引用，不能变更工艺类型。', 409);
    validateProcessGraph(body.graph);
    const { product_coefficient, price_table_id, price_table_name, post_processing_materials_per_unit, ...graph } = body.graph;
    // Older clients preserve additional tables when saving unchanged topology.
    if (graph.price_tables === undefined && old?.graph.price_tables) graph.price_tables = old.graph.price_tables;
    validateProcessGraph(graph);
    if (old) {
      const tableIds = new Set(processPriceTables(graph).map(table => table.id));
      const bindings = db.prepare('SELECT b.route_price_table_id FROM boms b JOIN products p ON p.id=b.product_id WHERE COALESCE(b.route_override_id,p.default_route_id)=?').all(old.id);
      const postBindings = db.prepare("SELECT p.value FROM boms b, json_each(b.post_processing_operations) p WHERE json_extract(p.value,'$.route_id')=?").all(old.id).map(row => JSON.parse(row.value));
      if (postBindings.some(row => row.price_table_id != null && !tableIds.has(row.price_table_id))) fail('单价表已被BOM后处理引用，请先更换BOM关联的单价表。', 409);
      if (bindings.some(row => row.route_price_table_id != null && !tableIds.has(row.route_price_table_id))) fail('单价表已被BOM引用，请先更换BOM关联的单价表。', 409);
    }
    body.graph = {...graph,nodes:graph.nodes.map(({acceptance_revision_id,acceptance_template_name,product_coefficient,materials,...node})=>{
      if(node.acceptance_template_id) {
        const template=db.prepare('SELECT enabled,published_revision FROM quality_templates WHERE id=? AND warehouse_id=?').get(node.acceptance_template_id,req.warehouse.id);
        if(!template?.enabled || !template.published_revision) fail('请选择当前仓库已启用且已发布的验收模板。');
      }
      const fixed = normalizePostMaterials(db, req.warehouse.id, materials, kind === 'post_processing');
      return fixed.length ? { ...node, materials: fixed } : node;
    })};
    const at = new Date().toISOString();
    let routeId = old?.id;
    if (old) db.prepare('UPDATE process_routes SET name=?,note=?,enabled=?,graph=?,updated_by_name=?,updated_at=?,route_kind=? WHERE id=?')
      .run(body.name.trim(), body.note, body.enabled, JSON.stringify(body.graph), actor(req), at, kind, routeId);
    else routeId = Number(db.prepare('INSERT INTO process_routes(warehouse_id,name,note,enabled,graph,created_by_name,updated_by_name,created_at,updated_at,route_kind,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,' + nextTopOrder('process_routes') + ')')
      .run(req.warehouse.id, body.name.trim(), body.note, body.enabled, JSON.stringify(body.graph), actor(req), actor(req), at, at, kind, req.warehouse.id).lastInsertRowid);
    return get(req.warehouse.id, routeId);
  };
  app.get('/api/process-routes', route(req => listProcessRoutes(db, req.warehouse.id, req.query)));
  app.post('/api/process-routes/reorder', route(req => reorderRows(db, 'process_routes', req.warehouse.id, req.body.ids, fail, '工艺路线'), true));
  app.get('/api/process-routes/acceptance-templates', route(req => ({templates:db.prepare(`SELECT t.id,r.name,r.revision FROM quality_templates t JOIN quality_template_revisions r ON r.id=t.published_revision WHERE t.warehouse_id=? AND t.enabled=1 ORDER BY r.name,t.id`).all(req.warehouse.id)})));
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
  app.post('/api/process-routes/:id/delete', route(req => {
    const current = get(req.warehouse.id, req.params.id);
    if (req.body.version !== current.version) fail('工艺路线已变化，请刷新后操作。', 409);
    if (current.products.length) fail('此工艺路线已被物料引用，请先解除关联，或改为停用。', 409);
    if (current.boms.length) fail('此工艺路线已被BOM引用，请先解除关联，或改为停用。', 409);
    if (db.prepare('SELECT 1 FROM production_routes WHERE route_id=? LIMIT 1').get(current.id))
      fail('此工艺路线已被生产单引用，不能删除，可改为停用。', 409);
    db.prepare('DELETE FROM process_routes WHERE id=?').run(current.id);
    return { ok: true };
  }, true));
}

function captureAcceptanceVersions(db, graph, warehouseId) {
  for (const node of graph.nodes) if (node.acceptance_template_id) {
    const template = db.prepare('SELECT t.enabled,t.published_revision,r.name FROM quality_templates t LEFT JOIN quality_template_revisions r ON r.id=t.published_revision WHERE t.id=? AND t.warehouse_id=?').get(node.acceptance_template_id, warehouseId);
    if (!template?.enabled || !template.published_revision) fail('工序绑定的验收模板已停用或未发布，请先重新配置。', 409);
    node.acceptance_revision_id = template.published_revision; node.acceptance_template_name = template.name;
  }
}

export function capturePostProcessingOperations(db, order, operations = [], { bomMaterials = false } = {}) {
  if (!Array.isArray(operations) || operations.length > 50) fail('后处理工序最多 50 道。');
  const seen = new Set();
  for (const [index, input] of operations.entries()) {
    if (!input || !id(input.route_id) || !id(input.route_version) || typeof input.node_id !== 'string' || !validQuantity(input.product_coefficient, true))
      fail('请选择有效后处理工序并填写正数成品系数，最多 4 位小数。');
    const key = JSON.stringify([input.route_id, input.node_id]);
    if (seen.has(key)) fail('同一道后处理工序不能重复添加。');
    seen.add(key);
    const route = db.prepare('SELECT * FROM process_routes WHERE id=? AND warehouse_id=?').get(input.route_id, order.warehouse_id);
    if (!route?.enabled || route.route_kind !== 'post_processing') fail('请选择当前仓库已启用的后处理工艺。');
    if (route.version !== input.route_version) fail('后处理工艺已变化，请重新选择后保存。', 409);
    const selectedGraph = processGraphWithPrices(parseGraph(route.graph), input.price_table_id);
    const node = selectedGraph.nodes.find(node => node.id === input.node_id);
    if (!node) fail('所选后处理工序不存在。');
    const materials = normalizePostMaterials(db, order.warehouse_id, bomMaterials && input.usage_basis !== 'material' ? input.materials : node.materials, true);
    const graph = { ...selectedGraph, nodes: [materials.length ? { ...node, materials } : node], edges: [],
      ...(bomMaterials && input.usage_basis === 'material' && materials.length ? { post_processing_materials_per_unit: input.materials } : {}) };
    savePostMaterialItems(db, order, materials);
    captureAcceptanceVersions(db, graph, order.warehouse_id);
    db.prepare('INSERT INTO production_routes(production_id,path,route_id,route_version,route_name,graph,product_coefficient) VALUES (?,?,?,?,?,?,?)')
      .run(order.id, `@post:${index + 1}`, route.id, route.version, route.name, JSON.stringify(graph), input.product_coefficient);
  }
}

export function captureProductionRoutes(db, order) {
  const layers = order.stage_workflow ? db.prepare('SELECT path,bom_id,product_id FROM production_stages WHERE production_id=?').all(order.id)
    : [{ path: '', bom_id: order.bom_id, product_id: order.product_id }];
  for (const layer of layers) {
    const binding = db.prepare('SELECT COALESCE(b.route_override_id,p.default_route_id) route_id,b.route_price_table_id FROM boms b JOIN products p ON p.id=b.product_id WHERE b.id=?').get(layer.bom_id);
    if (!binding?.route_id) continue;
    const route = db.prepare('SELECT * FROM process_routes WHERE id=? AND warehouse_id=?').get(binding.route_id, order.warehouse_id);
    if (!route?.enabled) fail('生产物料关联的工艺路线已停用，请先重新配置。', 409);
    if (route.route_kind !== 'production') fail('物料和BOM只能绑定生产工艺。');
    const graph=processGraphWithPrices(parseGraph(route.graph), binding.route_price_table_id);
    captureAcceptanceVersions(db, graph, order.warehouse_id);
    db.prepare('INSERT INTO production_routes(production_id,path,route_id,route_version,route_name,graph) VALUES (?,?,?,?,?,?)').run(order.id, layer.path, route.id, route.version, route.name, JSON.stringify(graph));
  }
}

export function readProductionRoutes(db, order) {
  order.output_completed = productionOutputCompleted(order);
  order.output_completion_confirmed = Boolean(order.output_completion_confirmed);
  order.operation_routes = db.prepare('SELECT * FROM production_routes WHERE production_id=? ORDER BY id').all(order.id).map(row => {
    const graph = parseGraph(row.graph), all = db.prepare('SELECT * FROM production_operation_reports WHERE route_snapshot_id=? ORDER BY id').all(row.id);
    const isPost = row.product_coefficient != null;
    const post = !isPost ? {} : {
      ...planPostMaterials(graph, order.planned_quantity, row.product_coefficient),
      post_processing_limit: postProcessingLimit(order.status === 'void' ? 0 : exactQuantity(order, 'completed_quantity'), row.product_coefficient, order.output_completed, graph),
      unit: postProcessingUnit,
    };
    const route = { ...row, ...post, graph };
    return { ...route, operations: productionRouteProgress(route, all), reports: all.slice(-100).reverse().map(report => readPostMaterialReport(report, graph, isPost)), report_count: all.length };
  });
  for (const group of productionPools(order)) {
    if (group.length < 2) continue;
    const routes = order.operation_routes.filter(r => group.some(s => s.path === r.path));
    const ids = new Set(routes.map(r => r.id));
    const reports = db.prepare('SELECT * FROM production_operation_reports WHERE production_id=? ORDER BY id').all(order.id).filter(r => ids.has(r.route_snapshot_id));
    for (const route of routes) Object.assign(route, { operations: processProgress(route.graph, reports), reports: reports.slice(-100).reverse().map(report => readPostMaterialReport(report, route.graph, false)), report_count: reports.length });
  }
}

export function readPostMaterialUsage(db, orderId) {
  return postMaterialUsage(db.prepare("SELECT status,post_materials FROM production_operation_reports WHERE production_id=? AND status='active' AND post_materials!='[]'").all(orderId));
}

export function syncProductionOperationPrices(db, req, order) {
  if (order.status === 'void') fail('生产单已经作废。', 409);
  const productionRoutes = db.prepare('SELECT * FROM production_routes WHERE production_id=? ORDER BY id').all(order.id);
  if (!productionRoutes.length) fail('此生产单没有关联工艺路线。');
  let updatedCount = 0;
  for (const pr of productionRoutes) {
    const route = db.prepare('SELECT * FROM process_routes WHERE id=? AND warehouse_id=?').get(pr.route_id, req.warehouse.id);
    if (!route) continue;
    const snapshotGraph = parseGraph(pr.graph);
    const sourceGraph = processGraphWithPrices(parseGraph(route.graph), snapshotGraph.price_table_id);
    const tableRenamed = snapshotGraph.price_table_id && snapshotGraph.price_table_name !== sourceGraph.price_table_name;
    if (snapshotGraph.price_table_id) snapshotGraph.price_table_name = sourceGraph.price_table_name;
    let changed = false;
    for (const node of snapshotGraph.nodes || []) {
      const sourceNode = (sourceGraph.nodes || []).find(n => n.id === node.id)
        || (sourceGraph.nodes || []).find(n => n.name === node.name);
      if (!sourceNode) continue;
      const newPrice = sourceNode.unit_price ?? null;
      const newCurrency = sourceNode.currency ?? null;
      const newMultiplier = sourceNode.multiplier ?? 1;
      const oldPrice = node.unit_price ?? null;
      const oldCurrency = node.currency ?? null;
      const oldMultiplier = node.multiplier ?? 1;
      if (newPrice !== oldPrice || newCurrency !== oldCurrency || newMultiplier !== oldMultiplier) {
        validateOperationPrice({ unit_price: newPrice, currency: newCurrency, multiplier: newMultiplier });
        if (newPrice != null) {
          node.unit_price = newPrice;
          node.currency = newCurrency;
        } else {
          delete node.unit_price;
          delete node.currency;
        }
        if (sourceNode.multiplier !== undefined) node.multiplier = newMultiplier;
        else delete node.multiplier;
        db.prepare('UPDATE production_operation_reports SET multiplier=? WHERE route_snapshot_id=? AND node_id=?')
          .run(newMultiplier, pr.id, node.id);
        changed = true;
        updatedCount++;
      }
    }
    if (changed || tableRenamed || route.name !== pr.route_name) {
      db.prepare('UPDATE production_routes SET route_name=?, graph=? WHERE id=?')
        .run(route.name, JSON.stringify(snapshotGraph), pr.id);
    }
  }
  db.prepare('UPDATE production_orders SET updated_at=?,updated_by_name=? WHERE id=?')
    .run(new Date().toISOString(), actor(req), order.id);
  return { updatedCount };
}

function operationWorker(db, req, order) {
  if (req.operationRegistrar) return {id:req.operationRegistrar.worker_id,name:req.operationRegistrar.worker_name};
  const workerId = req.body.worker_id ?? req.user.id;
  if (!id(workerId)) fail('请选择有效作业员工。');
  const worker = db.prepare('SELECT id,name,username,active,production_group_id FROM users WHERE id=?').get(workerId);
  if (!worker?.active || workerId !== req.user.id && (!hasPermission(req.user, 'production') || !isProductionAssignee(worker, order))) fail('仅可选择本人或本单已指派的有效员工。', 403);
  return worker;
}
export function operationInput(db, req, order, path, quantity, output) {
  const route = order.operation_routes?.find(r => r.path === path);
  if (!route) { if (req.body.operation_node_id !== undefined) fail('此生产层没有工艺路线。'); operationWorker(db,req,order); return null; }
  if (req.body.operation_schema_version !== 1) fail('此单使用工序登记，请刷新页面后按工序操作。', 409);
  const node = route.operations.find(n => n.id === req.body.operation_node_id);
  if (!node || node.is_output !== output) fail(output ? '请从最终产出工序登记产量和实际耗料。' : '最终工序请使用产出登记入口。');
  if (node.acceptance_template_id && !req.validatingRegistration && !req.settledAcceptanceId && !hasPermission(req.user,'operation_accept')) fail(acceptancePermissionMessage,403);
  const post = route.product_coefficient != null;
  if (post && !id(quantity)) fail('后处理报工次数必须为正整数。');
  if (post && route.graph.post_processing_materials_per_unit) consumePostMaterials(db, order, node, quantity);
  parseExactQuantity(quantity, true);
  if (!post) {
    const layer = order.stages?.find(s => s.path === path) || order;
    const product = db.prepare('SELECT active,unit,unit_round_up FROM products WHERE id=? AND warehouse_id=?').get(layer.product_id,order.warehouse_id);
    if (!product?.active || product.unit !== layer.unit || product.unit_round_up !== layer.unit_round_up) fail('生产物料已停用、单位或取整规则已变化，请先核对。',409);
    if (!validExactQuantity(exactAdd(exactQuantity(node, 'completed_quantity'), quantity), true)) fail('工序累计数量超出范围。');
  }
  if ((!req.registrationValidation || route.graph.post_processing_materials_per_unit) && node.available_quantity !== null && exactCompare(quantity, exactQuantity(node, 'available_quantity')) > 0) {
    if (post) fail('本次报工超过后处理剩余可登记次数。', 409);
    fail('前置工序可用数量不足，请先核对前序报工。', 409);
  }
  if (typeof req.body.note !== 'string' && req.body.note !== undefined || (req.body.note?.length ?? 0) > 500) fail('工序说明最多 500 字。');
  if (db.prepare('SELECT COUNT(*) n FROM production_operation_reports WHERE production_id=?').get(order.id).n >= 10000) fail('每张生产单最多登记 10000 条工序记录。');
  return { route, node, worker: operationWorker(db, req, order) };
}
function nextOperationSequence(db, productionId) {
  return db.prepare('SELECT COALESCE(MAX(MAX(created_sequence,COALESCE(voided_sequence,0))),0)+1 value FROM production_operation_reports WHERE production_id=?').get(productionId).value;
}
function insertReport(db, req, order, input, quantity, kind = null, batchId = null) {
  if (!input) return;
  const materials = input.route.product_coefficient != null ? consumePostMaterials(db, order, input.node, quantity) : [];
  sumPostMaterialCosts(materials);
  const acceptanceId=saveOperationAcceptance(db,req,order,input);
  const reportId = Number(db.prepare(`INSERT INTO production_operation_reports(production_id,route_snapshot_id,node_id,quantity,worker_id,worker_name,registered_by,registered_by_name,note,created_at,output_kind,output_batch_id,created_sequence,acceptance_id,multiplier,post_materials) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(order.id, input.route.id, input.node.id, exactNumber(quantity), input.worker.id, input.worker.name || input.worker.username, req.operationRegistrar ? req.operationRegistrar.registered_by : req.user.id, actor(req), req.body.note?.trim() || '', req.operationRegistrar?.created_at || new Date().toISOString(), kind, batchId, nextOperationSequence(db, order.id),acceptanceId,input.node.multiplier ?? 1,JSON.stringify(materials)).lastInsertRowid);
  saveExactQuantity(db, 'production_operation_reports', reportId, 'quantity', quantity);
}
export function recordOperationOutput(db, req, order, path, quantity, kind, batchId) {
  const input = operationInput(db, req, order, path, quantity, true);
  insertReport(db, req, order, input, quantity, kind, batchId);
}
export function voidOperationOutput(db, kind, batchId, owner, at, reason) {
  const report = db.prepare("SELECT production_id FROM production_operation_reports WHERE output_kind=? AND output_batch_id=? AND status='active'").get(kind,batchId);
  if (report) db.prepare("UPDATE production_operation_reports SET status='void',void_reason=?,voided_by_name=?,voided_at=?,voided_sequence=? WHERE output_kind=? AND output_batch_id=? AND status='active'").run(reason, owner, at, nextOperationSequence(db, report.production_id), kind, batchId);
}
export function assertOperationsFinished(db, productionId) {
  if (db.prepare("SELECT 1 FROM production_operation_registrations WHERE production_id=? AND status='pending' LIMIT 1").get(productionId)) fail('仍有登记未结算或未验收，请补齐缺口并完成结算、验收或取消登记。',409);
  const order = { ...db.prepare('SELECT * FROM production_orders WHERE id=?').get(productionId), stages: db.prepare('SELECT * FROM production_stages WHERE production_id=?').all(productionId),
    items: db.prepare('SELECT * FROM production_items WHERE production_id=?').all(productionId),
    nodes: db.prepare('SELECT * FROM production_bom_nodes WHERE production_id=? ORDER BY position').all(productionId) }; readProductionRoutes(db, order);
  for (const route of order.operation_routes) {
    if (route.product_coefficient != null) {
      if (!order.output_completed) fail('成品生产尚未完成，请登记达到计划或确认成品生产完成。', 409);
      if (route.operations[0].completed_quantity !== route.post_processing_limit) fail('后处理工序尚未完成，请登记完成后再结束生产。', 409);
      continue;
    }
    const output = exactQuantity(route.operations.find(n => n.is_output), 'completed_quantity');
    if (route.operations.some(n => exactCompare(exactQuantity(n, 'completed_quantity'), output) !== 0)) fail('仍有工序在制数量，请完成流转或纠正错误报工后再结束生产。', 409);
  }
}

export function installProductionOperations(app, db, { route, current, version }) {
  app.get('/api/production-orders/:id/operation-prices', route(req => {
    const order = current(req);
    return { version: order.version, routes: order.operation_routes.map(snapshot => {
      const layer = order.stages?.find(stage => stage.path === snapshot.path);
      return {
        id: snapshot.id, path: snapshot.path, route_name: snapshot.route_name,
        product_name: layer?.name || order.product_name,
        unit: snapshot.product_coefficient != null ? snapshot.unit || postProcessingUnit : layer?.unit || order.unit,
        price_table_id: snapshot.graph.price_table_id ?? null,
        price_table_name: snapshot.graph.price_table_name || '',
        operations: snapshot.graph.nodes.map(node => ({
          id: node.id, name: node.name, unit_price: node.unit_price ?? null,
          currency: node.currency ?? null, multiplier: node.multiplier ?? 1,
        })),
      };
    }) };
  }));
  app.get('/api/production-orders/:id/operation-workers', route(req => {
    const order = current(req);
    const workers = hasPermission(req.user, 'production')
      ? db.prepare('SELECT id,name,username,production_group_id FROM users WHERE active=1 ORDER BY id').all().filter(worker => worker.id === req.user.id || isProductionAssignee(worker, order))
      : [{ id: req.user.id, name: req.user.name, username: req.user.username }];
    return { workers: workers.map(w => ({ id: w.id, name: w.name || w.username })) };
  }));
  app.get('/api/production-orders/:id/operations/reports', route(req => {
    const order = current(req), { snapshot_id, offset = '0', limit = '20' } = req.query;
    if (typeof snapshot_id !== 'string' || !/^\d+$/.test(snapshot_id) || !order.operation_routes.some(r => r.id === Number(snapshot_id)) ||
        typeof offset !== 'string' || !/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset)) || typeof limit !== 'string' || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100) fail('工序记录筛选或分页参数无效。');
    const snapshot = order.operation_routes.find(r => r.id === Number(snapshot_id));
    const paths = stagePoolPaths(order, snapshot.path), ids = new Set(order.operation_routes.filter(r => paths.includes(r.path)).map(r => r.id));
    const all = db.prepare('SELECT * FROM production_operation_reports WHERE production_id=? ORDER BY id DESC').all(order.id).filter(r => ids.has(r.route_snapshot_id)), total = all.length;
    const reports = all.slice(Number(offset), Number(offset) + Number(limit))
      .map(report => readPostMaterialReport(report, snapshot.graph, snapshot.product_coefficient != null));
    return { reports, total, has_more: Number(offset) + reports.length < total };
  }));
  app.post('/api/production-orders/:id/operations/report', route(req => {
    const order = current(req); version(req, order);
    if (order.status !== 'in_progress') fail('仅生产中可以登记工序。', 409);
    if (typeof req.body.path !== 'string') fail('请选择生产层。');
    const target = order.operation_routes.find(r => r.path === req.body.path);
    const post = target?.product_coefficient != null;
    const allocations = req.body.auto_overflow === true && !post
      ? operationAllocation(order, req.body.path, req.body.operation_node_id, req.body.quantity)
      : [{ path: req.body.path, node_id: req.body.operation_node_id, quantity: req.body.quantity }];
    for (const allocation of allocations) {
      const part = { ...req, body: { ...req.body, operation_node_id: allocation.node_id } };
      const input = operationInput(db, part, order, allocation.path, allocation.quantity, false);
      if (!input) fail('此生产层没有工艺路线。');
      if (req.registrationValidation) {
        if (post) consumePostMaterials(db, order, input.node, allocation.quantity, true);
      } else insertReport(db, part, order, input, allocation.quantity);
    }
    if (req.registrationValidation) return;
    db.prepare('UPDATE production_orders SET updated_at=?,updated_by_name=? WHERE id=?').run(new Date().toISOString(), actor(req), order.id);
    return current(req);
  }, true, undefined, 'operations/report'));
  app.post('/api/production-orders/:id/operations/:reportId/void', route(req => {
    const order = current(req); version(req, order);
    if (!hasPermission(req.user, 'production') || !hasPermission(req.user, 'corrections')) fail('需要生产管理和单据纠正权限。', 403);
    if (order.status === 'void' || typeof req.body.reason !== 'string' || !req.body.reason.trim() || req.body.reason.length > 500) fail('请填写有效的工序作废原因。');
    const report = db.prepare('SELECT * FROM production_operation_reports WHERE id=? AND production_id=?').get(Number(req.params.reportId), order.id);
    if (!report || report.status !== 'active') fail('工序记录不存在或已作废。', 404);
    if (report.output_kind) fail('最终工序记录请通过对应产出批次作废。', 409);
    const snapshot = order.operation_routes.find(r => r.id === report.route_snapshot_id);
    let quantity;
    try { quantity = req.body.quantity === undefined ? exactQuantity(report) : parseExactQuantity(req.body.quantity, true); } catch { fail('请输入有效的作废数量。'); }
    if (!validExactQuantity(quantity, true) || exactCompare(quantity, exactQuantity(report)) > 0) fail('作废数量不能超过记录的有效数量。');
    if (snapshot.product_coefficient != null && !Number.isSafeInteger(quantity)) fail('后处理作废次数必须为正整数。');
    const left = exactSubtract(exactQuantity(report), quantity);
    const paths = stagePoolPaths(order, snapshot.path), ids = new Set(order.operation_routes.filter(r => paths.includes(r.path)).map(r => r.id));
    const reports = db.prepare('SELECT * FROM production_operation_reports WHERE production_id=? AND id!=?').all(order.id, report.id).filter(r => ids.has(r.route_snapshot_id));
    if (exactCompare(left, 0) > 0) reports.push({ ...report, ...quantityFields(left) });
    const remaining = processProgress(snapshot.graph, reports);
    for (const node of remaining) for (const parent of node.predecessors)
      if (exactCompare(exactQuantity(node, 'completed_quantity'), exactQuantity(remaining.find(n => n.id === parent), 'completed_quantity')) > 0) fail('后序已有报工，请先作废依赖的后序记录。', 409);
    reopenProductionQuantities(db, req, order);
    const at = new Date().toISOString();
    const sequence = nextOperationSequence(db, order.id);
    if (exactCompare(left, 0) === 0) {
      db.prepare("UPDATE production_operation_reports SET status='void',void_reason=?,voided_by_name=?,voided_at=?,voided_sequence=? WHERE id=?").run(req.body.reason.trim(), actor(req), at, sequence, report.id);
    } else {
      const materials = JSON.parse(report.post_materials);
      const removedMaterials = materials.map(material => {
        const removed = exactNumber(exactMultiply(material.quantity, exactDivide(quantity, exactQuantity(report))));
        return { ...material, quantity: removed, cost_cents: allocate(material.basis_cost_cents, removed, exactQuantity(material, 'basis_quantity')) };
      });
      const keptMaterials = materials.map((material, index) => {
        const kept = exactNumber(exactSubtract(material.quantity, removedMaterials[index].quantity));
        const cost = material.cost_cents - removedMaterials[index].cost_cents;
        return { ...material, quantity: kept, ...quantityFields(kept, 'basis_quantity'), basis_cost_cents: cost, cost_cents: cost };
      });
      saveExactQuantity(db, 'production_operation_reports', report.id, 'quantity', left);
      db.prepare('UPDATE production_operation_reports SET post_materials=? WHERE id=?').run(JSON.stringify(keptMaterials), report.id);
      const result = db.prepare(`INSERT INTO production_operation_reports(production_id,route_snapshot_id,node_id,quantity,worker_id,worker_name,registered_by,registered_by_name,note,created_at,output_kind,output_batch_id,created_sequence,acceptance_id,multiplier,post_materials,status,void_reason,voided_by_name,voided_at,voided_sequence,split_from_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(report.production_id,report.route_snapshot_id,report.node_id,exactNumber(quantity),report.worker_id,report.worker_name,report.registered_by,report.registered_by_name,report.note,report.created_at,null,null,report.created_sequence,report.acceptance_id,report.multiplier,JSON.stringify(removedMaterials),'void',req.body.reason.trim(),actor(req),at,sequence,report.id);
      saveExactQuantity(db, 'production_operation_reports', Number(result.lastInsertRowid), 'quantity', quantity);
    }
    db.prepare("UPDATE production_orders SET status='draft',updated_at=?,updated_by_name=? WHERE id=?").run(at, actor(req), order.id);
    return current(req);
  }, true));
  app.post('/api/production-orders/:id/sync-operation-prices', route(req => {
    const order = current(req); version(req, order);
    syncProductionOperationPrices(db, req, order);
    return current(req);
  }, true));
}

export function validateProcessRouteBackup(data) {
  validateOperationRegistrationBackup(data);
  const routes = new Map(data.process_routes.map(row => [row.id, row])), orders = new Map(data.production_orders.map(row => [row.id, row]));
  const warehouses = new Set(data.warehouses.map(row => row.id)), snapshots = new Map();
  const products = new Map(data.products.map(row => [row.id, row])), items = new Map();
  for (const item of data.production_items) {
    if (!items.has(item.production_id)) items.set(item.production_id, new Map());
    items.get(item.production_id).set(item.product_id, item);
  }
  const text = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || !!value.trim());
  const association = value => value === null || id(value);
  const checkTemplates = (graph,warehouseId,snapshot=false) => {
    for(const node of graph.nodes) if(node.acceptance_template_id) {
      const template=data.quality_templates.find(t=>t.id===node.acceptance_template_id && t.warehouse_id===warehouseId);
      if(!template) fail('备份工序验收模板关联无效。');
      if(snapshot && !data.quality_template_revisions.some(r=>r.id===node.acceptance_revision_id && r.template_id===template.id)) fail('备份工序验收版本无效。');
    }
  };
  const names = new Set();
  for (const row of routes.values()) {
    if (!routeKinds.includes(row.route_kind) || !warehouses.has(row.warehouse_id) || !text(row.name, 100, true) || !text(row.note, 1000) || ![0,1].includes(row.enabled) || !id(row.version) ||
        !text(row.created_by_name, 100, true) || !text(row.updated_by_name, 100, true) || !Number.isFinite(Date.parse(row.created_at)) || !Number.isFinite(Date.parse(row.updated_at)) || names.has(`${row.warehouse_id}:${row.name}`)) fail('备份工艺路线无效。');
    names.add(`${row.warehouse_id}:${row.name}`);
    const graph = parseGraph(row.graph);
    checkTemplates(graph,row.warehouse_id);
    validatePostMaterialGraph(graph, row.route_kind === 'post_processing', products, row.warehouse_id);
  }
  for (const [table, column] of [['products','default_route_id'], ['boms','route_override_id']]) for (const row of data[table]) {
    if (!association(row[column]) || row[column] !== null && (routes.get(row[column])?.warehouse_id !== row.warehouse_id || routes.get(row[column]).route_kind !== 'production')) fail('备份工艺路线绑定跨仓或无效。');
  }
  for (const bom of data.boms) {
    if (bom.route_price_table_id === null) continue;
    const routeId = bom.route_override_id ?? products.get(bom.product_id)?.default_route_id;
    if (typeof bom.route_price_table_id !== 'string' || !routes.has(routeId)) fail('请选择有效工艺路线及单价表。');
    processGraphWithPrices(parseGraph(routes.get(routeId).graph), bom.route_price_table_id);
  }
  const keys = new Set(), postBindings = new Set(), postOrders = new Set();
  const postPlans = new Map();
  for (const row of data.production_routes) {
    const order = orders.get(row.production_id), key = `${row.production_id}:${row.path}`;
    const source = routes.get(row.route_id), graph = parseGraph(row.graph), post = row.product_coefficient !== null;
    if (!order || source?.warehouse_id !== order.warehouse_id || source.route_kind !== (post ? 'post_processing' : 'production') ||
        !id(row.route_version) || !text(row.route_name, 100, true) || typeof row.path !== 'string' || keys.has(key))
      fail('备份生产工艺快照无效。');
    if (post) {
      const binding = JSON.stringify([order.id, row.route_id, graph.nodes[0].id]);
      if (!validQuantity(row.product_coefficient, true) ||
          !/^@post:(?:[1-9]|[1-4][0-9]|50)$/.test(row.path) || graph.nodes.length !== 1 || postBindings.has(binding))
        fail('备份后处理工序快照无效。');
      postBindings.add(binding);
      postOrders.add(order.id);
    } else if (order.stage_workflow ? !data.production_stages.some(s => s.production_id === order.id && s.path === row.path) : row.path !== '') {
      fail('备份生产工艺快照无效。');
    }
    checkTemplates(graph,order.warehouse_id,true);
    validatePostMaterialGraph(graph, post, products, order.warehouse_id, items.get(order.id) ?? new Map());
    if (post && graph.nodes[0].materials?.length) {
      if (!order.material_workflow) fail('备份后处理材料配置、用量或成本无效。');
      const plans = postPlans.get(order.id) ?? [];
      plans.push(planPostMaterials(graph, order.planned_quantity, row.product_coefficient));
      postPlans.set(order.id, plans);
    }
    keys.add(key); snapshots.set(row.id, { ...row, graph, reports: [] });
  }
  for (const order of orders.values()) {
    if (![0,1].includes(order.output_completion_confirmed) ||
        order.output_completion_confirmed && (!postOrders.has(order.id) || order.status === 'void' ||
          exactCompare(exactQuantity(order, 'completed_quantity'), 0) <= 0 ||
          exactCompare(exactQuantity(order, 'completed_quantity'), order.planned_quantity) >= 0))
      fail('备份成品生产完成确认状态无效。');
  }
  const outputs = new Set(), acceptanceOwners = new Map();
  const reportsById = new Map(data.production_operation_reports.map(row => [row.id, row]));
  for (const row of data.production_operation_reports) {
    const snapshot = snapshots.get(row.route_snapshot_id), order = orders.get(row.production_id);
    if (!snapshot || snapshot.production_id !== row.production_id || !order || !validExactQuantity(row.quantity, true) || !validExactQuantity(row.multiplier, true) || !['active','void'].includes(row.status) ||
        !association(row.worker_id) || !association(row.registered_by) || !text(row.worker_name,100,true) || !text(row.registered_by_name,100,true) || !text(row.note,500) ||
        !Number.isFinite(Date.parse(row.created_at)) || !id(row.created_sequence) || !text(row.void_reason,500) || !text(row.voided_by_name,100) ||
        (row.status === 'active' ? row.voided_sequence !== null || row.voided_at !== null || row.void_reason !== '' || row.voided_by_name !== '' : !id(row.voided_sequence) || row.voided_sequence <= row.created_sequence || !row.void_reason.trim() || !row.voided_by_name.trim() || !Number.isFinite(Date.parse(row.voided_at)) || row.voided_at < row.created_at)) fail('备份工序登记无效。');
    const node = snapshot.graph.nodes.find(n => n.id === row.node_id), output = validateProcessGraph(snapshot.graph).output;
    if (!node) fail('备份工序登记节点无效。');
    if (row.split_from_id !== null) {
      const original = reportsById.get(row.split_from_id);
      if (!original || original.split_from_id !== null || row.status !== 'void' || row.output_kind !== null ||
          ['production_id','route_snapshot_id','node_id','created_sequence','created_at','worker_id','worker_name','registered_by','registered_by_name','note','acceptance_id','multiplier'].some(key => row[key] !== original[key])) fail('备份工序部分作废记录无效。');
    }
    if(!association(row.acceptance_id)) fail('备份工序验收单编号无效。');
    if(node.acceptance_template_id) {
      const acceptance=data.quality_acceptances.find(a=>a.id===row.acceptance_id);
      const acceptanceOwner=JSON.stringify([order.id,node.id,row.registered_by_name,row.worker_name]);
      if(acceptanceOwners.has(row.acceptance_id) && acceptanceOwners.get(row.acceptance_id)!==acceptanceOwner) fail('验收单不能关联不同生产单、工序或作业员工。');
      acceptanceOwners.set(row.acceptance_id,acceptanceOwner);
      const registration=(data.production_operation_registrations||[]).find(r=>r.status==='approved'&&r.acceptance_id===row.acceptance_id&&r.production_id===order.id);
      if(!acceptance || acceptance.warehouse_id!==order.warehouse_id || acceptance.template_id!==node.acceptance_template_id || acceptance.revision_id!==node.acceptance_revision_id || acceptance.created_by_name!==(registration?.resolved_by_name??row.registered_by_name)) fail('备份工序验收单关联无效。');
    } else if(row.acceptance_id!==null) fail('未绑定模板的工序不能关联验收单。');
    if (snapshot.product_coefficient !== null && (!id(row.quantity) || row.quantity_fraction !== ''))
      fail('备份后处理报工次数必须为正整数。');
    validatePostMaterialReport(row, node, snapshot.product_coefficient !== null);
    if (row.node_id === output && snapshot.product_coefficient == null) {
      const kind = order.stage_workflow ? 'stage' : 'batch', batch = (kind === 'stage' ? data.production_stage_batches : data.production_batches).find(b => b.id === row.output_batch_id);
      const key = `${kind}:${row.output_batch_id}`;
      if (row.output_kind !== kind || !batch || batch.production_id !== order.id || (kind === 'stage' && batch.path !== snapshot.path) || exactCompare(exactQuantity(batch,'completed_quantity'),exactQuantity(row)) !== 0 || batch.status !== row.status || outputs.has(key)) fail('备份最终工序与产出批次不一致。');
      outputs.add(key);
    } else if (row.output_kind !== null || row.output_batch_id !== null) fail('中间工序不能关联产出批次。');
    snapshot.reports.push(row);
  }
  // Persisted event sequences make same-millisecond registrations and corrections
  // unambiguous. Replay every route so balanced current totals cannot hide an
  // output that was reported before its predecessors existed.
  const replaySnapshots=[];
  for (const order of orders.values()) {
    const poolOrder=productionPoolOrder(data,order);
    const grouped=new Set();
    for(const group of productionPools(poolOrder)){
      const members=[...snapshots.values()].filter(s=>s.production_id===order.id&&group.some(stage=>stage.path===s.path));
      if(!members.length)continue;
      members.forEach(s=>grouped.add(s.id));
      replaySnapshots.push({...members[0],reports:members.flatMap(s=>s.reports)});
    }
    replaySnapshots.push(...[...snapshots.values()].filter(s=>s.production_id===order.id&&!grouped.has(s.id)));
  }
  const sequences = new Map();
  for (const snapshot of replaySnapshots) {
    const events = snapshot.reports.flatMap(report => [{ sequence: report.created_sequence, report, create: true }, ...(report.status === 'void' ? [{ sequence: report.voided_sequence, report, create: false }] : [])]).sort((a,b) => a.sequence - b.sequence);
    const used = sequences.get(snapshot.production_id) || new Set(); sequences.set(snapshot.production_id,used);
    const active = new Map();
    for (let index = 0; index < events.length;) {
      const sequence = events[index].sequence, group = [];
      while (index < events.length && events[index].sequence === sequence) group.push(events[index++]);
      if (used.has(sequence)) fail('备份工序事件顺序无效。'); used.add(sequence);
      if (group.length > 1) {
        const originals = group.filter(event => event.create && event.report.split_from_id === null);
        if (originals.length !== 1 || group.some(event => !event.create || event.report !== originals[0].report && event.report.split_from_id !== originals[0].report.id)) fail('备份工序事件顺序无效。');
      }
      for (const event of group) {
        if (event.create) active.set(event.report.id,{ ...event.report,status:'active' }); else active.delete(event.report.id);
      }
      const progress = processProgress(snapshot.graph,[...active.values()]);
      for (const node of progress) for (const parent of node.predecessors)
        if (exactCompare(exactQuantity(node,'completed_quantity'),exactQuantity(progress.find(n => n.id === parent),'completed_quantity')) > 0) fail('备份工序事件顺序无效。');
    }
  }
  for (const snapshot of replaySnapshots) {
    const order = orders.get(snapshot.production_id), operations = processProgress(snapshot.graph, snapshot.reports);
    if (snapshot.product_coefficient !== null) {
      const completed = productionOutputCompleted(order), quantity = order.status === 'void' ? 0 : exactQuantity(order, 'completed_quantity');
      const limit = postProcessingLimit(quantity, snapshot.product_coefficient, completed, snapshot.graph);
      const reported = operations[0].completed_quantity;
      if (!Number.isSafeInteger(reported) || reported > limit || order.status === 'completed' && (!completed || reported !== limit))
        fail('备份后处理次数超过上限或与生产完成状态不一致。');
      continue;
    }
    if (operations.some(n => !validExactQuantity(exactQuantity(n,'completed_quantity')))) fail('备份工序累计数量无效。');
    for (const node of operations) for (const parent of node.predecessors) if (exactCompare(exactQuantity(node,'completed_quantity'),exactQuantity(operations.find(n => n.id === parent),'completed_quantity')) > 0) fail('备份工序前后数量不守恒。');
    const kind = order.stage_workflow ? 'stage' : 'batch';
    const paths=stagePoolPaths(productionPoolOrder(data,order),snapshot.path);
    for (const batch of (kind === 'stage' ? data.production_stage_batches : data.production_batches).filter(b => b.production_id === order.id && (kind !== 'stage' || paths.includes(b.path))))
      if (!outputs.has(`${kind}:${batch.id}`)) fail('备份产出批次缺少最终工序记录。');
    if (order.status === 'completed' && operations.some(n => exactCompare(exactQuantity(n,'completed_quantity'),exactQuantity(operations.find(n => n.is_output),'completed_quantity')) !== 0) ||
        order.status === 'void' && operations.some(n => n.completed_quantity !== 0)) fail('备份已结束生产单仍有工序在制数量。');
  }
  for (const [orderId, plans] of postPlans) {
    const totals = postMaterialPlanByProduct(plans);
    for (const [productId, quantity] of totals) totalPlannedMaterials(items.get(orderId).get(productId), quantity);
    postPlans.set(orderId, totals);
  }
  return postPlans;
}
