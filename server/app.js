import express from "express";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installAuth } from "./auth.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const tokens = {
  accent: "#2563EB",
  accentLight: "#EFF5FF",
  referenceAccent: "#0052FF",
  background: "#F7F8FA",
  surface: "#FFFFFF",
  text: "#17243C",
  muted: "#7E8798",
  border: "#E9ECF1",
  success: "#16A383",
  warning: "#E59A2F",
  danger: "#E45B64",
  radius: "12px",
};
const dateAt = (offset, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hour, 24, 0, 0);
  return d.toISOString();
};

export function createApp(dbPath = resolve(root, "data/77erp.sqlite")) {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, barcode TEXT NOT NULL UNIQUE, category TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '件', cost REAL NOT NULL, price REAL NOT NULL, stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0), threshold INTEGER NOT NULL DEFAULT 20, color TEXT NOT NULL DEFAULT 'blue', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, type TEXT NOT NULL CHECK(type IN ('in','out')), partner TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', total REAL NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id), name TEXT NOT NULL, barcode TEXT NOT NULL, quantity INTEGER NOT NULL, price REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS design_styles (id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL, source TEXT NOT NULL, tokens TEXT NOT NULL, specification TEXT NOT NULL, saved_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), business_name TEXT NOT NULL, warehouse_name TEXT NOT NULL);
  `);
  db.prepare(
    `INSERT INTO design_styles VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, version=excluded.version, source=excluded.source, tokens=excluded.tokens, specification=excluded.specification`,
  ).run(
    "saas",
    "SaaS · 极简现代",
    "1.0.1",
    "https://www.designprompts.dev/saas/",
    JSON.stringify(tokens),
    readFileSync(resolve(root, "docs/design-system.md"), "utf8"),
    new Date().toISOString(),
  );
  db.prepare(
    "INSERT OR IGNORE INTO settings VALUES (1, '七七商贸', '主仓库')",
  ).run();

  if (!db.prepare("SELECT id FROM products LIMIT 1").get()) {
    const products = [
      [
        "极简陶瓷马克杯",
        "6901234567001",
        "生活日用",
        "个",
        24,
        49,
        128,
        30,
        "sand",
      ],
      [
        "便携无线蓝牙音箱",
        "6901234567002",
        "数码配件",
        "台",
        89,
        159,
        56,
        15,
        "blue",
      ],
      [
        "A5 线装笔记本",
        "6901234567003",
        "办公文具",
        "本",
        8.5,
        18,
        12,
        30,
        "green",
      ],
      [
        "棉麻帆布手提袋",
        "6901234567004",
        "生活日用",
        "个",
        18,
        39,
        85,
        20,
        "sand",
      ],
      [
        "不锈钢保温杯 500ml",
        "6901234567005",
        "生活日用",
        "个",
        45,
        89,
        8,
        20,
        "blue",
      ],
      [
        "多功能桌面收纳盒",
        "6901234567006",
        "办公文具",
        "个",
        16,
        35,
        67,
        15,
        "pink",
      ],
      [
        "Type-C 数据线 1m",
        "6901234567007",
        "数码配件",
        "条",
        12,
        29,
        0,
        25,
        "purple",
      ],
      [
        "天然香薰蜡烛",
        "6901234567008",
        "生活日用",
        "个",
        22,
        58,
        43,
        10,
        "pink",
      ],
      [
        "无线静音鼠标",
        "6901234567009",
        "数码配件",
        "个",
        38,
        69,
        74,
        20,
        "purple",
      ],
      [
        "按动中性笔 0.5mm",
        "6901234567010",
        "办公文具",
        "支",
        2.5,
        6,
        320,
        60,
        "green",
      ],
      ["纯棉毛巾", "6901234567011", "生活日用", "条", 12, 25, 96, 20, "sand"],
      [
        "折叠手机支架",
        "6901234567012",
        "数码配件",
        "个",
        15,
        35,
        48,
        15,
        "blue",
      ],
    ];
    const insert = db.prepare(
      "INSERT INTO products (name,barcode,category,unit,cost,price,stock,threshold,color,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    );
    products.forEach((p) => insert.run(...p, dateAt(-45)));
    const orderInsert = db.prepare(
      "INSERT INTO orders (number,type,partner,note,total,created_at) VALUES (?,?,?,?,?,?)",
    );
    const itemInsert = db.prepare(
      "INSERT INTO order_items (order_id,product_id,name,barcode,quantity,price) VALUES (?,?,?,?,?,?)",
    );
    for (let day = -29; day <= 0; day++) {
      for (let n = 0; n < (day === 0 ? 6 : 2); n++) {
        const type = n % 2 === 0 ? "in" : "out";
        const product = db
          .prepare("SELECT * FROM products WHERE id=?")
          .get(((day + 30 + n) % 12) + 1);
        const quantity = 5 + (((day + 30) * 7 + n * 11) % 35);
        const price = type === "in" ? product.cost : product.price;
        const at =
          day === 0
            ? new Date(Date.now() - (6 - n) * 20 * 60000).toISOString()
            : dateAt(day, 9 + n);
        // Today's recent orders can fall on yesterday before 02:00.
        // Keep seed sequences unique across days as well as within each day.
        const number = `${type === "in" ? "RK" : "CK"}${at.slice(0, 10).replaceAll("-", "")}${String((day + 29) * 6 + n + 1).padStart(6, "0")}`;
        const partner =
          type === "in"
            ? ["优品生活供应链", "创意文具有限公司", "深圳星辰电子"][
                (day + 30 + n) % 3
              ]
            : ["零售客户", "云山生活馆", "拾光文创店"][(day + 30 + n) % 3];
        const result = orderInsert.run(
          number,
          type,
          partner,
          "演示单据（期初库存已结转）",
          Math.round(quantity * price * 100) / 100,
          at,
        );
        itemInsert.run(
          result.lastInsertRowid,
          product.id,
          product.name,
          product.barcode,
          quantity,
          price,
        );
      }
    }
  }

  const app = express();
  app.use(express.json({ limit: "100kb" }));
  installAuth(app, db);
  app.get("/api/data", (_, res) => {
    const products = db.prepare("SELECT * FROM products ORDER BY id").all();
    const orders = db
      .prepare("SELECT * FROM orders ORDER BY created_at DESC,id DESC")
      .all()
      .map((o) => ({
        ...o,
        items: db
          .prepare("SELECT * FROM order_items WHERE order_id=?")
          .all(o.id),
      }));
    res.json({
      products,
      orders,
      settings: db.prepare("SELECT * FROM settings WHERE id=1").get(),
    });
  });
  app.get("/api/style", (_, res) => {
    const style = db
      .prepare("SELECT * FROM design_styles WHERE id='saas'")
      .get();
    res.json({ ...style, tokens: JSON.parse(style.tokens) });
  });
  app.get("/api/products/barcode/:barcode", (req, res) => {
    const product = db
      .prepare("SELECT * FROM products WHERE barcode=?")
      .get(req.params.barcode);
    if (!product)
      return res
        .status(404)
        .json({ error: "未找到该条码对应的商品，请先建立商品档案。" });
    res.json(product);
  });
  const validNumber = (n) =>
    typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 99999999;
  const validInteger = (n) => validNumber(n) && Number.isInteger(n);
  const validMoney = (n) =>
    validNumber(n) && Math.abs(n * 100 - Math.round(n * 100)) < 0.00001;
  function productValues(body) {
    const { name, barcode, category, unit, cost, price, threshold } = body;
    const normalizedBarcode = typeof barcode === "string" ? barcode.trim() : "";
    if (
      ![name, category, unit].every(
        (x) => typeof x === "string" && x.trim() && x.length <= 100,
      ) ||
      (barcode != null && typeof barcode !== "string") ||
      (normalizedBarcode && !/^[\w.-]{3,64}$/.test(normalizedBarcode)) ||
      !validMoney(cost) ||
      !validMoney(price) ||
      !validInteger(threshold)
    )
      throw new Error(
        "请填写有效的商品信息，条码可留空；手动条码需为 3–64 位字母、数字或 ._-，金额最多两位小数且不能为负数，预警值需为非负整数。",
      );
    return [
      name.trim(),
      normalizedBarcode,
      category.trim(),
      unit.trim(),
      cost,
      price,
      threshold,
    ];
  }
  function generateBarcode() {
    let sequence = db
      .prepare("SELECT COALESCE(MAX(id), 0) + 1 AS next FROM products")
      .get().next;
    const exists = db.prepare("SELECT id FROM products WHERE barcode=?");
    let barcode;
    do {
      barcode = `SKU-${String(sequence++).padStart(6, "0")}`;
    } while (exists.get(barcode));
    return barcode;
  }
  app.post("/api/products", (req, res) => {
    let inTransaction = false;
    try {
      const v = productValues(req.body);
      db.exec("BEGIN IMMEDIATE");
      inTransaction = true;
      if (!v[1]) v[1] = generateBarcode();
      const result = db
        .prepare(
          "INSERT INTO products (name,barcode,category,unit,cost,price,threshold,created_at) VALUES (?,?,?,?,?,?,?,?)",
        )
        .run(...v, new Date().toISOString());
      db.exec("COMMIT");
      inTransaction = false;
      res
        .status(201)
        .json({ id: Number(result.lastInsertRowid), barcode: v[1] });
    } catch (e) {
      if (inTransaction) db.exec("ROLLBACK");
      res.status(400).json({
        error: e.message.includes("UNIQUE")
          ? "该条码已被使用，请使用其他条码。"
          : e.message,
      });
    }
  });
  app.put("/api/products/:id", (req, res) => {
    let inTransaction = false;
    try {
      const v = productValues(req.body);
      db.exec("BEGIN IMMEDIATE");
      inTransaction = true;
      const existing = db
        .prepare("SELECT barcode FROM products WHERE id=?")
        .get(req.params.id);
      if (!existing) {
        db.exec("ROLLBACK");
        inTransaction = false;
        return res.status(404).json({ error: "商品不存在。" });
      }
      if (!v[1]) v[1] = existing.barcode;
      db.prepare(
        "UPDATE products SET name=?,barcode=?,category=?,unit=?,cost=?,price=?,threshold=? WHERE id=?",
      ).run(...v, req.params.id);
      db.exec("COMMIT");
      inTransaction = false;
      res.json({ ok: true, barcode: v[1] });
    } catch (e) {
      if (inTransaction) db.exec("ROLLBACK");
      res.status(400).json({
        error: e.message.includes("UNIQUE")
          ? "该条码已被使用，请使用其他条码。"
          : e.message,
      });
    }
  });
  app.post("/api/orders", (req, res) => {
    let inTransaction = false;
    try {
      const { type, partner, note = "", items } = req.body;
      if (
        !["in", "out"].includes(type) ||
        typeof partner !== "string" ||
        !partner.trim() ||
        partner.length > 100 ||
        typeof note !== "string" ||
        note.length > 500 ||
        !Array.isArray(items) ||
        !items.length ||
        items.length > 100
      )
        throw new Error("请填写往来单位并至少添加一件商品。");
      const seen = new Set();
      db.exec("BEGIN IMMEDIATE");
      inTransaction = true;
      let total = 0;
      const normalized = items.map((item) => {
        if (
          !validInteger(item.product_id) ||
          !validInteger(item.quantity) ||
          item.quantity < 1 ||
          !validMoney(item.price)
        )
          throw new Error(
            "商品数量必须为正整数，单价最多两位小数且不能为负数。",
          );
        if (seen.has(item.product_id))
          throw new Error("同一商品不能重复添加，请合并数量。");
        seen.add(item.product_id);
        const p = db
          .prepare("SELECT * FROM products WHERE id=?")
          .get(item.product_id);
        if (!p) throw new Error("商品不存在。");
        if (type === "out" && p.stock < item.quantity)
          throw new Error(`${p.name} 库存不足（当前 ${p.stock} ${p.unit}）。`);
        total += Math.round(item.quantity * item.price * 100);
        return { ...item, product: p };
      });
      if (!Number.isSafeInteger(total))
        throw new Error("单据金额过大，请减少数量或拆分单据。");
      const at = new Date().toISOString();
      const prefix = `${type === "in" ? "RK" : "CK"}${at.slice(0, 10).replaceAll("-", "")}`;
      const last = db
        .prepare(
          "SELECT MAX(CAST(substr(number, ?) AS INTEGER)) AS sequence FROM orders WHERE number LIKE ?",
        )
        .get(prefix.length + 1, `${prefix}%`);
      const number = prefix + String((last.sequence || 0) + 1).padStart(6, "0");
      const result = db
        .prepare(
          "INSERT INTO orders (number,type,partner,note,total,created_at) VALUES (?,?,?,?,?,?)",
        )
        .run(number, type, partner.trim(), note, total / 100, at);
      normalized.forEach((i) => {
        db.prepare(
          "INSERT INTO order_items (order_id,product_id,name,barcode,quantity,price) VALUES (?,?,?,?,?,?)",
        ).run(
          result.lastInsertRowid,
          i.product_id,
          i.product.name,
          i.product.barcode,
          i.quantity,
          i.price,
        );
        db.prepare("UPDATE products SET stock=stock+? WHERE id=?").run(
          type === "in" ? i.quantity : -i.quantity,
          i.product_id,
        );
      });
      db.exec("COMMIT");
      inTransaction = false;
      res.status(201).json({ id: Number(result.lastInsertRowid), number });
    } catch (e) {
      if (inTransaction) db.exec("ROLLBACK");
      res.status(400).json({ error: e.message });
    }
  });
  app.put("/api/settings", (req, res) => {
    const { business_name, warehouse_name } = req.body;
    if (
      ![business_name, warehouse_name].every(
        (s) => typeof s === "string" && s.trim() && s.length <= 60,
      )
    )
      return res
        .status(400)
        .json({ error: "请输入 1–60 字的商户和仓库名称。" });
    db.prepare(
      "UPDATE settings SET business_name=?,warehouse_name=? WHERE id=1",
    ).run(business_name.trim(), warehouse_name.trim());
    res.json({ ok: true });
  });
  app.use("/api", (_, res) => res.status(404).json({ error: "接口不存在。" }));
  app.use(express.static(resolve(root, "dist")));
  app.get("/{*path}", (_, res) =>
    res.sendFile(resolve(root, "dist/index.html")),
  );
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({
      error:
        err.status === 400 ? "请求格式错误。" : "服务暂时不可用，请稍后重试。",
    });
  });
  return { app, db };
}
