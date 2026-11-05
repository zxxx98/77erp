import { postProcessingUnit } from '../shared/post-processing.js';
import { hasPermission } from '../shared/permissions.js';
import { operationWageCents } from '../shared/payroll.js';
import { exactQuantity, exactAdd, quantityFields } from '../shared/exact-quantity.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const pattern = value => `%${value.replace(/[\\%_]/g, c => `\\${c}`)}%`;
const publicStatus = order => order.status === 'draft' ? order.material_workflow ? order.material_phase : order.completed_at ? 'in_progress' : 'draft' : order.status;
const safeSum = (a, b) => {
  const value = a + b;
  if (!Number.isSafeInteger(value)) fail('工资金额超出安全计算范围，请缩小统计范围或核对单价和倍率。');
  return value;
};

export function payrollStatistics(db, warehouseId, query) {
  const workerId = Number(query.worker_id), offset = Number(query.offset ?? 0), limit = Number(query.limit ?? 30);
  if (typeof query.worker_id !== 'string' || !/^[1-9]\d*$/.test(query.worker_id) || !Number.isSafeInteger(workerId) ||
      !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      query.offset !== undefined && !/^\d+$/.test(query.offset) || query.limit !== undefined && !/^\d+$/.test(query.limit)) fail('工资统计成员或分页参数无效。');
  const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  if (!date(query.start_at) || !date(query.end_at) || query.start_at >= query.end_at) fail('请选择有效的工资统计日期范围。');
  const timeZone = query.time_zone ?? 'UTC';
  let dayFormatter;
  try {
    if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 100) throw new Error();
    dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch { fail('工资统计时区无效。'); }
  const dayOf = value => {
    const parts = Object.fromEntries(dayFormatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const worker = db.prepare('SELECT id,name,username,employee_no,active FROM users WHERE id=?').get(workerId);
  const rows = db.prepare(`SELECT r.*, p.number production_number, p.product_name, p.unit,
    s.path, s.route_id, s.route_name, s.graph, s.additional_quantity, s.product_coefficient, st.name stage_name, st.unit stage_unit
    FROM production_operation_reports r JOIN production_orders p ON p.id=r.production_id
    JOIN production_routes s ON s.id=r.route_snapshot_id
    LEFT JOIN production_stages st ON st.production_id=p.id AND st.path=s.path
    WHERE p.warehouse_id=? AND r.worker_id=? AND r.created_at>=? AND r.created_at<?
    ORDER BY r.created_at DESC,r.id DESC`).all(warehouseId, workerId, query.start_at, query.end_at);
  const graphs = new Map(), currencies = new Map(), operations = new Map(), daily = new Map();
  const summary = { report_count: rows.length, active_count: 0, void_count: 0, unpriced_count: 0, production_count: 0 };
  const productions = new Set();
  const reports = rows.map(row => {
    if (!graphs.has(row.route_snapshot_id)) graphs.set(row.route_snapshot_id, JSON.parse(row.graph));
    const node = graphs.get(row.route_snapshot_id).nodes.find(n => n.id === row.node_id);
    if (!node) fail('工序快照缺失，无法计算工资。');
    const multiplier = node.multiplier ?? row.multiplier ?? 1;
    const amount = operationWageCents(node, { ...row, multiplier }), unit = row.product_coefficient == null ? row.stage_unit ?? row.unit : postProcessingUnit;
    const report = { id: row.id, production_id: row.production_id, production_number: row.production_number,
      product_name: row.stage_name ?? row.product_name, path: row.path, additional_operation: row.additional_quantity != null, post_processing_operation: row.product_coefficient != null, route_name: row.route_name, operation_name: node.name,
      worker_name: row.worker_name, registered_by_name: row.registered_by_name, created_at: row.created_at,
      quantity: row.quantity, quantity_fraction: row.quantity_fraction, multiplier, unit, unit_price: node.unit_price ?? null, currency: node.currency ?? null,
      amount_cents: amount, status: row.status, note: row.note, void_reason: row.void_reason };
    if (row.status === 'void') { summary.void_count++; return report; }
    summary.active_count++; productions.add(row.production_id);
    if (amount === null) summary.unpriced_count++;
    else {
      currencies.set(node.currency, safeSum(currencies.get(node.currency) || 0, amount));
      const date = dayOf(row.created_at), key = `${date}:${node.currency}`;
      const day = daily.get(key) || { date, currency: node.currency, amount_cents: 0, report_count: 0 };
      day.amount_cents = safeSum(day.amount_cents, amount); day.report_count++;
      daily.set(key, day);
    }
    const key = JSON.stringify([row.route_id, row.node_id, node.name, unit, node.unit_price ?? null, node.currency ?? null]);
    const group = operations.get(key) || { key, route_name: row.route_name, operation_name: node.name, unit,
      unit_price: node.unit_price ?? null, currency: node.currency ?? null, quantity: 0, weighted_quantity: 0, report_count: 0, amount_cents: amount === null ? null : 0 };
    group.quantity = safeSum(group.quantity, Math.round(row.quantity * 10000));
    // Weighted quantities retain eight decimals; never combine different units.
    const weighted = BigInt(Math.round(row.quantity * 10000)) * BigInt(Math.round(multiplier * 10000));
    group.weighted_quantity += Number(weighted) / 100000000;
    group.report_count++;
    if (amount !== null) group.amount_cents = safeSum(group.amount_cents, amount);
    operations.set(key, group);
    return report;
  });
  summary.production_count = productions.size;
  return { worker: worker || { id: workerId, name: rows[0]?.worker_name || '', active: 0 }, summary,
    currencies: [...currencies].map(([currency, amount_cents]) => ({ currency, amount_cents })),
    time_zone: timeZone, daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date) || a.currency.localeCompare(b.currency)),
    operations: [...operations.values()].map(row => ({ ...row, quantity: row.quantity / 10000 })),
    reports: reports.slice(offset, offset + limit), total: reports.length, has_more: offset + limit < reports.length };
}

