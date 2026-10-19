export const orderLabel = (o) =>
  `${o.kind === "internal" ? (o.type === "in" ? "内部入库" : "内部出库") : o.kind === "transfer" ? (o.type === "in" ? "调拨入库" : "调拨出库") : o.kind === "return" ? (o.type === "in" ? "销售退货" : "采购退货") : o.type === "in" ? "采购入库" : "销售出库"}${o.status === "void" ? " · 已作废" : ""}`;
export const businessType = (o) =>
  o.kind === "transfer" ? "transfer" : o.kind === "return" ? (o.type === "in" ? "out" : "in") : o.type;
// Reports use the original business direction; returns reduce its amount.
// Warehouse transfers move stock without money, so they stay out of the totals.
export const reportOrders = (orders) =>
  orders
    .filter((o) => o.status !== "void" && !["transfer", "internal"].includes(o.kind))
    .map((o) =>
      o.kind === "return"
        ? { ...o, type: o.type === "in" ? "out" : "in", total: -o.total }
        : o,
    );
