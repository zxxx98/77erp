import { Category, Product, Workspace } from "../src/model";
export const categories: Category[] = [{ id: 1, name: "日用百货", parent_id: null }, { id: 2, name: "杯具", parent_id: 1 }];
export const product: Product = {
  id: 1,
  category_id: 1,
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
  categories,
  orders: [],
  settings: { business_name: "测试商户", warehouse_name: "主仓库" },
};