export function payrollProductionOrders(db, warehouseId, query = {}) {
  const q = query.q ?? '', offset = Number(query.offset ?? 0), limit = Number(query.limit ?? 20);
  if (typeof q !== 'string' || q.length > 100 ||
      !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      query.offset !== undefined && !/^\d+$/.test(query.offset) || query.limit !== undefined && !/^\d+$/.test(query.limit))
    fail('工资统计生产单筛选或分页参数无效。');
  const clauses = ['p.warehouse_id=?'], params = [warehouseId];
  if (q.trim()) {
    clauses.push("(p.number LIKE ? ESCAPE '\\' OR p.product_name LIKE ? ESCAPE '\\' OR p.barcode LIKE ? ESCAPE '\\' OR p.bom_name LIKE ? ESCAPE '\\')");
    params.push(...Array(4).fill(pattern(q.trim())));
  }
  const where = clauses.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM production_orders p WHERE ${where}`).get(...params).n;
  const rows = db.prepare(`SELECT p.id, p.number, p.product_name, p.barcode, p.specification, p.bom_name, p.unit,
    p.planned_quantity, p.completed_quantity, p.completed_quantity_fraction,
    p.status, p.material_workflow, p.material_phase, p.completed_at, p.created_at,
    COUNT(r.id) AS report_count,
    COALESCE(SUM(CASE WHEN r.status='active' THEN 1 ELSE 0 END), 0) AS active_report_count,
    COUNT(DISTINCT CASE WHEN r.status='active' THEN r.worker_id END) AS worker_count
    FROM production_orders p
    LEFT JOIN production_operation_reports r ON r.production_id=p.id
    WHERE ${where}
    GROUP BY p.id
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const orders = rows.map(({ material_workflow, material_phase, completed_at, ...row }) => ({
    ...row,
    status: publicStatus({ status: row.status, material_workflow, material_phase, completed_at }),
  }));
  return { orders, total, has_more: offset + orders.length < total, next_offset: offset + orders.length };
}

