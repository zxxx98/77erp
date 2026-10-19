import { publishReleaseAnnouncement } from './release-announcement.js';

export function installAnnouncements(app, db) {
  db.exec(`CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, content TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
    created_by INTEGER NOT NULL REFERENCES users(id), created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, content_version INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS announcement_reads (
    announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id), content_version INTEGER NOT NULL,
    read_at TEXT NOT NULL, PRIMARY KEY(announcement_id,user_id)
  );
  CREATE INDEX IF NOT EXISTS announcements_listing ON announcements(pinned DESC,created_at DESC,id DESC);
  CREATE TABLE IF NOT EXISTS release_announcements (version TEXT PRIMARY KEY, published_at TEXT NOT NULL);`);

  let releasePublished = publishReleaseAnnouncement(db);
  // Fresh installations have no administrator until setup completes.
  app.use('/api/announcements', (req, res, next) => {
    if (!releasePublished) releasePublished = publishReleaseAnnouncement(db);
    next();
  });

  const fields = `a.id,a.title,a.pinned,a.created_by_name,a.created_at,a.updated_at,a.version,a.content_version,
    CASE WHEN r.content_version=a.content_version THEN 0 ELSE 1 END AS unread`;
  const join = 'FROM announcements a LEFT JOIN announcement_reads r ON r.announcement_id=a.id AND r.user_id=?';
  const find = (id, userId) => db.prepare(`SELECT ${fields},a.content ${join} WHERE a.id=?`).get(userId, id);
  const adminOnly = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: '仅管理员可以维护公告。' });
  const validBody = body => body && typeof body.title === 'string' && body.title.trim().length > 0 && body.title.trim().length <= 100 &&
    typeof body.content === 'string' && body.content.trim().length > 0 && body.content.trim().length <= 10000 && typeof body.pinned === 'boolean';
  const validVersion = version => Number.isSafeInteger(version) && version > 0;
  const unreadCount = userId => db.prepare(`SELECT COUNT(*) AS count ${join} WHERE r.content_version IS NULL OR r.content_version<>a.content_version`).get(userId).count;

  app.get('/api/announcements/unread-count', (req, res) => res.json({ count: unreadCount(req.user.id) }));
  app.get('/api/announcements', (req, res) => {
    const { offset = '0', limit = '20', unread = 'false' } = req.query;
    if (typeof offset !== 'string' || !/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset)) ||
        typeof limit !== 'string' || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100 ||
        !['true', 'false'].includes(unread)) return res.status(400).json({ error: '公告筛选或分页参数无效。' });
    const where = unread === 'true' ? 'WHERE r.content_version IS NULL OR r.content_version<>a.content_version' : '';
    const total = db.prepare(`SELECT COUNT(*) AS count ${join} ${where}`).get(req.user.id).count;
    const announcements = db.prepare(`SELECT ${fields},substr(a.content,1,140) AS excerpt ${join} ${where}
      ORDER BY a.pinned DESC,a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`).all(req.user.id, Number(limit), Number(offset));
    res.json({ announcements, total, unread_count: unreadCount(req.user.id), has_more: Number(offset) + announcements.length < total });
  });
  app.param('announcementId', (req, res, next, value) => {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) return res.status(400).json({ error: '公告编号无效。' });
    req.announcement = find(Number(value), req.user.id);
    if (!req.announcement) return res.status(404).json({ error: '公告不存在或已被删除。' });
    next();
  });
  app.get('/api/announcements/:announcementId', (req, res) => res.json(req.announcement));
  app.post('/api/announcements/:announcementId/read', (req, res) => {
    const version = req.body?.content_version;
    if (!validVersion(version)) return res.status(400).json({ error: '请提供公告正文版本。' });
    if (version !== req.announcement.content_version) return res.status(409).json({ error: '公告已更新，请重新打开后阅读。' });
    db.prepare(`INSERT INTO announcement_reads(announcement_id,user_id,content_version,read_at) VALUES (?,?,?,?)
      ON CONFLICT(announcement_id,user_id) DO UPDATE SET content_version=excluded.content_version,read_at=excluded.read_at`)
      .run(req.announcement.id, req.user.id, version, new Date().toISOString());
    res.json({ ok: true });
  });
  app.post('/api/announcements', adminOnly, (req, res) => {
    if (!validBody(req.body)) return res.status(400).json({ error: '请填写 1–100 字标题和 1–10,000 字正文，并提供有效的置顶设置。' });
    const { title, content, pinned } = req.body;
    const now = new Date().toISOString();
    const result = db.prepare(`INSERT INTO announcements(title,content,pinned,created_by,created_by_name,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`).run(title.trim(), content.trim(), Number(pinned), req.user.id, req.user.name || req.user.username, now, now);
    res.status(201).json(find(Number(result.lastInsertRowid), req.user.id));
  });
  app.put('/api/announcements/:announcementId', adminOnly, (req, res) => {
    if (!validBody(req.body) || !validVersion(req.body.version)) return res.status(400).json({ error: '公告内容或版本无效，请检查后重试。' });
    const current = req.announcement;
    if (req.body.version !== current.version) return res.status(409).json({ error: '公告已被其他管理员修改，请关闭后重新打开。' });
    const title = req.body.title.trim(), content = req.body.content.trim();
    const changed = title !== current.title || content !== current.content;
    db.prepare(`UPDATE announcements SET title=?,content=?,pinned=?,updated_at=?,version=version+1,content_version=content_version+? WHERE id=?`)
      .run(title, content, Number(req.body.pinned), new Date().toISOString(), Number(changed), current.id);
    res.json(find(current.id, req.user.id));
  });
  app.delete('/api/announcements/:announcementId', adminOnly, (req, res) => {
    if (!validVersion(req.body?.version)) return res.status(400).json({ error: '请提供公告版本。' });
    if (req.body.version !== req.announcement.version) return res.status(409).json({ error: '公告已更新，请重新打开后删除。' });
    db.prepare('DELETE FROM announcements WHERE id=?').run(req.announcement.id);
    res.json({ ok: true });
  });
}
