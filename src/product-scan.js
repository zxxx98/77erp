// Scans are either plain barcodes or versioned 77erp product labels (docs/product-qr.md).
// A label only identifies a product; its name and unit snapshots are never trusted.
export function parseProductCode(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text.startsWith("{")) return { kind: "barcode", barcode: text };
  let label;
  try { label = JSON.parse(text); } catch { return { kind: "barcode", barcode: text }; }
  if (!label || typeof label !== "object" || label.format !== "77erp") return { kind: "barcode", barcode: text };
  if (label.version !== 1) throw new Error("不支持的二维码版本，请更新应用后重试。");
  if (label.type === "stock_operation") throw new Error("该二维码用于整单出入库，请到扫码工作台的对应模式执行。");
  if (label.type !== "product") throw new Error("该二维码不是物料标签，无法识别物料。");
  const product = label.product;
  if (typeof label.source_id !== "string" || !Number.isSafeInteger(label.warehouse_id) || !product ||
      typeof product !== "object" || !Number.isSafeInteger(product.id) || typeof product.barcode !== "string")
    throw new Error("物料二维码内容不完整，请重新生成标签。");
  return { kind: "label", sourceId: label.source_id, warehouseId: label.warehouse_id, id: product.id, barcode: product.barcode };
}

// Returns the matching product, null for an unknown plain barcode, and throws when a label does not
// belong to the current server, warehouse and product record.
export function resolveProductCode(raw, { products, warehouseId, sourceId }) {
  const code = parseProductCode(raw);
  if (code.kind === "barcode") return products.find((p) => p.barcode === code.barcode) || null;
  if (!sourceId) throw new Error("无法核对二维码来源，请刷新后重试。");
  if (code.sourceId !== sourceId) throw new Error("该二维码来自其他服务器的物料，当前系统无法识别。");
  if (code.warehouseId !== warehouseId) throw new Error("该二维码属于其他仓库的物料，请切换仓库后再扫描。");
  const product = products.find((p) => p.id === code.id);
  if (!product || product.barcode !== code.barcode)
    throw new Error(`二维码中的物料「${code.barcode}」与当前物料档案不一致，请重新生成标签。`);
  return product;
}
