import { t as translate, getFormatLocale } from '../i18n/index.js';
const DATABASE = '77erp-local-drafts';
const RETENTION = 7 * 24 * 60 * 60 * 1000;
let connection;

function database() {
  if (!globalThis.indexedDB) return Promise.reject(new Error(translate("extra.the.current.browser.cannot.save.local.drafts")));
  if (!connection) {
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('drafts', { keyPath: 'key' });
        store.createIndex('owner', ['userId', 'instanceId', 'warehouseId']);
        store.createIndex('user', 'userId');
      };
      request.onerror = () => { connection = undefined; reject(new Error(translate("extra.unable.to.open.local.draft.please.check.your.browser.storage.settings"))); };
      request.onblocked = () => { connection = undefined; reject(new Error(translate("extra.the.local.draft.is.being.updated.please.close.other.old.pages"))); };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = undefined; };
        resolve(db);
      };
    });
  }
  return connection;
}

export function draftScope(userId, instanceId, warehouseId) {
  if (!Number.isSafeInteger(userId) || userId < 1 || !instanceId || !Number.isSafeInteger(warehouseId) || warehouseId < 1)
    throw new Error(translate("extra.unable.to.check.draft.ownership.please.log.in.again.online"));
  return { userId, instanceId, warehouseId };
}

export const localId = () => globalThis.crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-');
const keyOf = (scope, id) => `${scope.userId}:${scope.instanceId}:${scope.warehouseId}:${id}`;

async function transaction(action, mode = 'readonly') {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', mode);
    const result = action(tx.objectStore('drafts'));
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = tx.onabort = () => reject(new Error(translate("extra.failed.to.save.local.draft.please.check.the.available.storage.space")));
  });
}

export async function saveDraft(scope, draft) {
  if (!draft.id || !['in', 'out'].includes(draft.type)) throw new Error(translate("extra.the.draft.is.formatted.incorrectly"));
  const record = { ...draft, ...scope, key: keyOf(scope, draft.id), updatedAt: Date.now() };
  await transaction(store => store.put(record), 'readwrite');
  return record;
}

export async function listDrafts(scope) {
  const records = await transaction(store => store.index('owner').getAll([scope.userId, scope.instanceId, scope.warehouseId]));
  const expired = records.filter(draft => !draft.pending && Date.now() - draft.updatedAt > RETENTION);
  await Promise.all(expired.map(draft => removeDraft(scope, draft.id)));
  return records.filter(draft => draft.pending || Date.now() - draft.updatedAt <= RETENTION).sort((a, b) => b.updatedAt - a.updatedAt);
}

export const removeDraft = (scope, id) => transaction(store => store.delete(keyOf(scope, id)), 'readwrite');

export async function clearUserDrafts(userId) {
  if (!userId) return;
  await transaction(store => {
    const request = store.index('user').openCursor(IDBKeyRange.only(userId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
  }, 'readwrite');
}
