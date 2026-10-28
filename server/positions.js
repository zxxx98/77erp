import { permissionKeys, legacyPermissions, combinePositionAuthorization } from '../shared/permissions.js';
import { queueNotification } from './notifications.js';

const migrationKey = 'employee_positions_v1';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const validId = value => Number.isSafeInteger(value) && value > 0;
function normalizePermissions(value) {
  if (!Array.isArray(value) || value.some(key => !permissionKeys.includes(key)) || new Set(value).size !== value.length)
    fail('请选择有效且不重复的业务权限。');
  return permissionKeys.filter(key => value.includes(key));
}

// The marker, DDL, generated positions and assignments are one atomic upgrade.
// Take the write lock before checking the marker so simultaneous starts cannot repeat it.
export function migratePositions(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT 1 FROM app_metadata WHERE key=?').get(migrationKey)) {
      db.exec('COMMIT'); return;
    }
    db.exec(`CREATE TABLE positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
      permissions TEXT NOT NULL, legacy_permissions INTEGER NOT NULL DEFAULT 0 CHECK(legacy_permissions IN (0,1)),
      version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE position_changes (
      id INTEGER PRIMARY KEY, position_id INTEGER, user_id INTEGER REFERENCES users(id),
      changed_by INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL,
      before_json TEXT, after_json TEXT, created_at TEXT NOT NULL
    );
    ALTER TABLE users ADD COLUMN position_id INTEGER REFERENCES positions(id);
    CREATE INDEX users_position ON users(position_id);`);
    const at = new Date().toISOString();
    const insert = db.prepare('INSERT INTO positions(name,description,permissions,legacy_permissions,created_at,updated_at) VALUES(?,?,?,?,?,?)');
    const readerId = Number(insert.run('只读员工', '可查看基础业务数据，无额外业务操作权限。', '[]', 0, at, at).lastInsertRowid);
    const groups = new Map([['0:[]', readerId]]);
    const employees = db.prepare("SELECT id,username,permissions FROM users WHERE role='employee' ORDER BY id").all();
    let sequence = 0;
    for (const user of employees) {
      const legacy = user.permissions === null;
      let permissions;
      try { permissions = normalizePermissions(legacy ? legacyPermissions : JSON.parse(user.permissions)); }
      catch { fail(`员工 ${user.username} 的原权限数据无效，岗位迁移已回滚，请修复原权限后重试。`); }
      const value = JSON.stringify(permissions), key = `${Number(legacy)}:${value}`;
      let id = groups.get(key);
      if (!id) {
        id = Number(insert.run(legacy ? '旧版员工' : `迁移岗位 ${++sequence}`,
          legacy ? '保留旧版员工权限规则；切换为标准模块权限前请核对成员。' : '由现有员工权限自动迁移，可按工作职责改名。',
          value, Number(legacy), at, at).lastInsertRowid);
        groups.set(key, id);
      }
      db.prepare('UPDATE users SET position_id=?,permissions_version=permissions_version+1 WHERE id=?').run(id, user.id);
      const assigned = db.prepare('SELECT p.permissions,p.legacy_permissions FROM users u JOIN positions p ON p.id=u.position_id WHERE u.id=?').get(user.id);
      if (!assigned || assigned.permissions !== value || !!assigned.legacy_permissions !== legacy)
        fail(`员工 ${user.username} 的迁移权限核对失败，岗位迁移已回滚。`);
    }
    db.prepare('INSERT INTO app_metadata(key,value) VALUES(?,?)').run(migrationKey, '1');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function requirePosition(db, id) {
  if (!validId(id)) fail('请为员工选择有效岗位。');
  const row = db.prepare('SELECT * FROM positions WHERE id=?').get(id);
  if (!row) fail('所选岗位不存在，请刷新后重新选择。');
  return row;
}

