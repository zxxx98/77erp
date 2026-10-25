import { t } from './i18n/index.js';
import { BarcodeFormat, EncodeHintType, QRCodeWriter } from '@zxing/library';

// Versioned product labels carry identity and display snapshots, never inventory commands.
export function productQrPayload(product, warehouseId, sourceId) {
  if (!Number.isSafeInteger(product.id) || product.id < 1 ||
      !Number.isSafeInteger(warehouseId) || warehouseId < 1)
    throw new Error(t('warehouse.code.invalidIdentity'));
  if (typeof sourceId !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(sourceId))
    throw new Error(t('warehouse.code.missingSource'));
  return JSON.stringify({
    format: '77erp',
    version: 1,
    type: 'product',
    source_id: sourceId,
    warehouse_id: warehouseId,
    product: { id: product.id, barcode: product.barcode, name: product.name, unit: product.unit },
  });
}

export function qrSymbol(payload) {
  const hints = new Map([
    [EncodeHintType.CHARACTER_SET, 'UTF-8'],
    [EncodeHintType.ERROR_CORRECTION, 'M'],
    [EncodeHintType.MARGIN, 4],
  ]);
  const matrix = new QRCodeWriter().encode(payload, BarcodeFormat.QR_CODE, 0, 0, hints);
  const size = matrix.getWidth();
  const segments = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!matrix.get(x, y)) continue;
      const start = x;
      while (x + 1 < size && matrix.get(x + 1, y)) x++;
      segments.push(`M${start} ${y}h${x - start + 1}v1H${start}z`);
    }
  }
  return { size, path: segments.join('') };
}
