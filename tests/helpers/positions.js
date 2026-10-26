import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { legacyPermissions } from '../../shared/permissions.js';

export function readonlyPositionId(db) {
  const row = db.prepare("SELECT id FROM positions WHERE legacy_permissions=0 AND permissions=? ORDER BY id LIMIT 1").get(JSON.stringify(['basic_view']));
  assert.ok(row, 'startup creates a readonly position');
  return row.id;
}

// Ordinary authorization fixtures use the same APIs as the administrator UI.
export async function grantPosition(db, request, userId, permissions) {
  const created = await request('/positions', { name: `Test ${randomUUID()}`, description: '', permissions }, 'POST');
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const user = db.prepare('SELECT permissions_version FROM users WHERE id=?').get(userId);
  const result = await request(`/users/${userId}/position`, { position_id: created.data.id, version: user.permissions_version }, 'PUT');
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result;
}

// Explicitly model a migrated legacy position; users.permissions is no longer authoritative.
export function legacyPosition(db, userId) {
  const position = db.prepare("INSERT INTO positions(name,description,permissions,legacy_permissions,created_at,updated_at) VALUES(?, '', ?, 1, ?, ?)").run(`Legacy ${randomUUID()}`, JSON.stringify(['basic_view', ...legacyPermissions]), new Date().toISOString(), new Date().toISOString());
  db.prepare('UPDATE users SET position_id=? WHERE id=?').run(position.lastInsertRowid, userId);
}
