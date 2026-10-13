import { randomUUID } from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';

export const imageLimit = 1024 * 1024;
const types = new Map([['image/jpeg', 'jpeg'], ['image/png', 'png'], ['image/webp', 'webp']]);

export function validateImageUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('商品图片 URL 无效。');
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { throw new Error('商品图片需为 HTTPS URL。'); }
  if (!value.startsWith('https://') || url.protocol !== 'https:' || url.username || url.password || url.hash || /[\x00-\x20\x7f]/.test(value))
    throw new Error('商品图片需为不含账号、密码或片段的 HTTPS URL。');
  return value;
}

export function migrateImagebed(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS imagebed_settings (
    id INTEGER PRIMARY KEY CHECK(id=1), base_url TEXT NOT NULL DEFAULT '',
    auth_type TEXT NOT NULL DEFAULT 'token', secret TEXT NOT NULL DEFAULT '',
    upload_folder TEXT NOT NULL DEFAULT '77erp/products', channel_name TEXT NOT NULL DEFAULT ''
  ); INSERT OR IGNORE INTO imagebed_settings(id) VALUES (1);`);
}

export function imagebedConfig(db) {
  return db.prepare('SELECT * FROM imagebed_settings WHERE id=1').get();
}

function publicConfig(db) {
  const { secret, id, ...config } = imagebedConfig(db);
  return { ...config, has_secret: !!secret, upload_channel: 'cfr2' };
}

export function validateProductImage(db, image, existing = '') {
  if (!image || image === existing) return;
  const config = imagebedConfig(db);
  if (!config.base_url) throw new Error('请先在设置中配置图床，再上传商品图片。');
  const url = new URL(image);
  if (url.origin !== config.base_url || !url.pathname.startsWith('/file/') || url.pathname === '/file/' || url.search)
    throw new Error('请使用当前图床上传返回的商品图片 URL。');
}

function saveConfig(db, body) {
  const current = imagebedConfig(db);
  const { base_url, auth_type, upload_folder, channel_name = '', secret = '', clear_secret = false } = body || {};
  if (typeof base_url !== 'string' || base_url.length > 2048) throw new Error('请填写有效的 HTTPS 图床地址。');
  let base = '';
  if (base_url.trim()) {
    let url;
    try { url = new URL(base_url.trim()); } catch { throw new Error('请填写有效的 HTTPS 图床地址。'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
      throw new Error('图床地址需为 HTTPS 域名，例如 https://img.example.com，不包含上传路径。');
    base = url.origin;
  }
  if (!['token', 'authCode', 'none'].includes(auth_type)) throw new Error('图床认证方式无效。');
  if (typeof secret !== 'string' || secret.length > 4096 || /[\r\n\x00-\x1f\x7f]/.test(secret) || typeof clear_secret !== 'boolean')
    throw new Error('图床凭据格式无效。');
  if (typeof upload_folder !== 'string' || upload_folder.length > 200 || typeof channel_name !== 'string' || channel_name.length > 100)
    throw new Error('上传目录或渠道名称过长。');
  const folder = upload_folder.trim().replace(/^\/+|\/+$/g, '');
  if (folder && (/[\\?#\x00-\x1f\x7f]/.test(folder) || folder.split('/').some(part => !part || part === '.' || part === '..')))
    throw new Error('上传目录不能包含空目录、路径穿越或特殊字符。');
  if (/[\x00-\x1f\x7f]/.test(channel_name)) throw new Error('渠道名称格式无效。');
  const credential = auth_type === 'none' || clear_secret ? '' : secret.trim() || (auth_type === current.auth_type ? current.secret : '');
  if (base && auth_type !== 'none' && !credential) throw new Error('请填写图床上传凭据。');
  db.prepare('UPDATE imagebed_settings SET base_url=?,auth_type=?,secret=?,upload_folder=?,channel_name=? WHERE id=1')
    .run(base, auth_type, credential, folder, channel_name.trim());
  return publicConfig(db);
}

async function normalizeImage(file) {
  if (!file || !types.has(file.mimetype)) throw new Error('invalid image type');
  const input = sharp(file.buffer, { limitInputPixels: 40_000_000, animated: false });
  const metadata = await input.metadata();
  if (metadata.format !== types.get(file.mimetype) || (metadata.pages || 1) > 1) throw new Error('invalid image content');
  // Decode and re-encode to reject malformed files and strip metadata before forwarding.
  const buffer = await input.rotate().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#fff' }).jpeg({ quality: 82 }).toBuffer();
  if (buffer.length > imageLimit) throw new Error('oversized image');
  return buffer;
}

async function responseJson(response) {
  if (!response.body) throw new Error('empty response');
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) throw new Error('oversized response');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}

export function installImagebed(app, db, { imagebedFetch = fetch } = {}) {
  app.get('/api/settings/imagebed', (_, res) => res.json(publicConfig(db)));
  app.put('/api/settings/imagebed', (req, res) => {
    try { res.json(saveConfig(db, req.body)); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });

  const parse = multer({ storage: multer.memoryStorage(), limits: { fileSize: imageLimit, files: 1, fields: 0, parts: 1 } }).single('file');
  const attempts = new Map();
  let activeUploads = 0;
  app.post('/api/uploads/product-image', (req, res) => {
    const config = imagebedConfig(db);
    if (!config.base_url) return res.status(400).json({ error: '请先由管理员在设置中配置图床。' });
    const now = Date.now();
    for (const [id, entry] of attempts) if (entry.until <= now) attempts.delete(id);
    const entry = attempts.get(req.user.id) || { count: 0, until: now + 60_000 };
    if (entry.count >= 30 || activeUploads >= 8) return res.status(429).json({ error: '图片上传过于频繁，请稍后重试。' });
    entry.count++; attempts.set(req.user.id, entry); activeUploads++;
    parse(req, res, async error => {
      try {
        if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? '上传图片不能超过 1 MB，请先压缩。' : '请仅上传一个图片文件。' });
        let buffer;
        try { buffer = await normalizeImage(req.file); }
        catch { return res.status(400).json({ error: '图片无效，请选择有效的 JPEG、PNG 或 WebP 图片（压缩后不超过 1 MB）。' }); }
        const endpoint = new URL('/upload', config.base_url);
        endpoint.searchParams.set('uploadChannel', 'cfr2');
        endpoint.searchParams.set('returnFormat', 'default');
        endpoint.searchParams.set('autoRetry', 'false');
        endpoint.searchParams.set('uploadNameType', 'default');
        endpoint.searchParams.set('uploadFolder', config.upload_folder);
        if (config.channel_name) endpoint.searchParams.set('channelName', config.channel_name);
        const headers = {};
        if (config.auth_type === 'token') headers.Authorization = `Bearer ${config.secret}`;
        if (config.auth_type === 'authCode') headers.authCode = config.secret;
        const form = new FormData();
        form.append('file', new Blob([buffer], { type: 'image/jpeg' }), `${randomUUID()}.jpg`);
        const response = await imagebedFetch(endpoint, { method: 'POST', headers, body: form, redirect: 'error', signal: AbortSignal.timeout(30_000) });
        if (!response.ok) {
          await response.body?.cancel();
          return res.status(502).json({ error: [401,403].includes(response.status) ? '图床认证失败，请检查上传凭据及上传权限。' : '图床上传失败，请检查 cfr2 渠道配置后重试。' });
        }
        const result = await responseJson(response);
        const src = Array.isArray(result) && result.length === 1 && result[0]?.src;
        if (typeof src !== 'string' || !src) throw new Error('invalid upload response');
        const url = new URL(src, config.base_url);
        validateImageUrl(url.href);
        if (url.origin !== config.base_url || !url.pathname.startsWith('/file/') || url.pathname === '/file/' || url.search)
          throw new Error('invalid upload URL');
        res.json({ url: url.href });
      } catch (error) {
        res.status(502).json({ error: ['TimeoutError', 'AbortError'].includes(error.name) ? '图床上传超时，请重试。' : '图床连接或响应异常，请检查图床地址后重试。' });
      } finally { activeUploads--; }
    });
  });
}
