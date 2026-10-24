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

export function warehouseSheet(warehouse, products) {
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
    p.is_fixed_asset ? "是" : "否",
    p.active === 0 ? "停用" : "启用",
    p.unit_round_up ? "是" : "否",
    String(p.production_type ?? ""),
  ]);
  return {
    data: [productExportHeaders, ...rows],
    sheet: warehouse.name,
    stickyRowsCount: 1,
  };
}

export function exportFileName(now = new Date()) {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  return `77ERP-物料导出-${stamp}.xlsx`;
}
