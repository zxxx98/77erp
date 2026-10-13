export function stockQrLabel(raw) {
  let label;
  try {
    label = JSON.parse(raw);
  } catch {
    return null;
  }
  return label?.format === "77erp" && label.type === "stock_operation"
    ? label
    : null;
}
export function stockQrPayload(qr, sourceId) {
  return JSON.stringify({
    format: "77erp",
    version: 1,
    type: "stock_operation",
    source_id: sourceId,
    warehouse_id: qr.warehouse_id,
    qr_id: qr.qr_id,
  });
}
export const newRequestId = () =>
  Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) =>
    n.toString(16),
  ).join("-");
