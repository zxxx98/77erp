import { withCustomerPartNumbers } from './customer-part-numbers.js';
import { installR2Backup } from './r2-backup.js';
import { migrateBom, installBom, clearBom } from './bom.js';
import { migrateProduction, installProduction, clearProduction } from './production.js';
import { migrateQuality, installQuality, clearQuality } from './quality.js';
import { installAnnouncements } from './announcements.js';
import { migrateProductChanges, recordProductChange } from './product-changes.js';
import { installAi } from './ai.js';
import { migrateOrderIndexes, warehouseOrders } from "./order-history.js";
import { installProductHistory } from './product-history.js';
import { validQuantity } from '../shared/quantity.js';
import { validUnitPrice } from '../shared/money.js';
import { inspectionToday, inspectionCompletion } from '../shared/inspection.js';
import { hasPermission } from '../shared/permissions.js';
import { createOrder } from './orders.js';
import { migrateProductVersions } from './product-version.js';
import { migrateStockQr, installStockQr, clearStockQr } from './stock-qr.js';
import express from "express";
import { randomUUID } from "node:crypto";
import { migrateWarehouses, installWarehouses, syncProduct } from "./warehouses.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateCommerce } from "./commerce.js";
import { installAuth } from "./auth.js";
import { migrateImagebed, installImagebed } from './imagebed.js';
import { migrateOperations, installOperations, operationRequest, saveOperationRequest } from "./operations.js";
import { migrateCatalog, migrateWarehouseCategories, installCatalog } from "./catalog.js";
import { migrateUnits, getUnits, validateUnits, saveUnits } from "./units.js";
import { installMultiStocktake } from './multi-stocktake.js';
import { getStockExpression, saveStockExpression } from './stock-compare.js';
import { migrateTransfers } from './transfers.js';
import { installQueries } from './queries.js';
import { installDataUpdates } from './data-updates.js';
import { migrateNotifications, installNotifications, queueNotification } from './notifications.js';
import { migrateCurrency, installCurrency } from './currency.js';

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