export function migrateUserPositions(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare("SELECT 1 FROM app_metadata WHERE key='user_positions_v1'").get()) {
      db.exec(`CREATE TABLE user_positions (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        position_id INTEGER NOT NULL REFERENCES positions(id),
        PRIMARY KEY(user_id,position_id)
      );
      CREATE INDEX user_positions_position ON user_positions(position_id);
      INSERT INTO user_positions SELECT id,position_id FROM users WHERE role='employee' AND position_id IS NOT NULL;
      -- Keep the old single-position column writable for existing integrations.
      CREATE TRIGGER user_positions_insert AFTER INSERT ON users WHEN NEW.role='employee' AND NEW.position_id IS NOT NULL
      BEGIN INSERT INTO user_positions VALUES(NEW.id,NEW.position_id); END;
      CREATE TRIGGER user_positions_update AFTER UPDATE OF position_id,role ON users
      WHEN OLD.position_id IS NOT NEW.position_id OR OLD.role IS NOT NEW.role
      BEGIN
        DELETE FROM user_positions WHERE user_id=NEW.id;
        INSERT INTO user_positions SELECT NEW.id,NEW.position_id WHERE NEW.role='employee' AND NEW.position_id IS NOT NULL;
      END;`);
      db.prepare('INSERT INTO app_metadata(key,value) VALUES(?,?)').run('user_positions_v1', '1');
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function requirePositions(db, body) {
  const ids = body?.position_ids !== undefined ? body.position_ids : (body?.position_id === undefined ? undefined : [body.position_id]);
  if (!Array.isArray(ids) || !ids.length || ids.some(id => !validId(id)) || new Set(ids).size !== ids.length)
    fail('请为员工选择至少一个有效且不重复的岗位。');
  if (body.position_ids !== undefined && body.position_id !== undefined && body.position_id !== ids[0])
    fail('岗位参数不一致，请刷新后重新选择。');
  return [...ids].sort((a,b) => a-b).map(id => requirePosition(db,id));
}

export function assignPositions(db, userId, positions) {
  db.prepare('UPDATE users SET position_id=? WHERE id=?').run(positions[0]?.id ?? null,userId);
  db.prepare('DELETE FROM user_positions WHERE user_id=?').run(userId);
  const insert = db.prepare('INSERT INTO user_positions(user_id,position_id) VALUES(?,?)');
  for (const position of positions) insert.run(userId,position.id);
}

export function positionAuthorization(db, user) {
  const positions = db.prepare(`SELECT p.id,p.name,p.permissions,p.legacy_permissions,p.access_mode
    FROM user_positions up JOIN positions p ON p.id=up.position_id WHERE up.user_id=? ORDER BY p.id`).all(user.id)
    .map(row => ({...row,permissions:JSON.parse(row.permissions),legacy_permissions:!!row.legacy_permissions}));
  // Never fall back to retired users.permissions, even for missing/corrupt associations.
  return {
    position_id: positions[0]?.id ?? null, position_name: positions[0]?.name ?? null,
    position_ids: positions.map(position => position.id), position_names: positions.map(position => position.name), positions,
    ...combinePositionAuthorization(positions),
  };
}

export function recordPositionChange(db, req, action, positionId, userId, before, after) {
  db.prepare('INSERT INTO position_changes(position_id,user_id,changed_by,action,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(positionId, userId, req.user.id, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), new Date().toISOString());
  const target = userId == null ? null : db.prepare('SELECT username FROM users WHERE id=?').get(userId);
  queueNotification(db, req, 'admin_action', { action, position_id: positionId, user_id: userId,
    ...(target ? {target_user:target.username} : {}), before, after }, { global: true });
}

const present = row => ({ ...row, permissions: JSON.parse(row.permissions), legacy_permissions: !!row.legacy_permissions });
const selectPosition = `SELECT p.*, (SELECT COUNT(*) FROM user_positions up WHERE up.position_id=p.id) AS member_count FROM positions p`;
export function installPositions(app, db) {
  const read = id => present(db.prepare(`${selectPosition} WHERE p.id=?`).get(id));
  const route = (fn, {write = false, status = 200} = {}) => (req, res, next) => {
    if (req.user?.role !== 'admin') return res.status(403).json({error:'仅管理员可以配置岗位。'});
    try {
      if (write) db.exec('BEGIN IMMEDIATE');
      let result;
      try { result = fn(req); if (write) db.exec('COMMIT'); }
      catch (error) { if (write) db.exec('ROLLBACK'); throw error; }
      res.status(status).json(result);
    } catch (error) {
      if (error.status) return res.status(error.status).json({error:error.message});
      if (error.message.includes('UNIQUE constraint failed: positions.name')) return res.status(409).json({error:'岗位名称已存在。'});
      next(error);
    }
  };
  const current = req => {
    const id = Number(req.params.id);
    if (!validId(id)) fail('岗位编号无效。');
    const row = db.prepare('SELECT * FROM positions WHERE id=?').get(id);
    if (!row) fail('岗位不存在，请刷新列表。',404);
    if (!validId(req.body?.version) || req.body.version !== row.version) fail('岗位配置已被修改，请重新打开后核对。',409);
    return row;
  };
  const fields = (body, before) => {
    if (typeof body?.name !== 'string' || !body.name.trim() || body.name.trim().length > 60 ||
        (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 200)))
      fail('请填写 1–60 字的岗位名称和最多 200 字的说明。');
    const permissions=normalizePermissions(body.permissions), access_mode=body.access_mode ?? before?.access_mode ?? 'standard';
    if (!['standard','production_only'].includes(access_mode)) fail('请选择有效的岗位访问模式。');
    if (access_mode === 'production_only' && (permissions.length !== 1 || permissions[0] !== 'production_register'))
      fail('仅生产作业岗位只能配置本组生产登记权限。');
    return {name:body.name.trim(),description:(body.description ?? '').trim(),permissions,access_mode};
  };
  app.get('/api/positions', route(() => db.prepare(`${selectPosition} ORDER BY p.id`).all().map(present)));
  app.post('/api/positions', route(req => {
    if (req.body?.legacy_permissions !== undefined || req.body?.convert_legacy !== undefined) fail('新岗位只能使用标准模块权限。');
    const value = fields(req.body), at = new Date().toISOString();
    const id = Number(db.prepare('INSERT INTO positions(name,description,permissions,access_mode,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(value.name,value.description,JSON.stringify(value.permissions),value.access_mode,at,at).lastInsertRowid);
    const result = read(id);
    recordPositionChange(db,req,'新增岗位',id,null,null,result);
    return result;
  }, {write:true,status:201}));
  app.put('/api/positions/:id', route(req => {
    const before = current(req), value = fields(req.body,before), permissions = JSON.stringify(value.permissions);
    if (req.body.convert_legacy !== undefined && typeof req.body.convert_legacy !== 'boolean') fail('请明确确认是否切换旧版权限。');
    if (req.body.legacy_permissions !== undefined && req.body.legacy_permissions !== !!before.legacy_permissions)
      fail('不能直接修改旧版兼容标记，请使用切换权限操作。');
    if (before.legacy_permissions && (permissions !== before.permissions || value.access_mode !== before.access_mode) && req.body.convert_legacy !== true)
      fail('此岗位仍沿用旧版权限，请确认切换为标准模块权限后保存。',409);
    const legacy = before.legacy_permissions && req.body.convert_legacy !== true ? 1 : 0;
    const authorizationChanged = permissions !== before.permissions || legacy !== before.legacy_permissions || value.access_mode !== before.access_mode;
    db.prepare('UPDATE positions SET name=?,description=?,permissions=?,legacy_permissions=?,access_mode=?,version=version+1,updated_at=? WHERE id=?')
      .run(value.name,value.description,permissions,legacy,value.access_mode,new Date().toISOString(),before.id);
    if (authorizationChanged) db.prepare("UPDATE users SET permissions_version=permissions_version+1 WHERE id IN (SELECT user_id FROM user_positions WHERE position_id=?) AND role='employee'").run(before.id);
    const result = read(before.id);
    recordPositionChange(db,req,'修改岗位',before.id,null,present(before),result);
    return result;
  }, {write:true}));
  app.delete('/api/positions/:id', route(req => {
    const before = current(req);
    if (db.prepare('SELECT 1 FROM user_positions WHERE position_id=? LIMIT 1').get(before.id)) fail('岗位仍有关联员工（包括停用账号），请先调整员工岗位。',409);
    db.prepare('DELETE FROM positions WHERE id=?').run(before.id);
    recordPositionChange(db,req,'删除岗位',before.id,null,present(before),null);
    return {ok:true};
  }, {write:true}));
  app.put('/api/users/:id/position', route(req => {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!user) fail('账号不存在。',404);
    if (user.role !== 'employee') fail('管理员拥有全部权限，无需分配岗位。');
    if (!validId(req.body?.version) || user.permissions_version !== req.body.version) fail('员工岗位或权限已变化，请刷新后重新选择。',409);
    const positions = requirePositions(db,req.body), before = positionAuthorization(db,user).position_ids;
    const after = positions.map(position => position.id);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      assignPositions(db,user.id,positions);
      db.prepare('UPDATE users SET permissions_version=permissions_version+1 WHERE id=?').run(user.id);
      recordPositionChange(db,req,'调整员工岗位',after[0],user.id,{position_ids:before},{position_ids:after});
    }
    return {ok:true};
  }, {write:true}));
}

// Preserve existing access once; newly created positions must explicitly opt in.
export function migrateBasicView(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare("SELECT 1 FROM app_metadata WHERE key='position_basic_view_v1'").get()) {
      for (const row of db.prepare("SELECT id,permissions FROM positions WHERE access_mode='standard'").all()) {
        const permissions = JSON.parse(row.permissions);
        if (permissions.includes('basic_view')) continue;
        db.prepare('UPDATE positions SET permissions=?,version=version+1 WHERE id=?')
          .run(JSON.stringify(['basic_view', ...permissions]), row.id);
        db.prepare("UPDATE users SET permissions_version=permissions_version+1 WHERE position_id=? AND role='employee'").run(row.id);
      }
      db.prepare('INSERT INTO app_metadata(key,value) VALUES(?,?)').run('position_basic_view_v1', '1');
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
