import test from 'node:test';
import assert from 'node:assert/strict';
import warehouse from '../src/i18n/catalogs/warehouse.js';
import { setLocale, getLocale, t } from '../src/i18n/index.js';
import { orderLabel, businessType, reportOrders } from '../src/order-utils.js';
import { createImportTemplate, getImportHeaders, importTemplate, importHeaders, parseCSV, rowsToProducts } from '../src/data-files.js';
import { getProductExportHeaders, warehouseSheet, exportFileName } from '../src/product-export.js';
import { multiStocktakeCSV } from '../src/multi-stocktake-csv.js';
import { parseProductCode, resolveProductCode } from '../src/product-scan.js';
import { inspectionCycleLabel, describeStockExpression } from '../src/warehouse-format.js';

const withLocale = async (language, fn) => { const original = getLocale(); try { setLocale(language); await fn(); } finally { setLocale(original); } };

test('warehouse catalog has complete translations and preserves every interpolation argument', () => {
  assert.ok(Object.keys(warehouse).length > 1000);
  const parameters = value => [...value.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map(match => match[1]).sort();
  for (const [key, values] of Object.entries(warehouse)) {
    assert.match(key, /^warehouse\.[a-zA-Z0-9.]+$/);
    assert.equal(values.length, 3, key);
    for (const value of values) assert.ok(value.trim(), key);
    assert.deepEqual(parameters(values[1]), parameters(values[0]), key);
    assert.deepEqual(parameters(values[2]), parameters(values[0]), key);
  }
});

test('order labels follow repeated locale changes while reporting keeps business directions and values', async () => {
  const purchaseReturn = Object.freeze({ kind: 'return', type: 'out', total: 150, status: 'active' });
  const internal = Object.freeze({ kind: 'internal', type: 'in', total: 150, status: 'void' });
  await withLocale('en', () => { assert.equal(orderLabel(purchaseReturn), 'Purchase return'); assert.equal(orderLabel(internal), 'Internal stock-in · Voided'); });
  await withLocale('vi', () => { assert.equal(orderLabel(purchaseReturn), 'Trả hàng mua'); assert.equal(orderLabel(internal), 'Nhập kho nội bộ · Đã hủy'); });
  await withLocale('zh-CN', () => assert.equal(orderLabel(purchaseReturn), '采购退货'));
  assert.equal(businessType(purchaseReturn), 'in');
  assert.deepEqual(reportOrders([purchaseReturn, internal]), [{ ...purchaseReturn, type: 'in', total: -150 }]);
  assert.equal(purchaseReturn.total, 150);
});

test('all localized import templates round-trip without translating sample business values; legacy Chinese remains accepted', async () => {
  for (const language of ['zh-CN', 'en', 'vi']) {
    await withLocale(language, () => {
      const template = createImportTemplate(language);
      assert.ok(template.startsWith('\ufeff'));
      const rows = parseCSV(template);
      assert.deepEqual(rows[0], getImportHeaders(language));
      const [product] = rowsToProducts(rows);
      assert.deepEqual([product.name, product.barcode, product.category, product.unit, product.production_type], ['示例电线', 'TEST-001', '电线', '米', '原料']);
      assert.equal(product.stock, 20);
      assert.equal(rowsToProducts(parseCSV(importTemplate))[0].name, '示例电线');
      assert.equal(rowsToProducts([importHeaders.slice(0, 8), ['自定义名称', '001', '自定义分类', '个', 1, 2, 0, 1]])[0].barcode, '001');
    });
  }
});

test('localized CSV flags and type aliases normalize to existing Chinese stored values and reject reordered columns', async () => {
  await withLocale('vi', () => {
    const product = rowsToProducts([getImportHeaders('vi'), ['Tên riêng', '0001', '分类', 'kg', '1', '2', '0', '1.2', 'có', 'Nguyên liệu']])[0];
    assert.equal(product.name, 'Tên riêng');
    assert.equal(product.production_type, '原料');
    assert.equal(product.unit_round_up, 1);
    assert.equal(product.stock, 2);
    const header = getImportHeaders('en'); [header[0], header[1]] = [header[1], header[0]];
    assert.throws(() => rowsToProducts([header, ['Name', '001']]), /Tiêu đề cột/);
  });
});

test('explicit export languages localize generated headings and flags while preserving all business content', async () => {
  const product = Object.freeze({ name: '客户输入 Material', barcode: '000123', category: '分类', unit: '个', cost: 1.2, price: 3, threshold: 1, stock: 5, specification: 'M3', note: '用户备注', is_fixed_asset: 1, active: 1, unit_round_up: 1, production_type: '原料' });
  await withLocale('zh-CN', () => {
    for (const language of ['en', 'vi']) {
      const sheet = warehouseSheet({ name: '用户仓库' }, [product], language);
      assert.deepEqual(sheet.data[0], getProductExportHeaders(language));
      assert.deepEqual(sheet.data[1].slice(0, 10), ['客户输入 Material', '000123', '分类', '个', 1.2, 3, 1, 5, 'M3', '用户备注']);
      assert.equal(sheet.data[1][13], '原料');
      assert.equal(sheet.sheet, '用户仓库');
      assert.notEqual(sheet.data[1][10], '是');
      assert.ok(exportFileName(new Date(2026, 9, 25), language).endsWith('20261025.xlsx'));
    }
  });
});

test('stocktake CSV localizes only system text and retains spreadsheet formula escaping', () => {
  const snapshot = { warehouses: [{ name: '=用户仓库' }, { name: '仓库B' }], rows: [{ name: '=自定义物料', barcode: '0001', unit: '个', cells: [{ status: 'missing' }, { status: 'unit_mismatch', quantity: 4, unit: 'kg', difference: null }] }] };
  const csv = multiStocktakeCSV(snapshot, 'en');
  assert.match(csv, /Material name/);
  assert.match(csv, /'=用户仓库 quantity/);
  assert.match(csv, /'=自定义物料/);
  assert.match(csv, /Not registered/);
  assert.match(csv, /4 kg \(different unit\)/);
});

test('inspection and warehouse-expression labels update without changing configured dates or user warehouse names', async () => {
  const product = Object.freeze({ inspection_interval: 3, inspection_unit: 'month', inspection_date: '2026-12-01' });
  await withLocale('en', () => { assert.equal(inspectionCycleLabel(product), 'Every 3 months'); assert.equal(describeStockExpression({ left: 1, terms: [{ warehouse_id: 2, op: '-' }] }, { 1: '仓库名称' }), '仓库名称 − Warehouse 2'); });
  await withLocale('vi', () => assert.equal(inspectionCycleLabel(product), 'Mỗi 3 tháng'));
  assert.equal(product.inspection_date, '2026-12-01');
});

test('scanner messages localize while QR identifiers and material lookup are language independent', async () => {
  const product = { id: 1, barcode: '0001', name: '用户物料' };
  const raw = JSON.stringify({ format: '77erp', version: 1, type: 'product', source_id: 'source', warehouse_id: 2, product });
  await withLocale('en', () => { assert.equal(parseProductCode(raw).warehouseId, 2); assert.equal(resolveProductCode(raw, { products: [product], warehouseId: 2, sourceId: 'source' }), product); assert.throws(() => resolveProductCode(raw, { products: [product], warehouseId: 3, sourceId: 'source' }), /another warehouse/); });
  await withLocale('vi', () => assert.throws(() => resolveProductCode(raw, { products: [product], warehouseId: 3, sourceId: 'source' }), /kho khác/));
});
