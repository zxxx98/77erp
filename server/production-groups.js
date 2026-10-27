import { hasPermission } from '../shared/permissions.js';
import { recordPositionChange } from './positions.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const validId = value => Number.isSafeInteger(value) && value > 0;

export function migrateProductionGroups(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare("SELECT 1 FROM app_metadata WHERE key='production_groups_v1'").get()) { db.exec('COMMIT'); return; }
    db.exec(`CREATE TABLE production_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    ALTER TABLE positions ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'standard' CHECK(access_mode IN ('standard','production_only'));
    ALTER TABLE users ADD COLUMN production_group_id INTEGER REFERENCES production_groups(id);
    CREATE INDEX users_production_group ON users(production_group_id);
    ALTER TABLE production_orders ADD COLUMN production_group_id INTEGER REFERENCES production_groups(id);
    ALTER TABLE production_orders ADD COLUMN production_group_name TEXT NOT NULL DEFAULT '';
    CREATE INDEX production_orders_group ON production_orders(warehouse_id,production_group_id,id);
    ALTER TABLE production_batches ADD COLUMN created_by INTEGER REFERENCES users(id);
    ALTER TABLE production_batches ADD COLUMN production_group_id INTEGER REFERENCES production_groups(id);
    ALTER TABLE production_batches ADD COLUMN production_group_name TEXT NOT NULL DEFAULT '';
    INSERT INTO app_metadata(key,value) VALUES('production_groups_v1','1');`);
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}

export function requireProductionGroup(db, id) {
  if (id === null) return null;
  if (!validId(id)) fail('请选择有效生产组，或选择不属于生产组。');
  const group = db.prepare('SELECT * FROM production_groups WHERE id=?').get(id);
  if (!group) fail('生产组不存在，请刷新后重新选择。');
  return group;
}

export function installProductionGroups(app, db) {
  const select = `SELECT g.*,(SELECT COUNT(*) FROM users u WHERE u.production_group_id=g.id) AS member_count
    FROM production_groups g`;
  const read = id => db.prepare(`${select} WHERE g.id=?`).get(id);
  const route = (fn, write = false, status = 200) => (req,res,next) => {
    if (write ? req.user.role !== 'admin' : !hasPermission(req.user,'production'))
      return res.status(403).json({error:'没有生产组配置权限。'});
    try {
      if(write) db.exec('BEGIN IMMEDIATE');
      let result;
      try { result=fn(req); if(write) db.exec('COMMIT'); }
      catch(error) { if(write) db.exec('ROLLBACK'); throw error; }
      res.status(status).json(result);
    } catch(error) {
      if(error.status) return res.status(error.status).json({error:error.message});
      if(error.message.includes('UNIQUE constraint failed: production_groups.name')) return res.status(409).json({error:'生产组名称已存在。'});
      next(error);
    }
  };
  const fields = body => {
    if(typeof body?.name !== 'string' || !body.name.trim() || body.name.trim().length > 60 ||
      body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 200))
      fail('请填写 1–60 字的生产组名称和最多 200 字的说明。');
    return {name:body.name.trim(),description:(body.description ?? '').trim()};
  };
  const current = req => {
    const id=Number(req.params.id);
    if(!validId(id)) fail('生产组编号无效。');
    const row=read(id);
    if(!row) fail('生产组不存在。',404);
    if(!validId(req.body?.version) || row.version !== req.body.version) fail('生产组已被修改，请刷新后重试。',409);
    return row;
  };
  app.get('/api/production-groups',route(() => db.prepare(`${select} ORDER BY g.id`).all()));
  app.post('/api/production-groups',route(req => {
    const value=fields(req.body), at=new Date().toISOString();
    const id=Number(db.prepare('INSERT INTO production_groups(name,description,created_at,updated_at) VALUES(?,?,?,?)').run(value.name,value.description,at,at).lastInsertRowid);
    const result=read(id); recordPositionChange(db,req,'新增生产组',null,null,null,result); return result;
  },true,201));
  app.put('/api/production-groups/:id',route(req => {
    const before=current(req), value=fields(req.body);
    db.prepare('UPDATE production_groups SET name=?,description=?,version=version+1,updated_at=? WHERE id=?').run(value.name,value.description,new Date().toISOString(),before.id);
    db.prepare('UPDATE users SET permissions_version=permissions_version+1 WHERE production_group_id=?').run(before.id);
    const result=read(before.id); recordPositionChange(db,req,'修改生产组',null,null,before,result); return result;
  },true));
  app.delete('/api/production-groups/:id',route(req => {
    const before=current(req);
    if(before.member_count || db.prepare('SELECT 1 FROM production_orders WHERE production_group_id=? LIMIT 1').get(before.id) ||
      db.prepare('SELECT 1 FROM production_batches WHERE production_group_id=? LIMIT 1').get(before.id) ||
      db.prepare("SELECT 1 FROM production_orders,json_each(assigned_groups) WHERE json_extract(value,'$.id')=? LIMIT 1").get(before.id))
      fail('生产组仍有关联员工或生产单，不能删除。',409);
    db.prepare('DELETE FROM production_groups WHERE id=?').run(before.id);
    recordPositionChange(db,req,'删除生产组',null,null,before,null); return {ok:true};
  },true));
  app.put('/api/users/:id/production-group',route(req => {
    const user=db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if(!user) fail('账号不存在。',404);
    if(user.role !== 'employee') fail('管理员无需分配生产组。');
    if(!validId(req.body?.version) || user.permissions_version !== req.body.version) fail('员工岗位或生产组已变化，请刷新后重试。',409);
    const group=requireProductionGroup(db,req.body.production_group_id), id=group?.id ?? null;
    if(id !== user.production_group_id) {
      db.prepare('UPDATE users SET production_group_id=?,permissions_version=permissions_version+1 WHERE id=?').run(id,user.id);
      recordPositionChange(db,req,'调整员工生产组',user.position_id,user.id,{production_group_id:user.production_group_id},{production_group_id:id});
    }
    return {ok:true};
  },true));
}
