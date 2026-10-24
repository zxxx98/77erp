import { validQuantity, addQuantity, materialQuantity, validStoredQuantity } from "../shared/quantity.js";
import { validUnitPrice } from "../shared/money.js";
import { resolveContact, moveInventory } from "./commerce.js";
import { notifyOrder } from './notifications.js';
const validNumber = (n) =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 99999999;
const validInteger = (n) => validNumber(n) && Number.isInteger(n);
// The caller owns the transaction, including inventory, QR quotas and request receipts.
export function createOrder(db, req, body) {
  const { type, partner, note = "", items } = body;
  if (
    !["in", "out"].includes(type) ||
    typeof partner !== "string" ||
    !partner.trim() ||
    partner.length > 100 ||
    typeof note !== "string" ||
    note.length > 500 ||
    !Array.isArray(items) ||
    !items.length ||
    items.length > 100
  )
    throw new Error("请填写往来单位并至少添加一件物料。");
  const seen = new Set();
  let total = 0;
  const normalized = items.map((item) => {
    if (
      !validInteger(item.product_id) ||
      !validQuantity(item.quantity, true) ||
      !validUnitPrice(item.price)
    )
      throw new Error("物料数量必须为正数且最多 4 位小数，单价最多四位小数且不能为负数。");
    if (seen.has(item.product_id))
      throw new Error("同一物料不能重复添加，请合并数量。");
    seen.add(item.product_id);
    const p = db
      .prepare("SELECT * FROM products WHERE id=?")
      .get(item.product_id);
    if (!p) throw new Error("物料不存在。");
    if (p.warehouse_id !== req.warehouse.id)
      throw new Error("物料不属于当前仓库。");
    item = { ...item, quantity: materialQuantity(item.quantity, p) };
    if (type === "out" && p.stock < item.quantity)
      throw new Error(`${p.name} 库存不足（当前 ${p.stock} ${p.unit}）。`);
    if (type === "in" && !validStoredQuantity(addQuantity(p.stock, item.quantity)))
      throw new Error(`${p.name} 入库后库存超出上限。`);
    const lineTotal = Math.round(item.quantity * item.price * 100);
    if (!Number.isSafeInteger(lineTotal))
      throw new Error("物料金额过大，请减少数量。");
    total += lineTotal;
    return { ...item, product: p, amount_cents: lineTotal };
  });
  if (!Number.isSafeInteger(total))
    throw new Error("单据金额过大，请减少数量或拆分单据。");
  const at = new Date().toISOString();
  const prefix = `${type === "in" ? "RK" : "CK"}${at.slice(0, 10).replaceAll("-", "")}`;
  const last = db
    .prepare(
      "SELECT MAX(CAST(substr(number, ?) AS INTEGER)) AS sequence FROM orders WHERE number LIKE ?",
    )
    .get(prefix.length + 1, `${prefix}%`);
  const number = prefix + String((last.sequence || 0) + 1).padStart(6, "0");
  const contact = resolveContact(db, type, partner, body.partner_id);
  const result = db
    .prepare(
      "INSERT INTO orders (number,type,partner,note,total,created_at,partner_id,kind,settlement_tracked,warehouse_id,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      number,
      type,
      contact.name,
      note,
      total / 100,
      at,
      contact.id,
      contact.role === 'internal' ? 'internal' : 'normal',
      contact.role === 'internal' ? 0 : 1,
      req.warehouse.id,
      req.user.id,
      (req.user.name || req.user.username),
    );
  normalized.forEach((i) => {
    const cost = moveInventory(
      db,
      i.product_id,
      type === "in" ? i.quantity : -i.quantity,
      type === "in" ? i.amount_cents : undefined,
    );
    db.prepare(
      "INSERT INTO order_items (order_id,product_id,name,barcode,quantity,price,cost_cents,amount_cents) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      result.lastInsertRowid,
      i.product_id,
      i.product.name,
      i.product.barcode,
      i.quantity,
      i.price,
      cost,
      i.amount_cents,
    );
  });
  notifyOrder(db, req, Number(result.lastInsertRowid), type === 'in' ? 'purchase_in' : 'sale_out', normalized.map(i => i.product));
  return { id: Number(result.lastInsertRowid), number };
}
