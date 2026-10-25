export const locales = ['zh-CN', 'en', 'vi'];

export function normalizeLocale(value) {
  if (typeof value !== 'string') return null;
  const base = value.toLowerCase().split(/[-_]/)[0];
  return base === 'zh' ? 'zh-CN' : base === 'en' || base === 'vi' ? base : null;
}

export function resolveLocale({ saved, browser = [] } = {}) {
  return normalizeLocale(saved) || browser.map(normalizeLocale).find(Boolean) || 'zh-CN';
}

export const formatLocale = locale => ({ en: 'en-US', vi: 'vi-VN' }[locale] || 'zh-CN');

export function createResources(entries) {
  const resources = Object.fromEntries(locales.map(locale => [locale, { translation: {} }]));
  const parameters = text => [...text.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map(match => match[1]).sort().join('|');
  for (const [key, values] of Object.entries(entries)) {
    if (!Array.isArray(values) || values.length !== 3 || values.some(value => typeof value !== 'string' || !value.trim())) throw new Error(`Missing translation: ${key}`);
    if (values.some(value => parameters(value) !== parameters(values[0]))) throw new Error(`Translation parameter mismatch: ${key}`);
    locales.forEach((locale, index) => { resources[locale].translation[key] = values[index]; });
  }
  return resources;
}
