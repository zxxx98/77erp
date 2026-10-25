import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLocale, resolveLocale, createResources, formatLocale } from '../src/i18n/core.js';
import { readdir } from 'node:fs/promises';
import { i18n, t, getLocale, getFormatLocale, translateText } from '../src/i18n/index.js';
import { moneyBase } from '../src/app/format.js';
import { permissionOptions } from '../src/i18n/display.js';
import { productionTypes } from '../shared/product-production-type.js';

test('language selection normalizes supported browser languages and falls back to Chinese', () => {
  assert.equal(normalizeLocale('en-GB'), 'en');
  assert.equal(normalizeLocale('vi-VN'), 'vi');
  assert.equal(normalizeLocale('zh-TW'), 'zh-CN');
  assert.equal(normalizeLocale('fr-FR'), null);
  assert.equal(resolveLocale({ saved: 'vi', browser: ['en-US'] }), 'vi');
  assert.equal(resolveLocale({ saved: 'bad', browser: ['fr-FR', 'en-US'] }), 'en');
  assert.equal(resolveLocale({ browser: ['fr-FR'] }), 'zh-CN');
  assert.equal(formatLocale('vi'), 'vi-VN');
});

test('catalogs require three complete translations with the same interpolation parameters', () => {
  const resources = createResources({ 'test.saved': ['已保存 {{count}} 项', 'Saved {{count}} items', 'Đã lưu {{count}} mục'] });
  assert.equal(resources.en.translation['test.saved'], 'Saved {{count}} items');
  assert.throws(() => createResources({ missing: ['保存', 'Save'] }), /missing/i);
  assert.throws(() => createResources({ wrong: ['{{count}} 项', 'Items', '{{count}} mục'] }), /parameter/i);
});

test('all bundled catalogs have unique keys and complete interpolated translations', async () => {
  const keys = new Set();
  for (const file of await readdir(new URL('../src/i18n/catalogs/', import.meta.url))) {
    const catalog = (await import(new URL('../src/i18n/catalogs/' + file, import.meta.url))).default;
    createResources(catalog);
    for (const key of Object.keys(catalog)) {
      assert.ok(!keys.has(key), `Duplicate translation key: ${key}`);
      keys.add(key);
    }
  }
});

test('switching languages updates dynamic metadata and number formats without translating stored business values', async () => {
  try {
    await i18n.changeLanguage('en');
    assert.equal(getLocale(), 'en');
    assert.equal(t('common.save'), 'Save');
    assert.equal(permissionOptions.find(option => option.key === 'purchase').label, 'Stock in');
    assert.equal(moneyBase(1234.5), '1,234.50');
    await i18n.changeLanguage('vi');
    assert.equal(getFormatLocale(), 'vi-VN');
    assert.equal(t('common.save'), 'Lưu');
    assert.equal(moneyBase(1234.5), '1.234,50');
    assert.equal(translateText('成品'), 'Thành phẩm');
    assert.deepEqual(productionTypes, ['成品', '半成品', '原料']);
    assert.equal(translateText('客户自定义内容XYZ'), '客户自定义内容XYZ');
  } finally { await i18n.changeLanguage('zh-CN'); }
});
