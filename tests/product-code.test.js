import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BinaryBitmap, DecodeHintType, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from '@zxing/library';
import { productQrPayload, qrSymbol } from '../src/product-code.js';
import { createApp } from '../server/app.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sourceId = '708528e6-7d1e-4d1b-8ba3-f4f769931c49';

function decodeSymbol(symbol) {
  const scale = 4, width = symbol.size * scale;
  const pixels = new Uint8ClampedArray(width * width).fill(255);
  // Rasterize the exported path rather than reading the encoder's matrix.
  for (const match of symbol.path.matchAll(/M(\d+) (\d+)h(\d+)v1H\d+z/g)) {
    const [, x, y, length] = match.map(Number);
    for (let row = y * scale; row < (y + 1) * scale; row++)
      pixels.fill(0, row * width + x * scale, row * width + (x + length) * scale);
  }
  const hints = new Map([[DecodeHintType.PURE_BARCODE, true]]);
  return new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, width, width))), hints).getText();
}

test('QR label from the failed 1.4.2 release decodes without camera-style detection', () => {
  const payload = productQrPayload(
    { id: 15, barcode: '6901234567001', name: '二维码分仓商品', unit: '套' },
    2, '833b407e-76e9-4d7f-855e-d6c699ec7e8f',
  );
  assert.equal(decodeSymbol(qrSymbol(payload)), payload);
});

test('QR label paths decode to versioned UTF-8 product identity, including maximum-length metadata', () => {
  for (const product of [
    { id: 1, barcode: 'SKU-000001', name: '中文商品「茶杯」☕', unit: '个', stock: 99, price: 12 },
    { id: 2, barcode: 'X'.repeat(64), name: '商'.repeat(100), unit: '件'.repeat(100) },
  ]) {
    const payload = productQrPayload(product, 2, sourceId);
    assert.equal(decodeSymbol(qrSymbol(payload)), payload);
    assert.deepEqual(JSON.parse(payload), {
      format: '77erp', version: 1, type: 'product', source_id: sourceId, warehouse_id: 2,
      product: { id: product.id, barcode: product.barcode, name: product.name, unit: product.unit },
    });
  }
});

test('same barcodes from different warehouses remain distinguishable and missing identity is rejected', () => {
  const product = { id: 1, barcode: 'SAME-CODE', name: '商品', unit: '套' };
  assert.notEqual(productQrPayload(product, 1, sourceId), productQrPayload({ ...product, id: 2 }, 2, sourceId));
  assert.notEqual(productQrPayload(product, 1, sourceId), productQrPayload(product, 1, '5ed3098f-d9f4-4992-b6ab-6355966dbb43'));
  for (const warehouse of [undefined, 0, -1, '1', 1.5])
    assert.throws(() => productQrPayload(product, warehouse, sourceId), /商品或仓库信息无效/);
  assert.throws(() => productQrPayload({ ...product, id: 0 }, 1, sourceId), /商品或仓库信息无效/);
  assert.throws(() => productQrPayload(product, 1), /二维码来源信息缺失/);
});

test('QR source identity survives database restarts and differs between independent databases', t => {
  const folder = mkdtempSync(join(tmpdir(), '77erp-qr-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'source.sqlite');
  let { db } = createApp(path);
  const original = db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value;
  db.close();
  ({ db } = createApp(path));
  assert.equal(db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value, original);
  db.close();
  ({ db } = createApp(':memory:'));
  assert.notEqual(db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value, original);
  db.close();
});

test('operation QR encodes a server reference without trusting printed quantity or confirmation fields', async () => {
  const { stockQrPayload } = await import('../src/stock-qr-client.js');
  const qr = { qr_id: 'a08f04e0-6420-4c84-9c07-189e70c95539', warehouse_id: 2, quantity: 99, require_confirmation: false };
  const source = '708528e6-7d1e-4d1b-8ba3-f4f769931c49';
  const payload = stockQrPayload(qr, source);
  assert.equal(decodeSymbol(qrSymbol(payload)), payload);
  assert.deepEqual(JSON.parse(payload), {format:'77erp',version:1,type:'stock_operation',source_id:source,warehouse_id:2,qr_id:qr.qr_id});
});
