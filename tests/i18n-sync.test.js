import { test } from 'node:test';
import assert from 'node:assert/strict';

const pendingKey = '77erp:language:user:17:pending';
let instance = 0;
const tick = () => new Promise(resolve => setImmediate(resolve));
async function setup() {
  const storage = new Map(), requests = [];
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  globalThis.fetch = (_url, options) => new Promise((resolve, reject) => requests.push({ body: JSON.parse(options.body), resolve, reject }));
  const a = await import(`../src/i18n/index.js?sync-test=${instance++}`);
  const b = await import(`../src/i18n/index.js?sync-test=${instance++}`);
  for (const tab of [a, b]) tab.setLanguageUser({ authenticated: true, id: 17, language: 'zh-CN' });
  return { a, b, storage, requests };
}

test('older tab success preserves newer offline choice and reload retries it', async () => {
  const { a, b, storage, requests } = await setup();
  const first = a.changeLanguage('en'); await tick();
  const second = b.changeLanguage('vi'); await tick();
  requests[0].resolve({ ok: true }); await first;
  assert.equal(storage.get(pendingKey), 'vi');
  requests[1].reject(new Error('offline')); await second;
  assert.equal(storage.get(pendingKey), 'vi');
  b.setLanguageUser({ authenticated: true, id: 17, language: 'en' }); await tick();
  assert.deepEqual(requests[2].body, { language: 'vi', user_id: 17 });
  requests[2].resolve({ ok: true }); await tick();
  assert.equal(storage.get(pendingKey), undefined);
});

test('older completion after newest was saved repairs the server preference', async () => {
  const { a, b, storage, requests } = await setup();
  const first = a.changeLanguage('en'); await tick();
  const second = b.changeLanguage('vi'); await tick();
  requests[1].resolve({ ok: true }); await second;
  assert.equal(storage.get(pendingKey), undefined);
  requests[0].resolve({ ok: true }); await first; await tick();
  assert.equal(storage.get(pendingKey), 'vi');
  assert.deepEqual(requests[2].body, { language: 'vi', user_id: 17 });
  requests[2].resolve({ ok: true }); await tick();
  assert.equal(storage.get(pendingKey), undefined);
});

test('failed repair remains durable while offline and retries the latest desire', async () => {
  const { a, b, storage, requests } = await setup();
  const first = a.changeLanguage('en'); await tick();
  const second = b.changeLanguage('vi'); await tick();
  requests[1].resolve({ ok: true }); await second;
  navigator.onLine = false;
  requests[0].resolve({ ok: true }); await first;
  assert.equal(storage.get(pendingKey), 'vi');
  assert.equal(requests.length, 2);
  navigator.onLine = true;
  a.setLanguageUser({ authenticated: true, id: 17, language: 'en' }); await tick();
  requests[2].reject(new Error('offline')); await tick();
  assert.equal(storage.get(pendingKey), 'vi');
  a.setLanguageUser({ authenticated: true, id: 17, language: 'en' }); await tick();
  assert.equal(requests[3].body.language, 'vi');
  requests[3].resolve({ ok: true }); await tick();
  assert.equal(storage.get(pendingKey), undefined);
});

test('quick same-tab switches serialize the latest choice', async () => {
  const { a, storage, requests } = await setup();
  const first = a.changeLanguage('en'); await tick();
  const second = a.changeLanguage('vi');
  requests[0].resolve({ ok: true }); await first; await tick();
  assert.equal(storage.get(pendingKey), 'vi');
  assert.equal(requests[1].body.language, 'vi');
  requests[1].resolve({ ok: true }); await second;
  assert.equal(storage.get(pendingKey), undefined);
});

test('responses from a previous account epoch cannot clear pending choices', async () => {
  const { a, storage, requests } = await setup();
  const first = a.changeLanguage('en'); await tick();
  a.setLanguageUser({ authenticated: false });
  navigator.onLine = false;
  a.setLanguageUser({ authenticated: true, id: 17, language: 'zh-CN' });
  requests[0].resolve({ ok: true }); await first;
  assert.equal(storage.get(pendingKey), 'en');
  assert.deepEqual(requests[0].body, { language: 'en', user_id: 17 });
  assert.equal(requests.length, 1);
});
