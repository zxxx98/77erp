import { randomUUID } from 'node:crypto';
import { notificationEvents, notificationFormats } from '../shared/notifications.js';
import { sendWebhook, validateWebhookUrl } from './webhook-transport.js';

const labels = Object.fromEntries(notificationEvents.map(e => [e.key, e.label]));
const moneyKeys = new Set(['total', 'price', 'amount_cents', 'total_cents', 'paid_cents', 'due_cents', 'purchase_cents', 'sales_cents', 'purchase_returns_cents', 'sales_returns_cents']);
const withoutAmounts = value => Array.isArray(value) ? value.map(withoutAmounts) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !moneyKeys.has(key)).map(([key, item]) => [key, withoutAmounts(item)])) : value;
const nowISO = () => new Date().toISOString();

export function migrateNotifications(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS notification_settings (
    id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0,
    url TEXT NOT NULL DEFAULT '', format TEXT NOT NULL DEFAULT 'json', secret TEXT NOT NULL DEFAULT '',
    events TEXT NOT NULL DEFAULT '[]', warehouse_ids TEXT NOT NULL DEFAULT '[]', include_amounts INTEGER NOT NULL DEFAULT 0,
    daily_time TEXT NOT NULL DEFAULT '18:00', timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai', version INTEGER NOT NULL DEFAULT 1
  ); INSERT OR IGNORE INTO notification_settings(id) VALUES (1);
  CREATE TABLE IF NOT EXISTS notification_deliveries (
    id TEXT PRIMARY KEY, event TEXT NOT NULL, payload TEXT NOT NULL, config_version INTEGER NOT NULL,
    created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
    next_at INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '', dedupe_key TEXT UNIQUE
  );
  CREATE INDEX IF NOT EXISTS notification_due ON notification_deliveries(status,next_at);
  CREATE INDEX IF NOT EXISTS notification_created ON notification_deliveries(created_at);
  CREATE TABLE IF NOT EXISTS notification_summary_days (day TEXT PRIMARY KEY);
  `);
}
function configOf(db) {
  const row = db.prepare('SELECT * FROM notification_settings WHERE id=1').get();
  return { ...row, enabled: !!row.enabled, include_amounts: !!row.include_amounts, events: JSON.parse(row.events), warehouse_ids: JSON.parse(row.warehouse_ids) };
}
function publicConfig(db) {
  const { id, url, secret, ...config } = configOf(db);
  return { ...config, has_url: !!url, destination: url ? new URL(url).origin : '', has_secret: !!secret };
}
function formatMessage(event) {
  const d = event.data;
  const lines = [`77 ERP · ${labels[event.event] || '测试通知'}`, `时间：${event.occurred_at}`];
  if (event.warehouse) lines.push(`仓库：${event.warehouse.name}`);
  if (event.actor) lines.push(`操作人：${event.actor.username}`);
  if (d.number) lines.push(`单号：${d.number}`);
  if (d.source_number) lines.push(`原单号：${d.source_number}`);
  if (d.partner) lines.push(`往来单位：${d.partner}`);
  if (d.action) lines.push(`操作：${d.action}`);
  if (d.reason) lines.push(`原因：${d.reason}`);
  if (d.total_cents != null) lines.push(`单据金额：¥${(d.total_cents / 100).toFixed(2)}`);
  if (d.amount_cents != null) lines.push(`本次收付：¥${(d.amount_cents / 100).toFixed(2)}`);
  if (d.due_cents != null) lines.push(`剩余未收／未付：¥${(d.due_cents / 100).toFixed(2)}`);
  if (d.payment_status) lines.push(`收付状态：${d.payment_status === 'paid' ? '已结清' : '未结清'}`);
  if (d.target_user) lines.push(`账号：${d.target_user}`);
  if (d.products != null) lines.push(`物料：${d.products} 种；单据：${d.orders} 张`);
  for (const item of (d.items || []).slice(0, 6)) {
    lines.push(item.before_stock != null
      ? `${item.name}：${item.before_stock} → ${item.stock} ${item.unit}（安全库存 ${item.threshold}）`
      : `${item.name} × ${item.quantity} ${item.unit}`);
  }
  if (d.items?.length > 6) lines.push(`另有 ${d.items.length - 6} 种物料`);
  if (d.day) lines.push(`统计日期：${d.day}（${d.timezone}，截至发送时）`);
  for (const row of d.warehouses || []) {
    lines.push(`${row.name}：采购 ${row.purchase_count} 单，销售 ${row.sales_count} 单，退货 ${row.return_count} 单；低库存 ${row.low_stock} 种，缺货 ${row.out_of_stock} 种`);
    if (row.purchase_cents != null) lines.push(`采购净额 ¥${(row.purchase_cents / 100).toFixed(2)}，销售净额 ¥${(row.sales_cents / 100).toFixed(2)}；采购退货 ¥${(row.purchase_returns_cents / 100).toFixed(2)}，销售退货 ¥${(row.sales_returns_cents / 100).toFixed(2)}`);
  }
  return lines.join('\n');
}

// Called within the business transaction. Outbox rows roll back with failed operations.
export function queueNotification(db, req, event, data, { global = false, dedupeKey = null, at = nowISO() } = {}) {
  const config = configOf(db);
  if (!config.url || (event !== 'test' && (!config.enabled || !config.events.includes(event)))) return null;
  const warehouse = global ? null : req?.warehouse || null;
  if (warehouse && config.warehouse_ids.length && !config.warehouse_ids.includes(warehouse.id)) return null;
  const payload = {
    id: randomUUID(), version: 1, event, occurred_at: at,
    business_name: db.prepare('SELECT business_name FROM settings WHERE id=1').get().business_name,
    warehouse: warehouse ? { id: warehouse.id, name: warehouse.name } : null,
    actor: req?.user ? { id: req.user.id, username: req.user.username } : null,
    data: config.include_amounts ? data : withoutAmounts(data),
  };
  payload.message = formatMessage(payload);
  const result = db.prepare(`INSERT OR IGNORE INTO notification_deliveries(id,event,payload,config_version,created_at,dedupe_key) VALUES (?,?,?,?,?,?)`)
    .run(payload.id, event, JSON.stringify(payload), config.version, at, dedupeKey);
  return result.changes ? payload.id : null;
}

export function notifyStockChanges(db, req, before, reference = {}) {
  const changes = { low_stock: [], out_of_stock: [], stock_recovered: [] };
  for (const p of before) {
    const next = db.prepare('SELECT id,name,barcode,stock,threshold,unit FROM products WHERE id=?').get(p.id);
    if (!next || next.stock === p.stock) continue;
    const item = { ...next, before_stock: p.stock };
    if (p.stock > 0 && next.stock === 0) changes.out_of_stock.push(item);
    else if (p.stock > p.threshold && next.stock > 0 && next.stock <= next.threshold) changes.low_stock.push(item);
    else if (p.stock <= p.threshold && next.stock > next.threshold) changes.stock_recovered.push(item);
  }
  for (const [event, items] of Object.entries(changes)) if (items.length) queueNotification(db, req, event, { ...reference, items });
}
export function notifyOrder(db, req, id, event, before = []) {
  const config = configOf(db);
  if (!config.enabled || !config.url || !config.events.some(key => [event, 'low_stock', 'out_of_stock', 'stock_recovered'].includes(key))) return;
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  const items = db.prepare(`SELECT i.product_id,i.name,i.barcode,i.quantity,i.price,i.amount_cents,p.unit
    FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=? ORDER BY i.id`).all(id);
  queueNotification(db, req, event, {
    order_id: id, number: order.number, type: order.type, kind: order.kind, partner: order.partner,
    total_cents: Math.round(order.total * 100),
    source_number: order.source_order_id ? db.prepare('SELECT number FROM orders WHERE id=?').get(order.source_order_id)?.number : undefined,
    reason: event === 'order_void' ? order.void_reason : order.note, items,
  });
  notifyStockChanges(db, req, before, { order_id: id, number: order.number });
}

// Existing mutation receipts short-circuit before this wrapper, so retried requests
// cannot generate a second notification. Read only the products affected by the action.
export function notificationMutation(db, req, fn) {
  const config = configOf(db);
  if (!config.enabled || !config.url || !config.events.length) return fn();
  const path = req.path.toLowerCase().replace(/\/+$/, '');
  const correction = /\/orders\/\d+\/(void|returns)$/.test(path);
  const stocktake = path.endsWith('/stocktakes');
  const reduce = path.endsWith('/stock/reduce');
  let before = [];
  if (correction) before = db.prepare('SELECT p.* FROM products p JOIN order_items i ON i.product_id=p.id WHERE i.order_id=?').all(req.params.id);
  if (stocktake || reduce) {
    const ids = reduce ? [req.body.product_id] : Array.isArray(req.body.items) ? req.body.items.map(i => i?.product_id) : [];
    before = [...new Set(ids)].filter(Number.isSafeInteger).map(id => db.prepare('SELECT * FROM products WHERE id=?').get(id)).filter(Boolean);
  }
  const result = fn();
  if (correction) notifyOrder(db, req, path.endsWith('/returns') ? result.id : Number(req.params.id), path.endsWith('/returns') ? 'order_return' : 'order_void', before);
  if (stocktake || reduce) {
    const items = before.map(p => ({ id: p.id, name: p.name, unit: p.unit, threshold: p.threshold, before_stock: p.stock, stock: db.prepare('SELECT stock FROM products WHERE id=?').get(p.id).stock }))
      .filter(p => p.before_stock !== p.stock);
    if (items.length) queueNotification(db, req, 'stock_adjustment', { action: reduce ? '报损／减少库存' : '库存盘点', reason: req.body.reason, items });
    notifyStockChanges(db, req, before);
  }
  if (/\/orders\/\d+\/(payments|settlement)$/.test(path) || /\/payments\/\d+\/reverse$/.test(path)) {
    const reversal = path.endsWith('/reverse');
    const payment = reversal ? db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.id) : null;
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(payment?.order_id || req.params.id);
    const paid = db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS amount FROM payments WHERE order_id=? AND reversed_at IS NULL').get(order.id).amount;
    const due = Math.round(order.total * 100) - paid;
    queueNotification(db, req, 'payment', {
      order_id: order.id, number: order.number, partner: order.partner, direction: order.type === 'out' ? 'receive' : 'pay',
      action: reversal ? '撤销收付款' : path.endsWith('/settlement') ? '历史收付核对' : order.type === 'out' ? '登记收款' : '登记付款',
      amount_cents: payment?.amount_cents ?? Math.round((req.body.amount ?? req.body.paid) * 100),
      paid_cents: paid, due_cents: due, payment_status: due === 0 ? 'paid' : 'unpaid', reason: req.body.reason || req.body.note,
    });
  }
  if (path.endsWith('/backup/restore')) queueNotification(db, req, 'admin_action', {
    action: '恢复业务备份', products: db.prepare('SELECT COUNT(*) AS n FROM products').get().n, orders: db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,
  }, { global: true });
  return result;
}

function localParts(date, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
export function queueDailySummary(db, now = new Date()) {
  const config = configOf(db);
  if (!config.enabled || !config.url || !config.events.includes('daily_summary')) return;
  const { day, time } = localParts(now, config.timezone);
  if (time < config.daily_time || db.prepare('SELECT 1 FROM notification_summary_days WHERE day=?').get(day)) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    const rows = db.prepare('SELECT id,name FROM warehouses ORDER BY id').all().filter(w => !config.warehouse_ids.length || config.warehouse_ids.includes(w.id)).map(w => ({
      ...w, purchase_count: 0, sales_count: 0, return_count: 0, purchase_cents: 0, sales_cents: 0, purchase_returns_cents: 0, sales_returns_cents: 0,
      low_stock: db.prepare('SELECT COUNT(*) AS n FROM products WHERE warehouse_id=? AND stock>0 AND stock<=threshold').get(w.id).n,
      out_of_stock: db.prepare('SELECT COUNT(*) AS n FROM products WHERE warehouse_id=? AND stock=0').get(w.id).n,
    }));
    const byWarehouse = new Map(rows.map(w => [w.id, w]));
    for (const o of db.prepare("SELECT warehouse_id,type,kind,total,created_at FROM orders WHERE status='active' AND created_at>=? AND created_at<=?").all(new Date(now.getTime() - 48 * 3600000).toISOString(), now.toISOString())) {
      const row = byWarehouse.get(o.warehouse_id);
      if (!row || localParts(new Date(o.created_at), config.timezone).day !== day) continue;
      const returns = o.kind === 'return';
      const purchase = returns ? o.type === 'out' : o.type === 'in';
      row[returns ? 'return_count' : purchase ? 'purchase_count' : 'sales_count']++;
      row[purchase ? 'purchase_cents' : 'sales_cents'] += Math.round(o.total * 100) * (returns ? -1 : 1);
      if (returns) row[purchase ? 'purchase_returns_cents' : 'sales_returns_cents'] += Math.round(o.total * 100);
    }
    queueNotification(db, null, 'daily_summary', { day, timezone: config.timezone, warehouses: rows }, { global: true, dedupeKey: `daily:${day}`, at: now.toISOString() });
    db.prepare('INSERT OR IGNORE INTO notification_summary_days(day) VALUES (?)').run(day);
    db.exec('COMMIT');
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
}

export function installNotifications(app, db, { webhookSend = sendWebhook } = {}) {
  app.get('/api/settings/notifications', (_, res) => res.json(publicConfig(db)));
  app.put('/api/settings/notifications', (req, res) => {
    try {
      const current = configOf(db), b = req.body || {};
      if (b.version !== current.version) return res.status(409).json({ error: '通知配置已变化，请重新打开设置后修改。' });
      if (typeof b.enabled !== 'boolean' || typeof b.include_amounts !== 'boolean' || !notificationFormats.some(f => f.key === b.format) ||
          !Array.isArray(b.events) || b.events.length > notificationEvents.length || b.events.some(e => typeof e !== 'string' || !Object.hasOwn(labels, e)) || new Set(b.events).size !== b.events.length ||
          !Array.isArray(b.warehouse_ids) || b.warehouse_ids.length > 100 || b.warehouse_ids.some(id => !Number.isSafeInteger(id) || !db.prepare('SELECT 1 FROM warehouses WHERE id=?').get(id)) || new Set(b.warehouse_ids).size !== b.warehouse_ids.length)
        throw new Error('请选择有效的通知类型、仓库和通知格式。');
      if (typeof b.daily_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.daily_time) || typeof b.timezone !== 'string' || b.timezone.length > 100) throw new Error('请填写有效的汇总时间和时区。');
      try { localParts(new Date(), b.timezone); } catch { throw new Error('时区无效，例如 Asia/Shanghai 或 UTC。'); }
      if (typeof (b.url ?? '') !== 'string' || typeof (b.secret ?? '') !== 'string' || (b.secret || '').length > 4096 || /[\x00-\x1f\x7f]/.test(b.secret || '') ||
          (b.clear_secret !== undefined && typeof b.clear_secret !== 'boolean') || (b.clear_url !== undefined && typeof b.clear_url !== 'boolean')) throw new Error('Webhook 地址或签名密钥格式无效。');
      const url = b.clear_url ? '' : b.url?.trim() || current.url;
      if (url) validateWebhookUrl(url);
      if (b.enabled && !url) throw new Error('请先填写 Webhook 地址。');
      const secret = b.clear_secret || b.format === 'wecom' ? '' : b.secret?.trim() || (b.format === current.format ? current.secret : '');
      db.exec('BEGIN IMMEDIATE');
      try {
        if (db.prepare('SELECT version FROM notification_settings WHERE id=1').get().version !== current.version) {
          db.exec('ROLLBACK'); return res.status(409).json({ error: '通知配置已变化，请重新打开设置后修改。' });
        }
        db.prepare(`UPDATE notification_settings SET enabled=?,url=?,format=?,secret=?,events=?,warehouse_ids=?,include_amounts=?,daily_time=?,timezone=?,version=version+1 WHERE id=1`)
          .run(Number(b.enabled), url, b.format, secret, JSON.stringify(b.events), JSON.stringify(b.warehouse_ids), Number(b.include_amounts), b.daily_time, b.timezone);
        db.prepare("UPDATE notification_deliveries SET status='cancelled',last_error='通知配置已更新。' WHERE status IN ('pending','retry','sending','failed')").run();
        db.exec('COMMIT');
      } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
      res.json(publicConfig(db));
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.get('/api/settings/notifications/deliveries', (_, res) => res.json(db.prepare('SELECT id,event,created_at,status,attempts,next_at,last_error FROM notification_deliveries ORDER BY created_at DESC,rowid DESC LIMIT 50').all()));
  app.post('/api/settings/notifications/test', (req, res) => {
    const config = configOf(db);
    if (req.body?.version !== config.version) return res.status(409).json({ error: '通知配置已变化，请重新打开设置。' });
    if (!config.url) return res.status(400).json({ error: '请先保存 Webhook 地址。' });
    if (db.prepare("SELECT 1 FROM notification_deliveries WHERE event='test' AND created_at>? LIMIT 1").get(new Date(Date.now() - 30000).toISOString())) return res.status(429).json({ error: '请等待 30 秒后再发送测试通知。' });
    const id = queueNotification(db, req, 'test', { action: 'Webhook 连接测试' }, { global: true });
    res.status(202).json({ id });
  });
  app.post('/api/settings/notifications/deliveries/:id/retry', (req, res) => {
    const config = configOf(db);
    const row = db.prepare('SELECT * FROM notification_deliveries WHERE id=?').get(req.params.id);
    if (!row || !['failed', 'retry'].includes(row.status) || row.config_version !== config.version || (!config.enabled && row.event !== 'test')) return res.status(400).json({ error: '这条记录不能重试，请检查通知配置和发送状态。' });
    db.prepare("UPDATE notification_deliveries SET status='pending',attempts=0,next_at=0,last_error='' WHERE id=?").run(row.id);
    res.json({ ok: true });
  });

  let timer, running = null, stopped = false;
  const tick = () => {
    if (running || stopped) return running || Promise.resolve();
    running = (async () => {
      queueDailySummary(db);
      for (let i = 0; i < 10 && !stopped; i++) {
        const now = Date.now();
        const row = db.prepare("SELECT * FROM notification_deliveries WHERE status IN ('pending','retry','sending') AND next_at<=? ORDER BY created_at,rowid LIMIT 1").get(now);
        if (!row) break;
        const config = configOf(db);
        if (row.config_version !== config.version || !config.url || (row.event !== 'test' && (!config.enabled || !config.events.includes(row.event)))) {
          db.prepare("UPDATE notification_deliveries SET status='cancelled' WHERE id=?").run(row.id); continue;
        }
        // Conditional claim also supports two server processes sharing a database.
        const claimed = db.prepare("UPDATE notification_deliveries SET status='sending',attempts=attempts+1,next_at=? WHERE id=? AND status IN ('pending','retry','sending') AND next_at<=?").run(now + 60000, row.id, now);
        if (!claimed.changes) continue;
        try {
          await webhookSend(config, JSON.parse(row.payload));
          db.prepare("UPDATE notification_deliveries SET status='sent',last_error='' WHERE id=? AND status='sending' AND config_version=?").run(row.id, config.version);
        } catch {
          const attempts = row.attempts + 1;
          const delay = [30000, 120000, 600000, 3600000][Math.min(attempts - 1, 3)];
          // Do not store remote response bodies or URLs: they can contain webhook tokens.
          db.prepare("UPDATE notification_deliveries SET status=?,next_at=?,last_error=? WHERE id=? AND status='sending' AND config_version=?")
            .run(attempts >= 5 ? 'failed' : 'retry', Date.now() + delay, '发送失败，请检查地址、签名密钥、机器人设置及网络。', row.id, config.version);
        }
      }
      db.prepare("DELETE FROM notification_deliveries WHERE status IN ('sent','cancelled') AND created_at<?").run(new Date(Date.now() - 30 * 86400000).toISOString());
    })().finally(() => { running = null; });
    return running;
  };
  return {
    tick,
    start() { if (timer) return; stopped = false; timer = setInterval(() => { void tick().catch(() => {}); }, 2000); timer.unref(); void tick().catch(() => {}); },
    async stop() { stopped = true; clearInterval(timer); timer = null; await running; },
  };
}
