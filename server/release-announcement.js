import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const releases = JSON.parse(readFileSync(new URL('../shared/release-notes.json', import.meta.url), 'utf8'));

// Keep a separate publication receipt so deleting or editing a notice survives restarts.
export function publishReleaseAnnouncement(db) {
  const release = releases[version];
  if (!release || db.prepare('SELECT 1 FROM release_announcements WHERE version=?').get(version)) return true;
  const author = db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get();
  if (!author) return false;
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT 1 FROM release_announcements WHERE version=?').get(version)) {
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO announcements(title,content,pinned,created_by,created_by_name,created_at,updated_at)
        VALUES (?,?,0,?,'系统更新',?,?)`)
        .run(`77 ERP ${version} 更新公告`, `${release.date}\n\n${release.content.join('\n')}`, author.id, now, now);
      db.prepare('INSERT INTO release_announcements(version,published_at) VALUES (?,?)').run(version, now);
    }
    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
