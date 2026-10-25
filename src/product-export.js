import { t, getLocale } from './i18n/index.js';
export const productExportHeaders = [
  "物料名称",
  "条码",
  "分类",
  "单位",
  "参考采购价",
  "参考销售价",
  "安全库存",
  "当前库存",
  "规格型号",
  "备注",
  "固定资产",
  "状态",
  "单位是否取整",
  "生产类型",
];

const exportHeaderKeys = ["warehouse.material.name","warehouse.barcode","warehouse.classification","warehouse.unit","warehouse.reference.purchase.price","warehouse.reference.sales.price","warehouse.safety.stock","warehouse.current.inventory","warehouse.specifications.and.models","warehouse.remarks","warehouse.fixed.asset","warehouse.status","warehouse.round.quantities.to.whole.units","warehouse.production.type"];
export const getProductExportHeaders = (language = getLocale()) => exportHeaderKeys.map(key => t(key, { lng: language }));

// Excel sheet names are capped at 31 characters and forbid : \ / ? * [ ]
export function sheetName(name, used) {
  const base = String(name || "仓库").replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "仓库";
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    const suffix = ` (${n++})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate);
  return candidate;
}

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : "");

export function warehouseSheet(warehouse, products, language = getLocale()) {
  const rows = products.map((p) => [
    String(p.name ?? ""),
    String(p.barcode ?? ""),
    String(p.category ?? ""),
    String(p.unit ?? ""),
    number(p.cost),
    number(p.price),
    number(p.threshold),
    number(p.stock),
    String(p.specification ?? ""),
    String(p.note ?? ""),
    p.is_fixed_asset ? t("warehouse.yes", { lng: language }) : t("warehouse.no", { lng: language }),
    t(p.active === 0 ? 'warehouse.export.inactive' : 'warehouse.export.active', { lng: language }),
    p.unit_round_up ? t("warehouse.yes", { lng: language }) : t("warehouse.no", { lng: language }),
    String(p.production_type ?? ""),
  ]);
  return {
    data: [getProductExportHeaders(language), ...rows],
    sheet: warehouse.name,
    stickyRowsCount: 1,
  };
}

export function exportFileName(now = new Date(), language = getLocale()) {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  return t('warehouse.export.filename', { stamp, lng: language });
}