export function createApp(dbPath = resolve(root, "data/77erp.sqlite"), options = {}) {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, barcode TEXT NOT NULL UNIQUE, category TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '件', cost REAL NOT NULL, price REAL NOT NULL, stock REAL NOT NULL DEFAULT 0 CHECK(stock >= 0), threshold REAL NOT NULL DEFAULT 20, color TEXT NOT NULL DEFAULT 'blue', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, type TEXT NOT NULL CHECK(type IN ('in','out')), partner TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', total REAL NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id), name TEXT NOT NULL, barcode TEXT NOT NULL, quantity REAL NOT NULL, price REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS design_styles (id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL, source TEXT NOT NULL, tokens TEXT NOT NULL, specification TEXT NOT NULL, saved_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), business_name TEXT NOT NULL, warehouse_name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
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
    "INSERT OR IGNORE INTO settings(id,business_name,warehouse_name) VALUES (1, '七七商贸', '主仓库')",
  ).run();

  if (!db.prepare("SELECT 1 FROM app_metadata WHERE key='demo_initialized'").get() &&
      !db.prepare("SELECT id FROM products LIMIT 1").get()) {
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

  db.prepare("INSERT OR IGNORE INTO app_metadata (key,value) VALUES ('demo_initialized','1')").run();
  db.prepare("INSERT OR IGNORE INTO app_metadata (key,value) VALUES ('instance_id',?)").run(randomUUID());

  const app = express();
  app.set("trust proxy", options.trustProxy ?? false);
  migrateOperations(db);
  migrateCommerce(db);
  migrateCatalog(db);
  migrateWarehouses(db);
  migrateTransfers(db);
  migrateWarehouseCategories(db);
  migrateUnits(db);
  migrateImagebed(db);
  migrateStockQr(db);
  migrateProductVersions(db);
  migrateOrderIndexes(db);
  migrateNotifications(db);
  migrateBom(db);
  migrateProduction(db);
  migrateCurrency(db);
  app.use("/api/backup", express.json({ limit: "100mb" }));
  app.use("/api/products/import", express.json({ limit: "1mb" }));
  app.use("/api/ai", express.json({ limit: "1mb" }));
  app.use('/api/quality', express.json({ limit: '2mb' }));
  app.use(['/api/boms', '/api/production-orders'], express.json({ limit: '2mb' }));
  app.use(express.json({ limit: "100kb" }));
  const { sessionUser } = installAuth(app, db, options);
  installCurrency(app, db);
  installAnnouncements(app, db);
  migrateProductChanges(db);
  const { warehouses } = installWarehouses(app, db);
  installProductHistory(app, db);
  const notifications = installNotifications(app, db, options);
  const r2Backup = installR2Backup(app, db, options);
  migrateQuality(db);
  installQuality(app, db, { ...options, sessionUser });
  installBom(app, db);
  installProduction(app, db);
  installImagebed(app, db, options);
  const { catalogValues } = installCatalog(app, db);
  const dataRevision = installDataUpdates(app, db);
  // Lightweight bootstrap: business lists and details are queried on demand.
  app.get('/api/workspace', (req, res) => {
    res.json({
      revision: dataRevision(req),
      user: req.user,
      categories: db.prepare('SELECT id,name,parent_id,warehouse_id FROM categories WHERE warehouse_id=? ORDER BY name,id').all(req.warehouse.id),
      warehouses: warehouses(),
      warehouse_id: req.warehouse.id,
      instance_id: db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value,
      settings: { ...db.prepare('SELECT * FROM settings WHERE id=1').get(), warehouse_name: req.warehouse.name, units: getUnits(db), stock_expression: getStockExpression(db) },
    });
  });
  app.get("/api/data", (req, res) => {
    const financial = hasPermission(req.user, 'finance');
    const hideCosts = !financial && !req.user.legacy_permissions;
    const products = db.prepare("SELECT * FROM products WHERE warehouse_id=? ORDER BY id").all(req.warehouse.id)
      .map(p => { if (hideCosts) delete p.inventory_value_cents; return p; });
    const orders = warehouseOrders(db, req.warehouse.id, { financial, hideCosts });
    res.json({
      user: req.user,
      products: withCustomerPartNumbers(db, products),
      categories: db.prepare("SELECT * FROM categories WHERE warehouse_id=? ORDER BY name,id").all(req.warehouse.id),
      contacts: db.prepare("SELECT * FROM contacts ORDER BY active DESC,name,id").all(),
      orders,
      warehouses: warehouses(),
      warehouse_id: req.warehouse.id,
      instance_id: db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value,
      settings: { ...db.prepare("SELECT * FROM settings WHERE id=1").get(), warehouse_name: req.warehouse.name, units: getUnits(db), stock_expression: getStockExpression(db) },
    });
  });
  app.get("/api/style", (_, res) => {
    const style = db
      .prepare("SELECT * FROM design_styles WHERE id='saas'")
      .get();
    res.json({ ...style, tokens: JSON.parse(style.tokens) });
  });
  app.get("/api/products/export", (req, res) => {
    const financial = hasPermission(req.user, "finance");
    const hideCosts = !financial && !req.user.legacy_permissions;
    const fixedOnly = req.query.fixed === "1" || req.query.fixed === "true";
    const products = db
      .prepare(
        `SELECT name,barcode,category,unit,cost,price,stock,threshold,specification,note,active,is_fixed_asset,unit_round_up FROM products WHERE warehouse_id=? AND active!=0${fixedOnly ? " AND is_fixed_asset=1" : ""} ORDER BY category,name,id`,
      )
      .all(req.warehouse.id)
      .map((p) => {
        if (hideCosts) p.cost = 0;
        return p;
      });
    res.json({ warehouse: { id: req.warehouse.id, name: req.warehouse.name }, products });
  });
  app.get("/api/products/barcode/:barcode", (req, res) => {
    const product = db
      .prepare("SELECT * FROM products WHERE barcode=? AND warehouse_id=?")
      .get(req.params.barcode, req.warehouse.id);
    if (!product)
      return res
        .status(404)
        .json({ error: "未找到该条码对应的物料，请先建立物料档案。" });
    if (!hasPermission(req.user, 'finance') && !req.user.legacy_permissions) delete product.inventory_value_cents;
    res.json(withCustomerPartNumbers(db, [product])[0]);
  });
  app.get("/api/products/:id/other-warehouses", (req, res) => {
    const product = db
      .prepare("SELECT * FROM products WHERE id=? AND warehouse_id=?")
      .get(Number(req.params.id), req.warehouse.id);
    if (!product)
      return res
        .status(404)
        .json({ error: "未找到该物料，请刷新后重试。" });
    const rows = db
      .prepare(
        `SELECT p.warehouse_id, w.name AS warehouse_name, p.id, p.stock, p.unit
           FROM products p JOIN warehouses w ON w.id=p.warehouse_id
          WHERE p.warehouse_id<>? AND (p.sync_key=? OR p.barcode=?)
          ORDER BY w.id`,
      )
      .all(req.warehouse.id, product.sync_key, product.barcode);
    res.json({
      warehouses: rows.map((row) => ({
        warehouse_id: row.warehouse_id,
        warehouse_name: row.warehouse_name,
        product_id: row.id,
        stock: row.stock,
        unit: row.unit,
      })),
    });
  });
  function productValues(body, stored = false) {
    const { name, barcode, unit, cost, price, threshold } = body;
    const category = body.category ?? (Number.isSafeInteger(body.category_id) ? db.prepare("SELECT name FROM categories WHERE id=?").get(body.category_id)?.name : undefined);
    const normalizedBarcode = typeof barcode === "string" ? barcode.trim() : "";
    if (
      ![name, unit].every(
        (x) => typeof x === "string" && x.trim() && x.length <= 100,
      ) ||
      !(typeof category === "string" && category.trim() && category.length <= 1100) ||
      (barcode != null && typeof barcode !== "string") ||
      (normalizedBarcode && !/^[\w.-]{3,64}$/.test(normalizedBarcode)) ||
      !validUnitPrice(cost) ||
      !validUnitPrice(price) ||
      !validQuantity(threshold, false, stored ? 6 : 4)
    )
      throw new Error(
        "请填写有效的物料信息，条码可留空；手动条码需为 3–64 位字母、数字或 ._-，单价最多四位小数且不能为负数，预警值需为非负数且最多 4 位小数。",
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
  function generateBarcode(warehouseId = 1) {
    let sequence = db
      .prepare("SELECT COALESCE(MAX(id), 0) + 1 AS next FROM products")
      .get().next;
    const exists = db.prepare("SELECT id FROM products WHERE barcode=? AND warehouse_id=?");
    let barcode;
    do {
      barcode = `SKU-${String(sequence++).padStart(6, "0")}`;
    } while (exists.get(barcode, warehouseId));
    return barcode;
  }
  app.post("/api/products", (req, res) => {
    let inTransaction = false;
    try {
      const v = productValues(req.body);
      db.exec("BEGIN IMMEDIATE");
      inTransaction = true;
      const catalog = catalogValues(req.body, undefined, req.warehouse.id);
      if (catalog.values[5]) v[6] = Math.ceil(v[6]);
      v[2] = catalog.path;
      if (!v[1]) v[1] = generateBarcode(req.warehouse.id);
      const result = db
        .prepare(
          "INSERT INTO products (name,barcode,category,unit,cost,price,threshold,category_id,image,specification,note,is_fixed_asset,unit_round_up,inspection_date,inspection_interval,inspection_unit,customer_part_numbers,created_at,warehouse_id,sync_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(...v, ...catalog.values, new Date().toISOString(), req.warehouse.id, randomUUID());
      syncProduct(db, Number(result.lastInsertRowid), req.body.sync_warehouse_ids, req.user);
      const saved = db.prepare('SELECT version FROM products WHERE id=?').get(result.lastInsertRowid);
      db.exec("COMMIT");
      inTransaction = false;
      res
        .status(201)
        .json({ id: Number(result.lastInsertRowid), barcode: v[1], version: saved.version });
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
        .prepare("SELECT * FROM products WHERE id=?")
        .get(req.params.id);
      if (!existing) {
        db.exec("ROLLBACK");
        inTransaction = false;
        return res.status(404).json({ error: "物料不存在。" });
      }
      if (!Number.isSafeInteger(req.body.version) || req.body.version < 1 || req.body.version !== existing.version) {
        db.exec('ROLLBACK');
        inTransaction = false;
        return res.status(409).json({
          code: 'PRODUCT_VERSION_CONFLICT',
          error: req.body.version == null
            ? '缺少物料版本，请刷新页面后重新编辑。'
            : '物料信息已被修改，本次未保存。请查看最新信息后重新编辑。',
        });
      }
      const catalog = catalogValues(req.body, existing);
      if (catalog.values[5]) v[6] = Math.ceil(v[6]);
      v[2] = catalog.path;
      if (!v[1]) v[1] = existing.barcode;
      db.prepare(
        "UPDATE products SET name=?,barcode=?,category=?,unit=?,cost=?,price=?,threshold=?,category_id=?,image=?,specification=?,note=?,is_fixed_asset=?,unit_round_up=?,inspection_date=?,inspection_interval=?,inspection_unit=?,customer_part_numbers=? WHERE id=? AND version=?",
      ).run(...v, ...catalog.values, req.params.id, existing.version);
      recordProductChange(db, existing, db.prepare('SELECT cost,price FROM products WHERE id=?').get(existing.id), req.user);
      syncProduct(db, existing.id, req.body.sync_warehouse_ids, req.user);
      const saved = db.prepare('SELECT version FROM products WHERE id=?').get(existing.id);
      db.exec("COMMIT");
      inTransaction = false;
      res.json({ ok: true, barcode: v[1], version: saved.version });
    } catch (e) {
      if (inTransaction) db.exec("ROLLBACK");
      res.status(400).json({
        error: e.message.includes("UNIQUE")
          ? "该条码已被使用，请使用其他条码。"
          : e.message,
      });
    }
  });
  app.post('/api/products/:id/inspect', (req, res) => {
    try {
      db.exec('BEGIN IMMEDIATE');
      const product = db.prepare('SELECT * FROM products WHERE id=? AND warehouse_id=?').get(req.params.id, req.warehouse.id);
      if (!product) throw new Error('物料不存在或不属于当前仓库。');
      if (req.body.version !== product.version) {
        db.exec('ROLLBACK');
        return res.status(409).json({ error: '物料或校验日期已变化，请刷新待校验列表后重试。' });
      }
      const today = inspectionToday();
      if (!product.active || !product.inspection_date || product.inspection_date > today)
        throw new Error('此物料尚未到校验日期或已停用，请刷新待校验列表。');
      const { inspection_date, last_inspected_on } = inspectionCompletion(product, req.body);
      db.prepare('UPDATE products SET inspection_date=?,last_inspected_on=? WHERE id=?').run(inspection_date, last_inspected_on, product.id);
      const saved = db.prepare('SELECT version FROM products WHERE id=?').get(product.id);
      db.exec('COMMIT');
      res.json({ ok: true, inspection_date, last_inspected_on, version: saved.version });
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      res.status(400).json({ error: error.message });
    }
  });
  const parseBatchProductIds = (rawIds) => {
    if (!Array.isArray(rawIds) || !rawIds.length)
      throw new Error("请先选择要操作的物料。");
    const ids = [];
    const seen = new Set();
    for (const item of rawIds) {
      if (!Number.isSafeInteger(item) || item <= 0)
        throw new Error("物料编号无效。");
      if (!seen.has(item)) {
        seen.add(item);
        ids.push(item);
      }
    }
    if (ids.length > 500)
      throw new Error("单次批量操作最多支持 500 种物料。");
    return ids;
  };
  const productDeleteBlockReason = (product) => {
    if (product.stock !== 0 || product.inventory_value_cents !== 0)
      return "物料仍有库存或库存价值，不能删除，请使用停用。清库存可从库存页面开单。";
    if (db.prepare("SELECT 1 FROM order_items WHERE product_id=? LIMIT 1").get(product.id) ||
        db.prepare("SELECT 1 FROM stock_adjustments WHERE product_id=? LIMIT 1").get(product.id))
      return "物料已有单据或盘点记录，不能删除，请使用停用。";
    if (db.prepare("SELECT 1 FROM product_changes WHERE product_id=? LIMIT 1").get(product.id))
      return "物料已有改价记录，不能删除，请使用停用。";
    if (db.prepare("SELECT 1 FROM templates d, json_each(d.items) i WHERE json_extract(i.value, '$.product_id')=? LIMIT 1").get(product.id))
      return "物料被模板引用，不能删除，请先移除模板中的物料或使用停用。";
    if (db.prepare("SELECT 1 FROM stock_qr_items WHERE product_id=? LIMIT 1").get(product.id))
      return "物料被出入库二维码引用，请先从二维码明细移除或使用停用。";
    if (db.prepare("SELECT 1 FROM quality_acceptances a,json_each(a.bindings) b WHERE json_extract(b.value,'$.product_id')=? LIMIT 1").get(product.id))
      return "物料已绑定验收单，不能删除，请使用停用。";
    if (db.prepare('SELECT 1 FROM production_orders WHERE product_id=? LIMIT 1').get(product.id) ||
        db.prepare('SELECT 1 FROM production_items WHERE product_id=? LIMIT 1').get(product.id) ||
        db.prepare('SELECT 1 FROM production_scraps WHERE product_id=? LIMIT 1').get(product.id) ||
        db.prepare('SELECT 1 FROM production_bom_nodes WHERE product_id=? OR bom_product_id=? LIMIT 1').get(product.id, product.id))
      return '物料被生产单引用，不能删除，请使用停用。';
    if (db.prepare('SELECT 1 FROM boms WHERE product_id=? LIMIT 1').get(product.id) ||
        db.prepare('SELECT 1 FROM bom_items WHERE product_id=? LIMIT 1').get(product.id) ||
        db.prepare('SELECT 1 FROM bom_scraps WHERE product_id=? LIMIT 1').get(product.id))
      return '物料被BOM引用，不能删除，请移除引用或使用停用。';
    return null;
  };
  app.post("/api/products/batch/status", (req, res) => {
    let inTransaction = false;
    try {
      const ids = parseBatchProductIds(req.body?.ids);
      const active = req.body?.active;
      if (![0, 1].includes(active))
        return res.status(400).json({ error: "请选择有效的启用或停用状态。" });
      db.exec("BEGIN IMMEDIATE");
      inTransaction = true;
      const selectProduct = db.prepare("SELECT id,name,barcode,active FROM products WHERE id=? AND warehouse_id=?");
      const updateStatus = db.prepare("UPDATE products SET active=? WHERE id=? AND warehouse_id=?");
      const updated = [];
      const skipped = [];
      for (const id of ids) {
        const product = selectProduct.get(id, req.warehouse.id);
        if (!product) {
          skipped.push({ id, name: null, reason: "物料不存在或不属于当前仓库" });
          continue;
        }
        if (product.active === active) {
          skipped.push({ id, name: product.name, barcode: product.barcode, reason: active === 0 ? "已是停用状态" : "已是启用状态" });
          continue;
        }
        updateStatus.run(active, id, req.warehouse.id);
        updated.push(id);
      }
      db.exec("COMMIT");
      inTransaction = false;
      res.json({ ok: true, updated, skipped });
    } catch (e) {
      if (inTransaction) db.exec("ROLLBACK");
      res.status(400).json({ error: e.message.trim() });
    }
  });
  app.post("/api/products/batch/delete/preview", (req, res) => {
    try {
      const ids = parseBatchProductIds(req.body?.ids);
      const selectProduct = db.prepare("SELECT * FROM products WHERE id=? AND warehouse_id=?");
      const deletable = [];
      const blocked = [];
      for (const id of ids) {
        const product = selectProduct.get(id, req.warehouse.id);
        if (!product) {
          blocked.push({ id, name: `物料 #${id}`, barcode: "", reason: "物料不存在或不属于当前仓库。" });
          continue;
        }
        const reason = productDeleteBlockReason(product);
        if (reason) blocked.push({ id: product.id, name: product.name, barcode: product.barcode, reason });
        else deletable.push({ id: product.id, name: product.name, barcode: product.barcode });
      }
      res.json({ ok: true, deletable, blocked });
    } catch (e) {
      res.status(400).json({ error: e.message.trim() });
    }
  });
  app.post("/api/products/batch/delete", (req, res) => {
    let inTransaction = false;
    try {
      const ids = parseBatchProductIds(req.body?.ids);
      db.exec("BEGIN IMMEDIATE");
      inTransaction = true;
      const selectProduct = db.prepare("SELECT * FROM products WHERE id=? AND warehouse_id=?");
      const deleteProduct = db.prepare("DELETE FROM products WHERE id=? AND warehouse_id=?");
      const failed = [];
      for (const id of ids) {
        const product = selectProduct.get(id, req.warehouse.id);
        if (!product) {
          failed.push({ id, name: `物料 #${id}`, barcode: "", reason: "物料不存在或不属于当前仓库。" });
          continue;
        }
        const reason = productDeleteBlockReason(product);
        if (reason) failed.push({ id: product.id, name: product.name, barcode: product.barcode, reason });
      }
      if (failed.length) {
        db.exec("ROLLBACK");
        inTransaction = false;
        return res.status(400).json({
          error: failed.length === 1 ? failed[0].reason : `${failed.length} 种物料无法删除，本次未删除任何物料。`,
          deleted: [],
          failed,
        });
      }
      for (const id of ids) deleteProduct.run(id, req.warehouse.id);
      db.exec("COMMIT");
      inTransaction = false;
      res.json({ ok: true, deleted: ids, failed: [] });
    } catch (e) {
      if (inTransaction) db.exec("ROLLBACK");
      res.status(400).json({ error: e.message.trim() });
    }
  });
  // Lifecycle actions affect only the current warehouse, never synchronized copies.
  app.post("/api/products/:id/status", (req, res) => {
    if (![0, 1].includes(req.body?.active))
      return res.status(400).json({ error: "请选择有效的启用或停用状态。" });
    const result = db.prepare("UPDATE products SET active=? WHERE id=?").run(req.body.active, req.params.id);
    if (!result.changes) return res.status(404).json({ error: "物料不存在。" });
    res.json({ ok: true });
  });
  app.delete("/api/products/:id", (req, res) => {
    let inTransaction = false;
    try {
      db.exec("BEGIN IMMEDIATE");
      inTransaction = true;
      const product = db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);
      if (!product) {
        db.exec("ROLLBACK");
        inTransaction = false;
        return res.status(404).json({ error: "物料不存在。" });
      }
      const reason = productDeleteBlockReason(product);
      if (reason) throw new Error(reason);
      db.prepare("DELETE FROM products WHERE id=?").run(product.id);
      db.exec("COMMIT");
      inTransaction = false;
      res.json({ ok: true });
    } catch (e) {
      if (inTransaction) db.exec("ROLLBACK");
      res.status(400).json({ error: e.message.trim() });
    }
  });
  app.get('/api/orders/export', (req, res) => {
    res.json(db.prepare('SELECT id,number,type,kind,status,partner,total,created_at,note FROM orders WHERE warehouse_id=? ORDER BY created_at DESC,id DESC')
      .all(req.warehouse.id).map(o => ({ ...o, items: db.prepare('SELECT name,quantity,price,amount_cents FROM order_items WHERE order_id=? ORDER BY id').all(o.id) })));
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
        throw new Error("请填写往来单位并至少添加一件物料。");
      db.exec("BEGIN IMMEDIATE");
      inTransaction = true;
      const request = operationRequest(db, req, true);
      if (request?.previous) {
        db.exec('COMMIT'); inTransaction = false;
        return res.json(request.previous);
      }
      const response = createOrder(db, req, req.body);
      saveOperationRequest(db, request, response);
      db.exec("COMMIT");
      inTransaction = false;
      res.status(201).json(response);
    } catch (e) {
      if (inTransaction) db.exec("ROLLBACK");
      res.status(400).json({ error: e.message });
    }
  });
  app.post("/api/settings/reset", (req, res) => {
    if (req.body?.confirmation !== "RESET_BUSINESS_DATA")
      return res.status(400).json({ error: "请先确认清空全部业务数据。" });
    try {
      db.exec("BEGIN IMMEDIATE");
      const counts = { action: '重置业务数据', products: db.prepare('SELECT COUNT(*) AS n FROM products').get().n, orders: db.prepare('SELECT COUNT(*) AS n FROM orders').get().n };
      clearStockQr(db);
      clearQuality(db);
      clearProduction(db);
      clearBom(db);
      db.exec("UPDATE ai_conversations SET auth_context=''; UPDATE ai_actions SET expires_at=0 WHERE result IS NULL;");
      db.exec("PRAGMA defer_foreign_keys=ON; DELETE FROM payments; DELETE FROM templates; DELETE FROM stock_adjustments; DELETE FROM product_changes; DELETE FROM order_items; DELETE FROM orders; DELETE FROM products; DELETE FROM categories; DELETE FROM contacts; DELETE FROM operation_requests;");
      queueNotification(db, req, 'admin_action', counts, { global: true });
      db.exec("COMMIT");
      res.json({ ok: true });
    } catch (e) {
      if (db.isTransaction) db.exec("ROLLBACK");
      res.status(500).json({ error: "重置失败，数据未清空，请重试。" });
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
    let units;
    try {
      if (req.body.units !== undefined) units = validateUnits(req.body.units);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    const savesExpression = req.body.stock_expression !== undefined;
    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare("UPDATE warehouses SET name=? WHERE id=?").run(warehouse_name.trim(), req.warehouse.id);
      db.prepare("UPDATE settings SET business_name=? WHERE id=1").run(business_name.trim());
      if (req.warehouse.id === 1) db.prepare("UPDATE settings SET warehouse_name=? WHERE id=1").run(warehouse_name.trim());
      if (units) saveUnits(db, units);
      if (savesExpression) saveStockExpression(db, req.body.stock_expression);
      db.exec("COMMIT");
      res.json({ ok: true });
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      res.status(400).json({ error: error.message.includes('对比表达式') ? error.message : "仓库名称已存在。" });
    }
  });
  installStockQr(app, db);
  const imports = installOperations(app, db, { productValues, generateBarcode, catalogValues });
  installAi(app, db, { ...options, sessionUser, imports });
  installMultiStocktake(app, db);
  installQueries(app, db);
  app.use("/api", (_, res) => res.status(404).json({ error: "接口不存在。" }));
  app.use((error, req, res, next) => {
    if (error.type === "entity.too.large") return res.status(413).json({ error: "提交内容过大，请减少行数或选择更小的文件。" });
    if (error.type === "entity.parse.failed") return res.status(400).json({ error: "提交内容不是有效的 JSON。" });
    next(error);
  });
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
  return { app, db, notifications, r2Backup };
}
