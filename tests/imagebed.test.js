import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';

const config = { base_url: 'https://img.example.com', auth_type: 'token', secret: 'private-test-token', upload_folder: '77erp/products', channel_name: '主 R2' };
const product = { name: '图片物料', category: '图片测试', unit: '件', cost: 1, price: 2, threshold: 3 };
const png = await sharp({ create: { width: 24, height: 16, channels: 4, background: '#2563eb' } }).png().toBuffer();
async function fixture(t) {
  const calls = [];
  let respond = () => new Response(JSON.stringify([{ src: '/file/77erp/products/image.webp' }]));
  const instance = createApp(':memory:', { imagebedFetch: async (url, options) => { calls.push({ url, options }); return respond(); } });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); instance.db.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  const request = async (path, method = 'GET', body, override = {}) => {
    const multipart = body instanceof FormData;
    const res = await fetch(base + path, { method, headers: { ...(!multipart ? { 'Content-Type': 'application/json' } : {}), Cookie: cookie, ...override }, body: body === undefined ? undefined : multipart ? body : JSON.stringify(body) });
    return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  cookie = (await request('/auth/setup', 'POST', { username: 'admin', password: 'Test-admin-123' })).cookie;
  const upload = (buffer = png, type = 'image/png', override = {}, field = 'file') => {
    const form = new FormData(); form.append(field, new Blob([buffer], { type }), 'image.png');
    return request('/uploads/product-image', 'POST', form, override);
  };
  return { ...instance, calls, request, upload, setResponse: fn => { respond = fn; } };
}

test('configuration is administrator-only, redacted, persists across updates and excluded from data and backups', async t => {
  const f = await fixture(t);
  assert.equal((await f.upload()).status, 400);
  const saved = await f.request('/settings/imagebed', 'PUT', config);
  assert.equal(saved.status, 200); assert.equal(saved.data.has_secret, true); assert.equal(saved.data.secret, undefined);
  assert.equal((await f.request('/settings/imagebed')).data.secret, undefined);
  assert.equal((await f.request('/settings/imagebed', 'PUT', { ...config, secret: '', upload_folder: '77erp/new' })).status, 200);
  assert.equal(f.db.prepare('SELECT secret FROM imagebed_settings').get().secret, config.secret);
  for (const path of ['/data', '/backup']) assert.ok(!JSON.stringify((await f.request(path)).data).includes(config.secret));
  await f.request('/users', 'POST', { username: 'employee', password: 'Test-employee-123', role: 'employee' });
  f.db.prepare("UPDATE users SET permissions='[\"products\"]' WHERE username='employee'").run();
  const employee = (await f.request('/auth/login', 'POST', { username: 'employee', password: 'Test-employee-123' })).cookie;
  assert.equal((await f.request('/settings/imagebed', 'GET', undefined, { Cookie: employee })).status, 403);
  assert.equal((await f.request('/settings/imagebed', 'PUT', config, { Cookie: employee })).status, 403);
  assert.equal((await f.upload(png, 'image/png', { Cookie: employee })).status, 200);
  assert.equal((await f.upload(png, 'image/png', { Cookie: '' })).status, 401);
  assert.equal((await f.upload(png, 'image/png', { Origin: 'https://evil.example' })).status, 403);
});

test('invalid configuration fails atomically, credentials can be replaced and explicitly removed', async t => {
  const f = await fixture(t);
  await f.request('/settings/imagebed', 'PUT', config);
  for (const extra of [{ base_url: 'http://img.example.com' }, { base_url: 'https://user:password@img.example.com' }, { base_url: 'https://img.example.com/upload' }, { base_url: 'https://img.example.com/?token=secret' }, { auth_type: 'invalid' }, { secret: 'bad\nvalue' }, { upload_folder: '../products' }, { upload_folder: 'a//b' }, { upload_folder: 'a\\b' }, { clear_secret: true }]) {
    assert.equal((await f.request('/settings/imagebed', 'PUT', { ...config, ...extra })).status, 400);
    assert.equal((await f.request('/settings/imagebed')).data.base_url, config.base_url);
  }
  assert.equal((await f.request('/settings/imagebed', 'PUT', { ...config, secret: 'replacement' })).status, 200);
  assert.equal(f.db.prepare('SELECT secret FROM imagebed_settings').get().secret, 'replacement');
  assert.equal((await f.request('/settings/imagebed', 'PUT', { ...config, base_url: '', clear_secret: true })).data.has_secret, false);
  assert.equal((await f.upload()).status, 400);
});

