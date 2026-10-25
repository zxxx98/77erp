import { t } from './i18n/index.js';
// Scans are either plain barcodes or versioned 77erp product labels (docs/product-qr.md).
// A label only identifies a product; its name and unit snapshots are never trusted.
export function parseProductCode(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text.startsWith("{")) return { kind: "barcode", barcode: text };
  let label;
  try { label = JSON.parse(text); } catch { return { kind: "barcode", barcode: text }; }
  if (!label || typeof label !== "object" || label.format !== "77erp") return { kind: "barcode", barcode: text };
  if (label.version !== 1) throw new Error(t('warehouse.scan.unsupportedVersion'));
  if (label.type === "stock_operation") throw new Error(t('warehouse.scan.stockOperation'));
  if (label.type !== "product") throw new Error(t('warehouse.scan.notMaterial'));
  const product = label.product;
  if (typeof label.source_id !== "string" || !Number.isSafeInteger(label.warehouse_id) || !product ||
      typeof product !== "object" || !Number.isSafeInteger(product.id) || typeof product.barcode !== "string")
    throw new Error(t('warehouse.scan.incomplete'));
  return { kind: "label", sourceId: label.source_id, warehouseId: label.warehouse_id, id: product.id, barcode: product.barcode };
}

// Returns the matching product, null for an unknown plain barcode, and throws when a label does not
// belong to the current server, warehouse and product record.
export function resolveProductCode(raw, { products, warehouseId, sourceId }) {
  const code = parseProductCode(raw);
  if (code.kind === "barcode") return products.find((p) => p.barcode === code.barcode) || null;
  if (!sourceId) throw new Error(t('warehouse.scan.unverifiedSource'));
  if (code.sourceId !== sourceId) throw new Error(t('warehouse.scan.otherServer'));
  if (code.warehouseId !== warehouseId) throw new Error(t('warehouse.scan.otherWarehouse'));
  const product = products.find((p) => p.id === code.id);
  if (!product || product.barcode !== code.barcode)
    throw new Error(t('warehouse.scan.mismatch', { barcode: code.barcode }));
  return product;
}
