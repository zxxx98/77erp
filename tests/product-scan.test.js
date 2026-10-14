import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProductCode, resolveProductCode } from '../src/product-scan.js';
import { productQrPayload } from '../src/product-code.js';

const sourceId = '708528e6-7d1e-4d1b-8ba3-f4f769931c49';
const products = [
  { id: 12, barcode: 'SKU-000012', name: '马克杯', unit: '个' },
  { id: 13, barcode: 'SKU-000013', name: '茶杯', unit: '个' },
];
const context = { products, warehouseId: 1, sourceId };
const label = (overrides = {}) => JSON.stringify({ ...JSON.parse(productQrPayload(products[0], 1, sourceId)), ...overrides });

test('plain barcodes and non-77erp text still resolve by barcode only', () => {
  assert.equal(resolveProductCode(' SKU-000013 ', context), products[1]);
  assert.equal(resolveProductCode('UNKNOWN', context), null);
  for (const raw of ['{not json', '{"format":"other","barcode":"SKU-000012"}', 'https://example.com/SKU-000012', ''])
    assert.equal(resolveProductCode(raw, context), null, raw);
  assert.deepEqual(parseProductCode('{"format":"other"}'), { kind: 'barcode', barcode: '{"format":"other"}' });
});

test('own labels resolve by identity and never by their display snapshot', () => {
  assert.equal(resolveProductCode(label(), context), products[0]);
  assert.equal(resolveProductCode(label({ product: { id: 12, barcode: 'SKU-000012', name: '改过的名字', unit: '箱' } }), context), products[0]);
  assert.deepEqual(parseProductCode(label()), { kind: 'label', sourceId, warehouseId: 1, id: 12, barcode: 'SKU-000012' });
});

test('labels from another server, warehouse, a reused id or an unsupported version are rejected with a reason', () => {
  assert.throws(() => resolveProductCode(label({ source_id: '5ed3098f-d9f4-4992-b6ab-6355966dbb43' }), context), /其他服务器/);
  assert.throws(() => resolveProductCode(label({ warehouse_id: 2 }), context), /其他仓库/);
  assert.throws(() => resolveProductCode(label({ product: { id: 12, barcode: 'SKU-000099' } }), context), /不一致/);
  assert.throws(() => resolveProductCode(label({ product: { id: 99, barcode: 'SKU-000012' } }), context), /不一致/);
  assert.throws(() => resolveProductCode(label(), { ...context, sourceId: undefined }), /无法核对/);
  assert.throws(() => resolveProductCode(label({ version: 2 }), context), /版本/);
  assert.throws(() => resolveProductCode(label({ type: 'stock_receipt' }), context), /不是物料标签/);
  assert.throws(() => resolveProductCode(label({ product: { id: '12', barcode: 'SKU-000012' } }), context), /不完整/);
});
