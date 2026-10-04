export type Product = {
  id: number;
  name: string;
  barcode: string;
  category: string;
  unit: string;
  cost: number;
  price: number;
  stock: number;
  threshold: number;
};
export type OrderItem = {
  product_id: number;
  name: string;
  barcode: string;
  quantity: number;
  price: number;
};
export type Order = {
  id: number;
  number: string;
  type: "in" | "out";
  partner: string;
  note: string;
  total: number;
  created_at: string;
  items: OrderItem[];
};
export type Settings = { business_name: string; warehouse_name: string };
export type Workspace = {
  products: Product[];
  orders: Order[];
  settings: Settings;
};
export type AuthState = {
  initialized: boolean;
  authenticated: boolean;
  username?: string;
};
export type ProductForm = {
  name: string;
  barcode: string;
  category: string;
  unit: string;
  cost: string;
  price: string;
  threshold: string;
};
export type Line = { product: Product; quantity: string; price: string };
export const money = (value: number) =>
  `¥ ${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const dateTime = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
export const stockLabel = (product: Product) =>
  product.stock === 0
    ? "缺货"
    : product.stock <= product.threshold
      ? "库存偏低"
      : "库存充足";
export const matchesProduct = (product: Product, query: string) =>
  [product.name, product.barcode, product.category].some((value) =>
    value.toLowerCase().includes(query.trim().toLowerCase()),
  );

function numberInput(value: string, label: string, integer = false) {
  const number = Number(value);
  if (
    !(integer ? /^\d+$/ : /^\d+(\.\d{1,2})?$/).test(value.trim()) ||
    !Number.isFinite(number) ||
    number > 99999999
  ) {
    throw new Error(
      `${label}${integer ? "需为非负整数" : "需为非负金额，最多两位小数"}。`,
    );
  }
  return number;
}
export function productPayload(form: ProductForm) {
  for (const [value, label] of [
    [form.name, "商品名称"],
    [form.category, "分类"],
    [form.unit, "单位"],
  ]) {
    if (!value?.trim() || value.length > 100)
      throw new Error(`请填写 1–100 字的${label}。`);
  }
  if (form.barcode.trim() && !/^[\w.-]{3,64}$/.test(form.barcode.trim()))
    throw new Error("条码需为 3–64 位字母、数字或 ._-，也可留空自动生成。");
  return {
    name: form.name.trim(),
    barcode: form.barcode.trim(),
    category: form.category.trim(),
    unit: form.unit.trim(),
    cost: numberInput(form.cost, "采购价"),
    price: numberInput(form.price, "销售价"),
    threshold: numberInput(form.threshold, "安全库存", true),
  };
}
export function addLine(
  lines: Line[],
  product: Product,
  type: "in" | "out",
): Line[] {
  const found = lines.find((line) => line.product.id === product.id);
  if (found)
    return lines.map((line) =>
      line === found
        ? { ...line, quantity: String((Number(line.quantity) || 0) + 1) }
        : line,
    );
  if (lines.length >= 100) throw new Error("一张单据最多添加 100 种商品。");
  return [
    ...lines,
    {
      product,
      quantity: "1",
      price: String(type === "in" ? product.cost : product.price),
    },
  ];
}
export function orderPayload(
  type: "in" | "out",
  partner: string,
  note: string,
  lines: Line[],
) {
  const partnerLabel = type === "in" ? "供应商" : "客户";
  if (!partner.trim()) throw new Error(`请填写${partnerLabel}名称。`);
  if (partner.length > 100)
    throw new Error(`${partnerLabel}名称不能超过 100 字。`);
  if (note.length > 500) throw new Error("备注不能超过 500 字。");
  if (!lines.length || lines.length > 100)
    throw new Error("请添加 1–100 种商品。");
  const seen = new Set<number>();
  let cents = 0;
  const items = lines.map((line) => {
    const quantity = numberInput(
      line.quantity,
      `${line.product.name}数量`,
      true,
    );
    const price = numberInput(line.price, `${line.product.name}单价`);
    if (!quantity) throw new Error("商品数量必须大于 0。");
    if (seen.has(line.product.id)) throw new Error("同一商品不能重复添加。");
    seen.add(line.product.id);
    if (type === "out" && quantity > line.product.stock)
      throw new Error(
        `${line.product.name} 库存不足（当前 ${line.product.stock} ${line.product.unit}）。`,
      );
    cents += Math.round(quantity * price * 100);
    return { product_id: line.product.id, quantity, price };
  });
  if (!Number.isSafeInteger(cents))
    throw new Error("单据金额过大，请拆分单据。");
  return { type, partner: partner.trim(), note, items };
}
export function orderTotal(lines: Line[]) {
  return (
    lines.reduce(
      (total, line) =>
        total +
        Math.round(
          (Number(line.quantity) || 0) * (Number(line.price) || 0) * 100,
        ),
      0,
    ) / 100
  );
}