export function payrollOrderStatistics(db, warehouseId, query = {}) {
  const productionId = Number(query.production_id), offset = Number(query.offset ?? 0), limit = Number(query.limit ?? 30);
  const filterWorkerId = query.worker_id === undefined || query.worker_id === '' ? null : Number(query.worker_id);
  if (typeof query.production_id !== 'string' || !/^[1-9]\d*$/.test(query.production_id) || !Number.isSafeInteger(productionId) ||
      filterWorkerId !== null && (typeof query.worker_id !== 'string' || !/^[1-9]\d*$/.test(query.worker_id) || !Number.isSafeInteger(filterWorkerId)) ||
      !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      query.offset !== undefined && !/^\d+$/.test(query.offset) || query.limit !== undefined && !/^\d+$/.test(query.limit))
    fail('工资统计生产单筛选或分页参数无效。');
  const orderRow = db.prepare(`SELECT id, number, bom_name, product_name, barcode, specification, unit,
    planned_quantity, completed_quantity, completed_quantity_fraction,
    status, material_workflow, material_phase, completed_at, created_at
    FROM production_orders WHERE id=? AND warehouse_id=?`).get(productionId, warehouseId);
  if (!orderRow) fail('生产单不存在或不属于当前仓库。', 404);
  const { material_workflow, material_phase, completed_at, ...orderRest } = orderRow;
  const order = { ...orderRest, status: publicStatus(orderRow) };
  const rows = db.prepare(`SELECT r.*, p.number production_number, p.product_name, p.unit,
    s.path, s.route_id, s.route_name, s.graph, s.additional_quantity, s.product_coefficient, st.name stage_name, st.unit stage_unit,
    u.username worker_username, u.employee_no worker_employee_no, u.active worker_active, u.name current_worker_name
    FROM production_operation_reports r
    JOIN production_orders p ON p.id=r.production_id
    JOIN production_routes s ON s.id=r.route_snapshot_id
    LEFT JOIN production_stages st ON st.production_id=p.id AND st.path=s.path
    LEFT JOIN users u ON u.id=r.worker_id
    WHERE p.warehouse_id=? AND r.production_id=?
    ORDER BY r.created_at DESC, r.id DESC`).all(warehouseId, productionId);
  const graphs = new Map(), currencies = new Map(), workersMap = new Map();
  const summary = { report_count: rows.length, active_count: 0, void_count: 0, unpriced_count: 0, worker_count: 0 };
  const reports = rows.map(row => {
    if (!graphs.has(row.route_snapshot_id)) graphs.set(row.route_snapshot_id, JSON.parse(row.graph));
    const node = graphs.get(row.route_snapshot_id).nodes.find(n => n.id === row.node_id);
    if (!node) fail('工序快照缺失，无法计算工资。');
    const multiplier = node.multiplier ?? row.multiplier ?? 1;
    const amount = operationWageCents(node, { ...row, multiplier }), unit = row.product_coefficient == null ? row.stage_unit ?? row.unit : postProcessingUnit;
    const report = {
      id: row.id, production_id: row.production_id, production_number: row.production_number,
      product_name: row.stage_name ?? row.product_name, path: row.path, additional_operation: row.additional_quantity != null, post_processing_operation: row.product_coefficient != null,
      route_name: row.route_name, operation_name: node.name,
      worker_id: row.worker_id, worker_name: row.worker_name, registered_by_name: row.registered_by_name, created_at: row.created_at,
      quantity: row.quantity, quantity_fraction: row.quantity_fraction, multiplier, unit,
      unit_price: node.unit_price ?? null, currency: node.currency ?? null,
      amount_cents: amount, status: row.status, note: row.note, void_reason: row.void_reason,
    };
    const workerKey = row.worker_id ?? `name:${row.worker_name}`;
    let workerEntry = workersMap.get(workerKey);
    if (!workerEntry) {
      workerEntry = {
        worker_id: row.worker_id,
        worker_name: row.current_worker_name || row.worker_name,
        username: row.worker_username || '',
        employee_no: row.worker_employee_no || '',
        active: row.worker_active ?? 0,
        report_count: 0,
        active_count: 0,
        void_count: 0,
        unpriced_count: 0,
        currencies: new Map(),
        operations: new Map(),
      };
      workersMap.set(workerKey, workerEntry);
    }
    workerEntry.report_count++;
    if (row.status === 'void') {
      summary.void_count++;
      workerEntry.void_count++;
      return report;
    }
    summary.active_count++;
    workerEntry.active_count++;
    if (amount === null) {
      summary.unpriced_count++;
      workerEntry.unpriced_count++;
    } else {
      currencies.set(node.currency, safeSum(currencies.get(node.currency) || 0, amount));
      workerEntry.currencies.set(node.currency, safeSum(workerEntry.currencies.get(node.currency) || 0, amount));
    }
    const opKey = JSON.stringify([row.route_id, row.node_id, node.name, unit, multiplier, node.unit_price ?? null, node.currency ?? null]);
    const group = workerEntry.operations.get(opKey) || {
      key: opKey, route_name: row.route_name, operation_name: node.name, unit, multiplier,
      unit_price: node.unit_price ?? null, currency: node.currency ?? null,
      exact_quantity: 0, weighted_quantity: 0, report_count: 0, amount_cents: amount === null ? null : 0,
    };
    group.exact_quantity = exactAdd(group.exact_quantity, exactQuantity(row));
    const weighted = BigInt(Math.round(row.quantity * 10000)) * BigInt(Math.round(multiplier * 10000));
    group.weighted_quantity += Number(weighted) / 100000000;
    group.report_count++;
    if (amount !== null) group.amount_cents = safeSum(group.amount_cents, amount);
    workerEntry.operations.set(opKey, group);
    return report;
  });
  const workers = [...workersMap.values()].map(({ currencies: wCurrencies, operations: wOps, ...w }) => ({
    ...w,
    currencies: [...wCurrencies].map(([currency, amount_cents]) => ({ currency, amount_cents })),
    operations: [...wOps.values()].map(({ exact_quantity, ...op }) => ({ ...op, ...quantityFields(exact_quantity, 'quantity') })),
  }));
  summary.worker_count = workers.filter(w => w.active_count > 0).length;
  const filteredReports = filterWorkerId === null ? reports : reports.filter(r => r.worker_id === filterWorkerId);
  return {
    order,
    summary,
    currencies: [...currencies].map(([currency, amount_cents]) => ({ currency, amount_cents })),
    workers,
    reports: filteredReports.slice(offset, offset + limit),
    total: filteredReports.length,
    has_more: offset + limit < filteredReports.length,
  };
}

