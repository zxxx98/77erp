export const importHeaders = [
  "商品名称",
  "条码",
  "分类",
  "单位",
  "采购价",
  "销售价",
  "安全库存",
  "期初库存",
];
export const importTemplate =
  "\ufeff" +
  importHeaders.join(",") +
  "\r\n示例商品,TEST-001,日用百货,件,10.00,15.00,5,20\r\n";
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
    header.length !== importHeaders.length ||
    header.some((c, i) => String(c).trim() !== importHeaders[i])
  )
    throw new Error("表头不匹配，请使用导入模板，保持列顺序。");
  if (!rows.length || rows.length > 1000)
    throw new Error("每次导入 1–1000 行商品。");
  const numeric = (value, integer, row) => {
    const s = value == null ? "" : String(value).trim();
    if (!(integer ? /^\d+$/ : /^\d+(\.\d{1,2})?$/).test(s))
      throw new Error(
        `第 ${row} 行：数量需为非负整数，金额最多两位小数，不能留空。`,
      );
    return Number(s);
  };
  return rows.map((cells, i) => {
    if (cells.length > 8 || !cells[0])
      throw new Error(`第 ${i + 2} 行：商品名称为空或列数错误。`);
    const [name, barcode, category, unit, cost, price, threshold, stock] =
      cells;
    return {
      name: String(name).trim(),
      barcode: barcode == null ? "" : String(barcode).trim(),
      category: category == null ? "" : String(category).trim(),
      unit: unit == null ? "" : String(unit).trim(),
      cost: numeric(cost, false, i + 2),
      price: numeric(price, false, i + 2),
      threshold: numeric(threshold, true, i + 2),
      stock: numeric(stock, true, i + 2),
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
