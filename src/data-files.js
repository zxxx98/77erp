import { t, getLocale, translateText } from './i18n/index.js';
import { parseQuantity, materialQuantity } from "../shared/quantity.js";
import { productionTypeValue } from '../shared/product-production-type.js';

export const importHeaders = [
  "物料名称",
  "条码",
  "分类",
  "单位",
  "参考采购价",
  "参考销售价",
  "安全库存",
  "期初库存",
  "单位是否取整",
  "生产类型",
];
const importHeaderKeys = ["warehouse.material.name","warehouse.barcode","warehouse.classification","warehouse.unit","warehouse.reference.purchase.price","warehouse.reference.sales.price","warehouse.safety.stock","warehouse.opening.stock","warehouse.round.quantities.to.whole.units","warehouse.production.type"];
export const getImportHeaders = (language = getLocale()) => importHeaderKeys.map(key => t(key, { lng: language }));
export const createImportTemplate = (language = getLocale()) => '\ufeff' + getImportHeaders(language).join(',') + '\r\n示例电线,TEST-001,电线,米,10.00,15.00,5,20,否,原料\r\n';
// Preserve the existing Chinese template contract for external consumers.
export const importTemplate =
  "\ufeff" +
  importHeaders.join(",") +
  "\r\n示例电线,TEST-001,电线,米,10.00,15.00,5,20,否,原料\r\n";
export function parseCSV(input) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false,
    closed = false;
  const source = input.replace(/^\ufeff/, "");
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else cell += c;
    } else if (c === "," || c === "\n" || c === "\r") {
      row.push(cell);
      cell = "";
      closed = false;
      if (c !== ",") {
        rows.push(row);
        row = [];
        if (c === "\r" && source[i + 1] === "\n") i++;
      }
    } else if (c === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || c === '"')
        throw new Error(t("warehouse.import.csvQuotes"));
      cell += c;
    }
  }
  if (quoted) throw new Error(t("warehouse.import.unclosedQuote"));
  if (cell || row.length || closed) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
export function rowsToProducts(table) {
  const rows = [...table];
  while (
    rows.length &&
    rows.at(-1).every((c) => c == null || String(c).trim() === "")
  )
    rows.pop();
  const header = rows.shift();
  if (
    !header ||
    ![8, 9, importHeaders.length].includes(header.length) ||
    !['zh-CN', 'en', 'vi'].some(language => { const expected = getImportHeaders(language); return header.every((cell, i) => String(cell).trim() === expected[i]); })
  )
    throw new Error(t("warehouse.import.headers"));
  if (!rows.length || rows.length > 1000)
    throw new Error(t("warehouse.import.rowLimit"));
  const numeric = (value, quantity, row) => {
    const s = value == null ? "" : String(value).trim();
    if (quantity) {
      try { return parseQuantity(s); }
      catch (error) { throw new Error(t('warehouse.import.rowError', { row, message: translateText(error.message) })); }
    }
    if (!/^\d+(\.\d{1,4})?$/.test(s))
      throw new Error(
        t('warehouse.import.rowError', { row, message: t('warehouse.import.number') }),
      );
    return Number(s);
  };
  return rows.map((cells, i) => {
    if (cells.length > header.length || !cells[0])
      throw new Error(t('warehouse.import.rowError', { row: i + 2, message: t('warehouse.import.name') }));
    const [name, barcode, category, unit, cost, price, threshold, stock, roundUp, productionType] =
      cells;
    const flag = String(roundUp ?? '').trim().toLowerCase();
    if (!['', '是', '否', 'true', 'false', '1', '0', 'yes', 'no', 'có', 'không'].includes(flag))
      throw new Error(t('warehouse.import.rowError', { row: i + 2, message: t('warehouse.import.round') }));
    let production_type;
    try { const rawType = String(productionType ?? '').trim(); const aliases = { 'Finished product': '成品', 'Semi-finished product': '半成品', 'Raw material': '原料', 'Thành phẩm': '成品', 'Bán thành phẩm': '半成品', 'Nguyên liệu': '原料' }; production_type = productionTypeValue(aliases[rawType] ?? rawType); }
    catch (error) { throw new Error(t('warehouse.import.rowError', { row: i + 2, message: t('warehouse.import.productionType') })); }
    return {
      production_type,
      unit_round_up: ['是', 'true', '1', 'yes', 'có'].includes(flag) ? 1 : 0,
      name: String(name).trim(),
      barcode: barcode == null ? "" : String(barcode).trim(),
      category: category == null ? "" : String(category).trim(),
      unit: unit == null ? "" : String(unit).trim(),
      cost: numeric(cost, false, i + 2),
      price: numeric(price, false, i + 2),
      threshold: materialQuantity(numeric(threshold, true, i + 2), { unit_round_up: ['是', 'true', '1', 'yes', 'có'].includes(flag) }),
      stock: materialQuantity(numeric(stock, true, i + 2), { unit_round_up: ['是', 'true', '1', 'yes', 'có'].includes(flag) }),
    };
  });
}
export function downloadJSON(data, name) {
  download(JSON.stringify(data, null, 2), name, "application/json");
}
export function download(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
