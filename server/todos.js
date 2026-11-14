import { AsyncLocalStorage } from 'node:async_hooks';
import { hasPermission } from '../shared/permissions.js';

const requests = new AsyncLocalStorage();
export function installTodoContext(app, db) {
  // Async context retains the actual submitting account across acceptance storage I/O.
  app.use('/api', (req, res, next) => requests.run(req, next));
  db.function('todo_submitter', () => {
    const req = requests.getStore();
    if (!req || /\/(?:backup|settings)\//.test(req.path)) return null;
    if (req.params.registrationId) return db.prepare('SELECT registered_by FROM production_operation_registrations WHERE id=?').get(Number(req.params.registrationId))?.registered_by ?? null;
    return req.user?.id ?? null;
  });
}

const sources = [
  { table: 'orders', key: 'order', approved: 'active', owner: 's.created_by', number: 's.number', title: 's.partner', label: "'order_'||s.type", permission: "'stock_approve'", condition: "s.approval_origin='workflow' AND s.kind IN ('normal','internal')", at: 's.approved_at' },
  { table: 'production_material_documents', key: 'material', approved: 'confirmed', label: "'material_'||s.kind", at: 's.confirmed_at' },
  { table: 'production_receipts', key: 'receipt', approved: 'confirmed', label: "'receipt'", at: 's.confirmed_at' },
  { table: 'production_stage_receipts', key: 'stage_receipt', approved: 'confirmed', label: "'stage_receipt'", at: 's.confirmed_at' },
  { table: 'production_operation_registrations', key: 'registration', approved: 'approved', owner: 's.registered_by', label: "CASE WHEN s.kind='settlement' OR s.acceptance_id IS NOT NULL THEN 'settlement' ELSE 'acceptance' END", permission: "CASE WHEN s.kind='settlement' OR s.acceptance_id IS NOT NULL THEN 'production' ELSE 'operation_accept' END", at: 's.resolved_at' },
];
const from = spec => `${spec.table} s${spec.key === 'order' ? '' : ' JOIN production_orders p ON p.id=s.production_id'}`;
const field = (spec, name) => spec.key === 'registration' ? `p.${name}` : `s.${name}`;
const sourceQuery = spec => `SELECT '${spec.key}' AS source,s.id AS source_id,${field(spec,'warehouse_id')} AS warehouse_id,
  ${spec.number || (spec.key === 'registration' ? 'p.number' : 's.number')} AS number,${spec.title || 'p.product_name'} AS title,
  ${spec.owner || 'NULL'} AS owner,${spec.key === 'registration' ? 's.registered_by_name' : 's.created_by_name'} AS submitter_name,
  s.created_at,s.status,${spec.at} AS approved_at,${spec.label} AS kind,${spec.permission || "'stock_approve'"} AS permission,
  ${spec.key === 'order' ? 'NULL' : 'p.id'} AS production_id,
  ${spec.key === 'order' ? "NULL AS assigned_groups,NULL AS assigned_users,NULL AS production_group_id" : 'p.assigned_groups,p.assigned_users,p.production_group_id'},
  ${spec.key === 'order' ? 's.status' : 'p.status'} AS production_status,
  ${spec.key === 'registration' ? "(s.endpoint='operations/report' OR json_extract(s.body,'$.finish_order')=0)" : '1'} AS group_approvable
  FROM ${from(spec)} WHERE ${spec.condition || '1'}`;
const allSources = `WITH documents AS (${sources.map(sourceQuery).join(' UNION ALL ')})`;

export function installTodos(app, db) {
  db.exec(`CREATE TABLE IF NOT EXISTS todo_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, source_id INTEGER NOT NULL,
    event TEXT NOT NULL CHECK(event IN ('pending','approved')), submitter_id INTEGER, occurred_at TEXT NOT NULL,
    UNIQUE(source,source_id,event));
    CREATE TABLE IF NOT EXISTS todo_acknowledgements (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id INTEGER NOT NULL REFERENCES todo_events(id) ON DELETE CASCADE,
      acknowledged_at TEXT NOT NULL, PRIMARY KEY(user_id,event_id));
    CREATE INDEX IF NOT EXISTS todo_events_submitter ON todo_events(submitter_id,event);`);
  for (const spec of sources) {
    const pending = `INSERT OR IGNORE INTO todo_events(source,source_id,event,submitter_id,occurred_at)
      SELECT source,source_id,'pending',COALESCE(owner,todo_submitter()),created_at FROM (${sourceQuery(spec)}) WHERE source_id=NEW.id AND status='pending';`;
    db.exec(`CREATE TRIGGER IF NOT EXISTS todo_${spec.key}_insert AFTER INSERT ON ${spec.table} BEGIN ${pending} END;
      CREATE TRIGGER IF NOT EXISTS todo_${spec.key}_update AFTER UPDATE OF status ON ${spec.table} WHEN OLD.status IS NOT NEW.status BEGIN
        ${pending}
        INSERT OR IGNORE INTO todo_events(source,source_id,event,submitter_id,occurred_at)
          SELECT source,source_id,'approved',(SELECT submitter_id FROM todo_events WHERE source='${spec.key}' AND source_id=NEW.id AND event='pending'),approved_at
          FROM (${sourceQuery(spec)}) WHERE source_id=NEW.id AND status='${spec.approved}' AND approved_at IS NOT NULL;
      END;
      CREATE TRIGGER IF NOT EXISTS todo_${spec.key}_delete AFTER DELETE ON ${spec.table} BEGIN
        DELETE FROM todo_events WHERE source='${spec.key}' AND source_id=OLD.id;
      END;`);
    // Existing pending documents appear immediately; historical approvals are not replayed.
    db.exec(`INSERT OR IGNORE INTO todo_events(source,source_id,event,submitter_id,occurred_at)
      SELECT source,source_id,'pending',owner,created_at FROM (${sourceQuery(spec)}) WHERE status='pending'`);
  }
  const authorized = user => {
    const can = key => hasPermission(user,key) ? '1' : '0';
    const assignment = `(d.production_group_id=${Number(user.production_group_id)||0} AND d.production_group_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM json_each(d.assigned_groups) g WHERE json_extract(g.value,'$.id')=${Number(user.production_group_id)||0})
      OR EXISTS (SELECT 1 FROM json_each(d.assigned_users) u WHERE json_extract(u.value,'$.id')=${user.id}))`;
    return `(d.permission='stock_approve' AND ${can('stock_approve')}
      OR d.permission='production' AND ${can('production')}
      OR d.permission='operation_accept' AND ${can('operation_accept')} AND (${can('production')} OR ${can('production_register')} AND d.group_approvable AND ${assignment}))`;
  };
  const pending = user => `d.status='pending' AND d.production_status!='void' AND ${authorized(user)}`;
  const unread = user => `((e.event='pending' AND ${authorized(user)}) OR (e.event='approved' AND e.submitter_id=${user.id}))
    AND NOT EXISTS(SELECT 1 FROM todo_acknowledgements a WHERE a.user_id=${user.id} AND a.event_id=e.id)`;
  const joined = 'FROM todo_events e JOIN documents d ON d.source=e.source AND d.source_id=e.source_id';
  app.get('/api/todos', (req,res) => {
    const { offset='0', limit='20', q='' }=req.query;
    if (!/^\d+$/.test(String(offset)) || !Number.isSafeInteger(Number(offset)) || !/^\d+$/.test(String(limit)) || Number(limit)<1 || Number(limit)>100 || typeof q!=='string' || q.length>100)
      return res.status(400).json({error:'待办查询参数无效。'});
    const where = `${pending(req.user)} AND (d.number LIKE ? ESCAPE '\\' OR d.title LIKE ? ESCAPE '\\' OR d.submitter_name LIKE ? ESCAPE '\\')`;
    const search = `%${q.replace(/[\\%_]/g,'\\$&')}%`, params=[search,search,search];
    const total=db.prepare(`${allSources} SELECT COUNT(*) n FROM documents d WHERE ${where}`).get(...params).n;
    const items=db.prepare(`${allSources} SELECT d.source,d.source_id,d.warehouse_id,w.name AS warehouse_name,d.number,d.title,d.kind,d.submitter_name,d.created_at,d.production_id
      FROM documents d JOIN warehouses w ON w.id=d.warehouse_id WHERE ${where} ORDER BY d.created_at,d.source,d.source_id LIMIT ? OFFSET ?`).all(...params,Number(limit),Number(offset));
    res.json({user_id:req.user.id,items,total,has_more:Number(offset)+items.length<total});
  });
  app.get('/api/todo-notifications', (req,res) => {
    const summary=db.prepare(`${allSources} SELECT COUNT(*) AS total,COALESCE(SUM(e.event='pending'),0) AS pending,COALESCE(SUM(e.event='approved'),0) AS approved,COALESCE(MAX(e.id),0) AS through_id ${joined} WHERE ${unread(req.user)}`).get();
    const items=db.prepare(`${allSources} SELECT e.id,e.event,d.number,d.kind,(d.status='pending' AND d.production_status!='void') AS task_pending,d.warehouse_id,w.name AS warehouse_name ${joined} JOIN warehouses w ON w.id=d.warehouse_id WHERE ${unread(req.user)} ORDER BY e.id DESC LIMIT 5`).all();
    res.json({user_id:req.user.id,...summary,items});
  });
  app.post('/api/todo-notifications/acknowledge', (req,res) => {
    const id=req.body?.through_id;
    if (!Number.isSafeInteger(id)||id<1) return res.status(400).json({error:'通知确认参数无效。'});
    db.prepare(`${allSources} INSERT OR IGNORE INTO todo_acknowledgements(user_id,event_id,acknowledged_at)
      SELECT ?,e.id,? ${joined} WHERE e.id<=? AND ${unread(req.user)}`).run(req.user.id,new Date().toISOString(),id);
    res.json({ok:true});
  });
}
