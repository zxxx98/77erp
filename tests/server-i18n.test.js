import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestLanguage, serverMessages, serverTranslator, serverErrorInfo, localizeServerText } from '../server/i18n.js';
import { translateValidationError, validationErrorInfo, validationMessages } from '../shared/error-translations.js';

test('request language is isolated, explicitly selectable and respects weighted supported browser languages', () => {
  const request = (header, user = 'vi', query = {}) => ({ query, user: { language: user }, get: () => header });
  assert.equal(requestLanguage(request('en-US;q=0.4,vi-VN;q=0.9')), 'vi');
  assert.equal(requestLanguage(request('fr;q=1,en;q=0.8')), 'en');
  assert.equal(requestLanguage(request('en;q=0,fr;q=1')), 'vi');
  assert.equal(requestLanguage(request('en', 'vi', { language: 'zh-CN' })), 'zh-CN');
  assert.equal(requestLanguage(request('', null)), 'zh-CN');
  assert.equal(requestLanguage(request('', 'en')), 'en');
  assert.equal(requestLanguage(request('', 'vi')), 'vi');
  assert.equal(requestLanguage(request('', 'en')), 'en');
});

test('all server translations have three nonempty variants and matching interpolation parameters', () => {
  const params = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [key, entry] of Object.entries(serverMessages)) {
    assert.equal(entry.length, 3, key);
    for (const value of entry) {
      assert.ok(typeof value === 'string' && value.trim(), key);
      assert.deepEqual(params(value), params(entry[0]), key);
    }
  }
  assert.equal(serverTranslator('en')('pdf.number', { value: '用户原值' }), 'Order: 用户原值');
  assert.equal(serverTranslator('vi')('pdf.number', { value: '用户原值' }), 'Số lệnh: 用户原值');
});

test('business validation errors expose stable codes and exact original business parameters', () => {
  const legacy = '原始材料 ABC 库存不足（当前 12.25 件）。';
  assert.deepEqual(serverErrorInfo(legacy), { code: 'STOCK_INSUFFICIENT', params: { name: '原始材料 ABC', stock: '12.25', unit: '件' } });
  assert.equal(localizeServerText(legacy, 'en'), 'Insufficient stock for 原始材料 ABC (current: 12.25 件).');
  assert.equal(localizeServerText('用户的任意备注', 'en'), '用户的任意备注');
  const namedLikeAnError = '物料不存在。库存不足（当前 1 件）。请补料或核对实际耗料。';
  assert.ok(translateValidationError(namedLikeAnError, 'en').includes('物料不存在。'));
  const nested = '无法回退库存和原成本：物料不存在。 请先核对后续业务。';
  assert.equal(translateValidationError(nested, 'en'), 'Unable to return inventory and original cost: The material does not exist. Please check subsequent business first.');
});

test('browser-safe shared validation catalog covers BOM, production, quality, nested contexts and template punctuation', () => {
  const cases = [
    ['BOM循环引用：原配方 → 子配方', 'en', 'BOM circular reference: 原配方 → 子配方'],
    ['材料A已领未耗余额不足（当前 2 件）。请补料或核对实际投入。', 'en', 'The issued, unconsumed balance for 材料A is insufficient (current: 2 件). Request additional materials or check the actual input.'],
    ['工作表“保留名称”的自动匹配结果已变化，请重新解析或手动选择物料。', 'vi', 'Kết quả khớp tự động của trang tính “保留名称” đã thay đổi. Phân tích lại hoặc chọn vật tư thủ công.'],
    ['原始物料：横轴字段不存在或数据类型不适用。', 'en', '原始物料: The horizontal axis field is missing or has an unsupported data type.'],
  ];
  for (const [source, language, expected] of cases) {
    assert.ok(validationErrorInfo(source));
    assert.equal(translateValidationError(source, language), expected);
    assert.equal(localizeServerText(source, language), expected);
  }
  assert.ok(Object.keys(validationMessages).length >= 900);
  for (const values of Object.values(validationMessages)) assert.ok(!/[\u3400-\u9fff]/.test(values[1] + values[2]));
});

test('production PDF localizes system labels while preserving business text and language isolation', async () => {
  const { default: PDFDocument } = await import('pdfkit');
  const { renderProductionPdf } = await import('../server/production-pdf.js');
  const original = PDFDocument.prototype.text;
  const texts = [];
  PDFDocument.prototype.text = function(value, ...args) { texts.push(String(value)); return original.call(this, value, ...args); };
  const order = { number: 'SC-LANG', product_name: '保留产品', production_group_name: '保留组', unit: '件', planned_quantity: 10, note: '保留备注', items: [{ name: '保留材料', unit: '件', planned_quantity: 20 }] };
  try {
    for (const [language, title] of [['en', 'Production task sheet'], ['vi', 'Phiếu nhiệm vụ sản xuất'], ['zh-CN', '生产任务单']]) {
      texts.length = 0;
      const bytes = await renderProductionPdf({ order, warehouseName: '保留仓库', registrationUrl: 'https://erp.example/', language });
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      assert.ok(texts.includes(title), language);
      assert.ok(texts.includes('保留材料'));
      assert.ok(texts.includes('保留备注'));
      assert.ok(texts.some(text => text.includes('保留仓库')));
      assert.ok(texts.some(text => text.includes('保留产品')));
    }
  } finally { PDFDocument.prototype.text = original; }
});
