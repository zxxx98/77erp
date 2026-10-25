import { t as translate, getFormatLocale } from './i18n/index.js';
export const orderLabel = (o, language) =>
  `${o.kind === "internal" ? (o.type === "in" ? translate("warehouse.internal.stock.in", { lng: language }) : translate("warehouse.internal.stock.out", { lng: language })) : o.kind === "transfer" ? (o.type === "in" ? translate("warehouse.transfer.in", { lng: language }) : translate("warehouse.transfer.out", { lng: language })) : o.kind === "return" ? (o.type === "in" ? translate("warehouse.sales.return", { lng: language }) : translate("warehouse.purchase.return", { lng: language })) : o.type === "in" ? translate("warehouse.stock.in", { lng: language }) : translate("warehouse.stock.out", { lng: language })}${o.status === "void" ? translate("warehouse.voided.2", { lng: language }) : ""}`;
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
