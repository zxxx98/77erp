import { hasPermission } from '../shared/permissions.js';
import { operationWageCents } from '../shared/payroll.js';

const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
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
    s.path, s.route_id, s.route_name, s.graph, s.additional_quantity, st.name stage_name, st.unit stage_unit
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
    const amount = operationWageCents(node, { ...row, multiplier }), unit = row.stage_unit ?? row.unit;
    const report = { id: row.id, production_id: row.production_id, production_number: row.production_number,
      product_name: row.stage_name ?? row.product_name, path: row.path, additional_operation: row.additional_quantity != null, route_name: row.route_name, operation_name: node.name,
      worker_name: row.worker_name, registered_by_name: row.registered_by_name, created_at: row.created_at,
      quantity: row.quantity, multiplier, unit, unit_price: node.unit_price ?? null, currency: node.currency ?? null,
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
  app.get('/api/payroll', route(req => payrollStatistics(db, req.warehouse.id, req.query)));
}
