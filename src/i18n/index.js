import i18next from 'i18next';
import { createResources, resolveLocale, normalizeLocale, formatLocale, locales } from './core.js';
import common from './catalogs/common.js';
import system from './catalogs/system.js';
import warehouse from './catalogs/warehouse.js';
import sharedUi from './catalogs/shared-ui.js';
import extra from './catalogs/extra.js';
import production from './catalogs/production.js';

// Bundled language resources are included in the normal PWA asset precache.
const catalogs = { common, system, warehouse, production, sharedUi, extra };
const entries = {};
for (const catalog of Object.values(catalogs)) {
  for (const [key, values] of Object.entries(catalog)) {
    if (entries[key]) throw new Error(`Duplicate translation key: ${key}`);
    entries[key] = values;
  }
}
const deviceKey = '77erp:language:v1';
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const browser = typeof window === 'undefined' ? [] : navigator.languages || [navigator.language];
export const i18n = i18next.createInstance();
i18n.init({
  resources: createResources(entries), lng: resolveLocale({ saved: read(deviceKey), browser }),
  supportedLngs: locales, fallbackLng: 'zh-CN', load: 'currentOnly',
  keySeparator: false, nsSeparator: false, initImmediate: false, initAsync: false,
  interpolation: { escapeValue: false }, returnEmptyString: false,
});
export const t = (key, params) => i18n.t(key, params);
const sourceKeys = new Map(Object.entries(entries).map(([key, values]) => [values[0], key]));
// Only call for system-owned display metadata, never arbitrary record/user text.
export const translateText = (source, params) => sourceKeys.has(source) ? t(sourceKeys.get(source), params) : source;
export const getLocale = () => i18n.resolvedLanguage || 'zh-CN';
export const getFormatLocale = () => formatLocale(getLocale());
export const subscribeLocale = listener => { i18n.on('languageChanged', listener); return () => i18n.off('languageChanged', listener); };
const setDocumentLanguage = () => { if (typeof document !== 'undefined') document.documentElement.lang = getLocale(); };
i18n.on('languageChanged', setDocumentLanguage);
setDocumentLanguage();

let accountId = null;
let accountEpoch = 0;
let syncVersion = 0;
let syncQueue = Promise.resolve();
let errorKey = '';
const listeners = new Set();
const notify = () => listeners.forEach(listener => listener());
const write = (key, value) => {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); return true; }
  catch { errorKey = 'language.storageError'; notify(); return false; }
};
const accountKey = id => `77erp:language:user:${id}`;
const pendingKey = id => `${accountKey(id)}:pending`;
export const subscribeLanguageSync = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export const getLanguageSyncError = () => errorKey;

export function setLocale(value) {
  const locale = normalizeLocale(value) || 'zh-CN';
  errorKey = '';
  i18n.changeLanguage(locale);
  write(deviceKey, locale);
  if (accountId !== null) write(accountKey(accountId), locale);
  notify();
  return locale;
}

function synchronize() {
  const id = accountId, epoch = accountEpoch, version = ++syncVersion;
  if (id === null || navigator.onLine === false) return Promise.resolve();
  syncQueue = syncQueue.catch(() => {}).then(async () => {
    if (id !== accountId || epoch !== accountEpoch || version !== syncVersion) return;
    const language = read(pendingKey(id));
    if (!locales.includes(language)) return;
    try {
      const response = await fetch('/api/auth/language', {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
        body: JSON.stringify({ language, user_id: id }),
      });
      if (!response.ok) throw new Error('Language sync failed');
      if (id === accountId && epoch === accountEpoch) {
        // Versions only order this tab. Shared storage is the authority for
        // explicit choices made in other tabs, including already saved ones.
        const desired = normalizeLocale(read(accountKey(id)));
        const pending = read(pendingKey(id));
        if (desired && desired !== language) {
          // A newer request may already have succeeded before this older write
          // reached the server. Restore its retry marker and repair that write.
          if (!pending && write(pendingKey(id), desired)) synchronize();
        } else if (version === syncVersion && pending === language) {
          write(pendingKey(id), null); errorKey = ''; notify();
        }
      }
    } catch {
      if (id === accountId && epoch === accountEpoch && version === syncVersion) { errorKey = 'language.syncError'; notify(); }
    }
  });
  return syncQueue;
}

export function changeLanguage(value) {
  const language = setLocale(value);
  if (accountId !== null) { write(pendingKey(accountId), language); return synchronize(); }
  return Promise.resolve();
}

export function setLanguageUser(user) {
  const id = user?.authenticated ? user.id : null;
  if (id !== accountId) { accountEpoch++; syncVersion++; errorKey = ''; }
  accountId = id;
  if (id !== null) {
    const pending = read(pendingKey(id));
    const language = normalizeLocale(pending) || normalizeLocale(user.language) || normalizeLocale(read(accountKey(id))) || getLocale();
    setLocale(language);
    if (pending) synchronize();
  }
  notify();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', synchronize);
  window.addEventListener('storage', event => {
    const key = accountId === null ? deviceKey : accountKey(accountId);
    if (event.key === key && normalizeLocale(event.newValue)) i18n.changeLanguage(normalizeLocale(event.newValue));
  });
}
