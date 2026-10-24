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
        throw new Error("CSV 引号格式错误，请重新导出。");
      cell += c;
    }
  }
  if (quoted) throw new Error("CSV 引号未闭合。");
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
    header.some((c, i) => String(c).trim() !== importHeaders[i])
  )
    throw new Error("表头不匹配，请使用导入模板，保持列顺序。");
  if (!rows.length || rows.length > 1000)
    throw new Error("每次导入 1–1000 行物料。");
  const numeric = (value, quantity, row) => {
    const s = value == null ? "" : String(value).trim();
    if (quantity) {
      try { return parseQuantity(s); }
      catch (error) { throw new Error(`第 ${row} 行：${error.message}`); }
    }
    if (!/^\d+(\.\d{1,4})?$/.test(s))
      throw new Error(
        `第 ${row} 行：数量最多 4 位小数，单价最多四位小数，不能留空。`,
      );
    return Number(s);
  };
  return rows.map((cells, i) => {
    if (cells.length > header.length || !cells[0])
      throw new Error(`第 ${i + 2} 行：物料名称为空或列数错误。`);
    const [name, barcode, category, unit, cost, price, threshold, stock, roundUp, productionType] =
      cells;
    const flag = String(roundUp ?? '').trim().toLowerCase();
    if (!['', '是', '否', 'true', 'false', '1', '0', 'yes', 'no'].includes(flag))
      throw new Error(`第 ${i + 2} 行：单位是否取整需填写是/否、true/false 或 1/0。`);
    let production_type;
    try { production_type = productionTypeValue(String(productionType ?? '').trim()); }
    catch (error) { throw new Error(`第 ${i + 2} 行：${error.message}`); }
    return {
      production_type,
      unit_round_up: ['是', 'true', '1', 'yes'].includes(flag) ? 1 : 0,
      name: String(name).trim(),
      barcode: barcode == null ? "" : String(barcode).trim(),
      category: category == null ? "" : String(category).trim(),
      unit: unit == null ? "" : String(unit).trim(),
      cost: numeric(cost, false, i + 2),
      price: numeric(price, false, i + 2),
      threshold: materialQuantity(numeric(threshold, true, i + 2), { unit_round_up: ['是', 'true', '1', 'yes'].includes(flag) }),
      stock: materialQuantity(numeric(stock, true, i + 2), { unit_round_up: ['是', 'true', '1', 'yes'].includes(flag) }),
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