test('upload forwards a decoded image to cfr2 and persists only a URL through synchronization and backup restore', async t => {
  const f = await fixture(t);
  await f.request('/settings/imagebed', 'PUT', config);
  const uploaded = await f.upload();
  assert.equal(uploaded.status, 200); assert.equal(uploaded.data.url, 'https://img.example.com/file/77erp/products/image.webp');
  const { url, options } = f.calls[0];
  assert.equal(url.pathname, '/upload'); assert.equal(url.searchParams.get('uploadChannel'), 'cfr2');
  assert.equal(url.searchParams.get('autoRetry'), 'false'); assert.equal(url.searchParams.get('uploadFolder'), config.upload_folder);
  assert.equal(url.searchParams.get('channelName'), config.channel_name); assert.equal(options.headers.Authorization, `Bearer ${config.secret}`);
  assert.equal(options.redirect, 'error'); assert.equal(url.searchParams.has('authCode'), false);
  const file = options.body.get('file');
  assert.equal(file.type, 'image/webp'); assert.match(file.name, /^[\da-f-]+\.webp$/);
  const metadata = await sharp(Buffer.from(await file.arrayBuffer())).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 24); assert.equal(metadata.height, 16);
  const warehouse = (await f.request('/warehouses', 'POST', { name: '图片分仓' })).data.id;
  const created = await f.request('/products', 'POST', { ...product, image: uploaded.data.url, sync_warehouse_ids: [warehouse] });
  assert.equal(created.status, 201);
  const stored = f.db.prepare('SELECT image FROM products WHERE name=?').all(product.name);
  assert.equal(stored.length, 2); assert.ok(stored.every(row => row.image === uploaded.data.url));
  assert.equal((await f.request('/products', 'POST', { ...product, image: 'data:image/png;base64,AAAA' })).status, 400);
  assert.equal((await f.request('/products', 'POST', { ...product, image: 'https://other.example/file/x.jpg' })).status, 400);
  const backup = (await f.request('/backup')).data;
  assert.equal(backup.version, 16); assert.ok(!JSON.stringify(backup).includes('data:image'));
  await f.request('/settings/imagebed', 'PUT', { ...config, base_url: 'https://new.example.com' });
  assert.equal((await f.request(`/products/${created.data.id}`, 'PUT', { ...product, version: created.data.version, image: uploaded.data.url })).status, 200);
  const preview = await f.request('/backup/preview', 'POST', { backup });
  assert.equal(preview.status, 200);
  const restored = await f.request('/backup/restore', 'POST', { backup, ...preview.data, request_id: randomUUID(), confirmation: 'RESTORE_BUSINESS_DATA' });
  assert.equal(restored.status, 200);
  assert.equal((await f.request('/settings/imagebed')).data.base_url, 'https://new.example.com');
});

test('authCode is sent only to the image host and unauthenticated mode clears saved credentials', async t => {
  const f = await fixture(t);
  await f.request('/settings/imagebed', 'PUT', { ...config, auth_type: 'authCode' });
  assert.equal((await f.upload()).status, 200);
  assert.equal(f.calls[0].options.headers.authCode, config.secret);
  assert.equal(f.calls[0].url.searchParams.has('authCode'), false);
  await f.request('/settings/imagebed', 'PUT', { ...config, auth_type: 'none' });
  assert.equal((await f.upload()).status, 200);
  assert.deepEqual(f.calls[1].options.headers, {});
  assert.equal((await f.request('/settings/imagebed')).data.has_secret, false);
});

test('large images are scaled, converted to actual WebP bytes and stripped of metadata before upload', async t => {
  const f = await fixture(t);
  await f.request('/settings/imagebed', 'PUT', config);
  const large = await sharp({ create: { width: 2560, height: 1920, channels: 4, background: '#2563eb' } }).withMetadata().png().toBuffer();
  assert.equal((await f.upload(large)).status, 200);
  const file = f.calls[0].options.body.get('file');
  const bytes = Buffer.from(await file.arrayBuffer());
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 1280); assert.equal(metadata.height, 960);
  assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined);
  assert.ok(bytes.length <= 1024 * 1024);
});

test('invalid and oversized files and wrong multipart fields are rejected before contacting the image host', async t => {
  const f = await fixture(t);
  await f.request('/settings/imagebed', 'PUT', config);
  for (const [buffer, type] of [[Buffer.from('not a picture'), 'image/png'], [png, 'image/jpeg'], [png, 'image/svg+xml']])
    assert.equal((await f.upload(buffer, type)).status, 400);
  assert.equal((await f.upload(Buffer.alloc(1024 * 1024 + 1))).status, 413);
  assert.equal((await f.upload(png, 'image/png', {}, 'other')).status, 400);
  assert.equal((await f.request('/uploads/product-image', 'POST', {})).status, 415);
  assert.equal(f.calls.length, 0);
});

test('upstream failures, redirects, malformed responses and unsafe URLs do not leak credentials or return success', async t => {
  const f = await fixture(t);
  await f.request('/settings/imagebed', 'PUT', config);
  const responses = [() => new Response(config.secret, { status: 403 }), () => new Response('unavailable', { status: 500 }), () => new Response('not json'), () => new Response('x'.repeat(70_000)), () => new Response(JSON.stringify([{ src: 'https://evil.example/file/x.jpg' }])), () => new Response(JSON.stringify([{ src: '/file/x.jpg?authCode=private' }])), () => new Response(JSON.stringify([{ src: '/upload' }])), () => { throw new DOMException('timed out', 'TimeoutError'); }, () => { throw new Error('redirect containing private-test-token'); }];
  for (const respond of responses) {
    f.setResponse(respond);
    const failed = await f.upload();
    assert.equal(failed.status, 502); assert.ok(!JSON.stringify(failed.data).includes(config.secret));
  }
});