export function installPayroll(app, db) {
  db.exec('CREATE INDEX IF NOT EXISTS operation_reports_payroll ON production_operation_reports(worker_id,created_at,id)');
  const route = fn => (req, res) => {
    if (!hasPermission(req.user, 'finance')) return res.status(403).json({ error: '查看工资统计需要财务管理权限。' });
    try { res.json(fn(req)); } catch (error) { res.status(error.status || 400).json({ error: error.message }); }
  };
  app.get('/api/payroll/members', route(req => {
    const members = db.prepare(`SELECT id,name,username,employee_no,active FROM users ORDER BY active DESC,name,username,id`).all();
    const historical = db.prepare(`SELECT r.worker_id id, r.worker_name name FROM production_operation_reports r
      JOIN production_orders p ON p.id=r.production_id WHERE p.warehouse_id=? AND r.worker_id IS NOT NULL ORDER BY r.id DESC`).all(req.warehouse.id);
    const ids = new Set(members.map(row => row.id));
    for (const row of historical) if (!ids.has(row.id)) { members.push({ ...row, username: '', employee_no: '', active: 0 }); ids.add(row.id); }
    return { members };
  }));
  app.get('/api/payroll/production-orders', route(req => payrollProductionOrders(db, req.warehouse.id, req.query)));
  app.get('/api/payroll/production-order', route(req => payrollOrderStatistics(db, req.warehouse.id, req.query)));
  app.get('/api/payroll', route(req => payrollStatistics(db, req.warehouse.id, req.query)));
}
