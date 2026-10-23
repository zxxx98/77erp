// Rebuild a table without changing its IDs or references in other tables.
// SQLite cannot remove table UNIQUE / NOT NULL constraints with ALTER COLUMN.
export function rebuildTable(db, table, transform) {
  if (db.isTransaction) throw new Error('表结构迁移不能嵌套在业务事务内。');
  const original = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql;
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name=? AND type IN ('index','trigger') AND sql IS NOT NULL").all(table);
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => `"${row.name}"`).join(',');
  const replacement = transform(original).replace(/^(CREATE TABLE\s+(?:IF NOT EXISTS\s+)?)(?:"[^"]+"|\w+)/i, `$1${table}_migration`);
  db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; BEGIN IMMEDIATE');
  try {
    db.exec(replacement);
    db.exec(`INSERT INTO ${table}_migration (${columns}) SELECT ${columns} FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_migration RENAME TO ${table};`);
    for (const row of schema) db.exec(row.sql);
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('表结构迁移外键检查失败。');
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally { db.exec('PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys=ON'); }
}
