import { Product, Workspace } from "../src/model";
export const product: Product = {
  id: 1,
  name: "陶瓷杯",
  barcode: "SKU-000001",
  category: "日用百货",
  unit: "个",
  cost: 10,
  price: 20,
  stock: 5,
  threshold: 2,
};
export const workspace: Workspace = {
  products: [product],
  orders: [],
  settings: { business_name: "测试商户", warehouse_name: "主仓库" },
};
