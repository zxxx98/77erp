import { validQuantity, addQuantity } from "../shared/quantity.js";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { contactMatchesDirection } from '../shared/contacts.js';
import { resolveContact } from "./commerce.js";
import { createOrder } from "./orders.js";
import { operationRequest, saveOperationRequest } from "./operations.js";

export const stockQrTables = [
  "stock_qr_codes",
  "stock_qr_items",
  "stock_qr_revisions",
  "stock_qr_usages",
];
const integer = (n, min = 0, max = 99999999) =>
  Number.isSafeInteger(n) && n >= min && n <= max;
const text = (s, max, empty = false) =>
  typeof s === "string" && s.length <= max && (empty || s.trim().length > 0);
const uuid = (s) =>
  typeof s === "string" &&
  /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(s);
const hash = (s) => createHash("sha256").update(s).digest("hex");
const now = () => new Date().toISOString();
function fail(code, message, status = 409, details) {
  throw Object.assign(new Error(message), { code, status, details });
}
export function migrateStockQr(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS stock_qr_codes (
    id INTEGER PRIMARY KEY, qr_id TEXT NOT NULL UNIQUE, warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('in','out')),
    max_scans INTEGER CHECK(max_scans IS NULL OR max_scans BETWEEN 1 AND 99999999),
    used_scans INTEGER NOT NULL DEFAULT 0 CHECK(used_scans >= 0 AND used_scans <= 9007199254740991),
    require_confirmation INTEGER NOT NULL DEFAULT 1 CHECK(require_confirmation IN (0,1)),
    partner_id INTEGER NOT NULL REFERENCES contacts(id), partner_name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), version INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER, created_by_name TEXT NOT NULL, updated_by INTEGER, updated_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, CHECK(max_scans IS NULL OR used_scans <= max_scans));
    CREATE TABLE IF NOT EXISTS stock_qr_items (
    id INTEGER PRIMARY KEY, stock_qr_id INTEGER NOT NULL REFERENCES stock_qr_codes(id),
    product_id INTEGER NOT NULL REFERENCES products(id), product_barcode TEXT NOT NULL, product_unit TEXT NOT NULL,
    quantity REAL NOT NULL CHECK(quantity > 0 AND quantity <= 99999999),
    price_cents INTEGER NOT NULL CHECK(price_cents BETWEEN 0 AND 9999999900), sort_order INTEGER NOT NULL,
    UNIQUE(stock_qr_id,product_id), UNIQUE(stock_qr_id,sort_order));
    CREATE TABLE IF NOT EXISTS stock_qr_revisions (
    id INTEGER PRIMARY KEY, stock_qr_id INTEGER NOT NULL REFERENCES stock_qr_codes(id), version INTEGER NOT NULL,
    snapshot TEXT NOT NULL, created_by INTEGER, created_by_name TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(stock_qr_id,version));
    CREATE TABLE IF NOT EXISTS stock_qr_usages (
    id INTEGER PRIMARY KEY, stock_qr_id INTEGER NOT NULL REFERENCES stock_qr_codes(id), config_version INTEGER NOT NULL,
    order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id), scan_number INTEGER NOT NULL,
    snapshot TEXT NOT NULL, created_by INTEGER, created_by_name TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(stock_qr_id,scan_number));
    CREATE TABLE IF NOT EXISTS stock_qr_previews (
    id INTEGER PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, stock_qr_id INTEGER NOT NULL REFERENCES stock_qr_codes(id),
    config_version INTEGER NOT NULL, user_id INTEGER NOT NULL, warehouse_id INTEGER NOT NULL,
    snapshot TEXT NOT NULL, expires_at TEXT NOT NULL, order_id INTEGER REFERENCES orders(id), response TEXT);
    CREATE INDEX IF NOT EXISTS stock_qr_warehouse ON stock_qr_codes(warehouse_id);
    CREATE INDEX IF NOT EXISTS stock_qr_product ON stock_qr_items(product_id);
    CREATE INDEX IF NOT EXISTS stock_qr_usage_time ON stock_qr_usages(stock_qr_id,created_at);
    CREATE INDEX IF NOT EXISTS stock_qr_expiry ON stock_qr_previews(expires_at);`);
  // Older QR tables reject quantities below one. SQLite's INTEGER affinity in
  // the other legacy tables already stores decimals without truncating them.
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name='stock_qr_items'").get().sql;
  if (/quantity INTEGER/i.test(schema)) {
    const objects = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='stock_qr_items' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(schema.replace(/CREATE TABLE stock_qr_items/i, 'CREATE TABLE stock_qr_items_decimal')
        .replace(/quantity INTEGER NOT NULL CHECK\(quantity BETWEEN 1 AND 99999999\)/i, 'quantity REAL NOT NULL CHECK(quantity > 0 AND quantity <= 99999999)'));
      db.exec('INSERT INTO stock_qr_items_decimal SELECT * FROM stock_qr_items; DROP TABLE stock_qr_items; ALTER TABLE stock_qr_items_decimal RENAME TO stock_qr_items;');
      for (const object of objects) db.exec(object.sql);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
export function clearStockQr(db) {
  db.exec(
    "DELETE FROM stock_qr_previews; DELETE FROM stock_qr_usages; DELETE FROM stock_qr_revisions; DELETE FROM stock_qr_items; DELETE FROM stock_qr_codes;",
  );
}
function checkConfig(body, used = 0, editing = false) {
  if (
    !text(body.name, 60) ||
    !["in", "out"].includes(body.type) ||
    !text(body.partner, 100) ||
    !text(body.note ?? "", 500, true) ||
    !(body.max_scans === null || integer(body.max_scans ?? 1, 1)) ||
    (body.max_scans != null && body.max_scans < used) ||
    (editing
      ? typeof body.require_confirmation !== "boolean"
      : body.require_confirmation !== undefined &&
        typeof body.require_confirmation !== "boolean") ||
    (body.enabled !== undefined && typeof body.enabled !== "boolean")
  )
    fail(
      "INVALID_CONFIG",
      "请填写有效名称、往来单位和累计次数上限，二次确认及启用状态必须为布尔值。",
      400,
    );
  if (
    !Array.isArray(body.items) ||
    !body.items.length ||
    body.items.length > 100 ||
    new Set(body.items.map((i) => i?.product_id)).size !== body.items.length ||
    body.items.some(
      (i) =>
        !i ||
        !integer(i.product_id, 1) ||
        !validQuantity(i.quantity, true) ||
        !integer(i.price_cents, 0, 9999999900),
    )
  )
    fail(
      "INVALID_ITEMS",
      "请选择 1–100 种不同物料，数量必须为正数且最多 6 位小数，单价不能为负数。",
      400,
    );
  let total = 0;
  for (const i of body.items) {
    const amount = Math.round(i.quantity * (i.price_cents / 100) * 100);
    if (
      !Number.isSafeInteger(amount) ||
      !Number.isSafeInteger((total += amount))
    )
      fail("INVALID_AMOUNT", "物料或单据金额过大。", 400);
  }
  if (Math.round((total / 100) * 100) !== total)
    fail("INVALID_AMOUNT", "单据金额过大，请减少数量。", 400);
}
export function installStockQr(app, db) {
  const source = () =>
    db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get()
      .value;
  const itemsOf = (id) =>
    db
      .prepare(
        "SELECT * FROM stock_qr_items WHERE stock_qr_id=? ORDER BY sort_order",
      )
      .all(id);
  const get = (qrId, warehouse) => {
    if (!uuid(qrId)) fail("INVALID_QR", "二维码标识无效。", 400);
    const q = db
      .prepare("SELECT * FROM stock_qr_codes WHERE qr_id=?")
      .get(qrId);
    if (!q) fail("QR_NOT_FOUND", "二维码不存在或标签已失效。", 404);
    if (q.warehouse_id !== warehouse)
      fail(
        "WAREHOUSE_MISMATCH",
        "二维码属于其他仓库，请切换仓库后重新扫描。",
        400,
      );
    return q;
  };
  const detail = (q) => ({
    ...q,
    require_confirmation: !!q.require_confirmation,
    enabled: !!q.enabled,
    remaining_scans: q.max_scans === null ? null : q.max_scans - q.used_scans,
    warehouse_name: db
      .prepare("SELECT name FROM warehouses WHERE id=?")
      .get(q.warehouse_id).name,
    items: itemsOf(q.id).map((i) => {
      const p = db
        .prepare("SELECT * FROM products WHERE id=?")
        .get(i.product_id);
      return {
        ...i,
        name: p.name,
        barcode: p.barcode,
        unit: p.unit,
        stock: p.stock,
        active: p.active,
        amount_cents: Math.round(i.quantity * (i.price_cents / 100) * 100),
        product_changed:
          p.barcode !== i.product_barcode || p.unit !== i.product_unit,
      };
    }),
  });
  const route =
    (fn, transaction = false, status = 200) =>
    (req, res) => {
      try {
        if (transaction) db.exec("BEGIN IMMEDIATE");
        const value = fn(req);
        if (transaction) db.exec("COMMIT");
        res.status(value?.replayed ? 200 : status).json(value);
      } catch (e) {
        if (transaction && db.isTransaction) db.exec("ROLLBACK");
        res.status(e.status || 400).json({
          error: e.message,
          code: e.code || "INVALID_REQUEST",
          ...(e.details ? { details: e.details } : {}),
        });
      }
    };
  const mutation = (req, fn) => {
    let request;
    try {
      request = operationRequest(db, req);
    } catch (e) {
      if (e.message.includes("操作标识重复"))
        fail("REQUEST_CONFLICT", e.message, 409);
      throw e;
    }
    if (request.previous) return { ...request.previous, replayed: true };
    const result = fn();
    saveOperationRequest(db, request, result);
    return result;
  };
  const revision = (q, req) =>
    db
      .prepare(
        "INSERT INTO stock_qr_revisions(stock_qr_id,version,snapshot,created_by,created_by_name,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        q.id,
        q.version,
        JSON.stringify(detail(q)),
        req.user.id,
        (req.user.name || req.user.username),
        now(),
      );
  const validate = (q) => {
    if (!q.enabled) fail("QR_DISABLED", "该二维码已停用。");
    if (
      (q.max_scans !== null && q.used_scans >= q.max_scans) ||
      q.used_scans >= Number.MAX_SAFE_INTEGER
    )
      fail("SCAN_LIMIT_REACHED", "该二维码可扫描次数已用完。");
    const view = detail(q),
      errors = [];
    for (const i of view.items) {
      if (i.product_changed)
        errors.push({
          product_id: i.product_id,
          name: i.name,
          error: "物料条码或单位已变化，请管理员核对并保存配置。",
        });
      else if (q.type === "out" && i.stock < i.quantity)
        errors.push({
          product_id: i.product_id,
          name: i.name,
          error: `库存不足（当前 ${i.stock} ${i.unit}，需要 ${i.quantity} ${i.unit}）。`,
        });
      else if (q.type === "in" && !validQuantity(addQuantity(i.stock, i.quantity)))
        errors.push({
          product_id: i.product_id,
          name: i.name,
          error: "入库后库存超出上限。",
        });
      const p = db
        .prepare("SELECT warehouse_id FROM products WHERE id=?")
        .get(i.product_id);
      if (p.warehouse_id !== q.warehouse_id)
        fail("WAREHOUSE_MISMATCH", "物料不属于二维码仓库。", 400);
    }
    if (errors.length)
      fail(
        view.items.some((i) => i.product_changed)
          ? "PRODUCT_CHANGED"
          : "STOCK_INSUFFICIENT",
        errors.map((i) => `${i.name}：${i.error}`).join("\n"),
        409,
        errors,
      );
    const c = db.prepare("SELECT * FROM contacts WHERE id=?").get(q.partner_id);
    if (
      !c ||
      !c.active ||
      !contactMatchesDirection(c, q.type)
    )
      fail("PARTNER_CHANGED", "往来单位已停用或类型不匹配，请修改配置。");
    view.partner_name = c.name;
    view.total_cents = view.items.reduce((sum, i) => sum + i.amount_cents, 0);
    if (!Number.isSafeInteger(view.total_cents))
      fail("INVALID_AMOUNT", "单据金额过大。", 400);
    return view;
  };
  app.get(
    "/api/stock-qrs",
    route((req) => {
      const page = Math.max(
        1,
        Math.min(100000, Math.floor(Number(req.query.page) || 1)),
      );
      const size = Math.max(
        1,
        Math.min(100, Math.floor(Number(req.query.page_size) || 20)),
      );
      const where = ["q.warehouse_id=?"],
        values = [req.warehouse.id];
      if (req.query.type) {
        if (!["in", "out"].includes(req.query.type))
          fail("INVALID_FILTER", "操作类型无效。", 400);
        where.push("q.type=?");
        values.push(req.query.type);
      }
      if (req.query.product_id) {
        const productId = Number(req.query.product_id);
        if (!integer(productId, 1))
          fail("INVALID_FILTER", "物料编号无效。", 400);
        where.push(
          "EXISTS (SELECT 1 FROM stock_qr_items i WHERE i.stock_qr_id=q.id AND i.product_id=?)",
        );
        values.push(productId);
      }
      if (req.query.status) {
        const statuses = {
          disabled: "q.enabled=0",
          exhausted:
            "q.enabled=1 AND q.max_scans IS NOT NULL AND q.used_scans>=q.max_scans",
          available:
            "q.enabled=1 AND (q.max_scans IS NULL OR q.used_scans<q.max_scans)",
        };
        if (!Object.hasOwn(statuses, req.query.status))
          fail("INVALID_FILTER", "二维码状态无效。", 400);
        where.push(statuses[req.query.status]);
      }
      const filter = where.join(" AND ");
      const rows = db
        .prepare(
          `SELECT q.* FROM stock_qr_codes q WHERE ${filter} ORDER BY q.id DESC LIMIT ? OFFSET ?`,
        )
        .all(...values, size, (page - 1) * size);
      return {
        rows: rows.map(detail),
        total: db
          .prepare(`SELECT COUNT(*) AS n FROM stock_qr_codes q WHERE ${filter}`)
          .get(...values).n,
      };
    }),
  );
  app.post(
    "/api/stock-qrs",
    route(
      (req) =>
        mutation(req, () => {
          const body = req.body;
          checkConfig(body);
          const contact = resolveContact(
            db,
            body.type,
            body.partner,
            body.partner_id,
          );
          const at = now();
          const id = Number(
            db
              .prepare(
                `INSERT INTO stock_qr_codes(qr_id,warehouse_id,name,type,max_scans,require_confirmation,partner_id,partner_name,note,enabled,created_by,created_by_name,updated_by,updated_by_name,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              )
              .run(
                randomUUID(),
                req.warehouse.id,
                body.name.trim(),
                body.type,
                body.max_scans === undefined ? 1 : body.max_scans,
                body.require_confirmation === false ? 0 : 1,
                contact.id,
                contact.name,
                body.note ?? "",
                body.enabled === false ? 0 : 1,
                req.user.id,
                (req.user.name || req.user.username),
                req.user.id,
                (req.user.name || req.user.username),
                at,
                at,
              ).lastInsertRowid,
          );
          replaceItems(id, body.items, req.warehouse.id);
          const q = db
            .prepare("SELECT * FROM stock_qr_codes WHERE id=?")
            .get(id);
          revision(q, req);
          return detail(q);
        }),
      true,
      201,
    ),
  );
  function replaceItems(id, items, warehouse) {
    db.prepare("DELETE FROM stock_qr_items WHERE stock_qr_id=?").run(id);
    const insert = db.prepare(
      "INSERT INTO stock_qr_items(stock_qr_id,product_id,product_barcode,product_unit,quantity,price_cents,sort_order) VALUES (?,?,?,?,?,?,?)",
    );
    items.forEach((i, n) => {
      const p = db
        .prepare("SELECT * FROM products WHERE id=?")
        .get(i.product_id);
      if (!p || p.warehouse_id !== warehouse)
        fail("WAREHOUSE_MISMATCH", "物料不存在或不属于当前仓库。", 400);
      insert.run(id, p.id, p.barcode, p.unit, i.quantity, i.price_cents, n);
    });
  }
  app.get(
    "/api/stock-qrs/:qr_id",
    route((req) => detail(get(req.params.qr_id, req.warehouse.id))),
  );
  app.put(
    "/api/stock-qrs/:qr_id",
    route(
      (req) =>
        mutation(req, () => {
          const q = get(req.params.qr_id, req.warehouse.id),
            b = req.body;
          if (q.version !== b.version)
            fail("CONFIG_CHANGED", "配置已被修改，请刷新后重试。");
          if (
            q.type !== b.type ||
            (b.warehouse_id !== undefined && b.warehouse_id !== q.warehouse_id)
          )
            fail("INVALID_CONFIG", "创建后不能修改操作类型或仓库。", 400);
          checkConfig(b, q.used_scans, true);
          if (!integer(q.version, 1, Number.MAX_SAFE_INTEGER - 1))
            fail("INVALID_CONFIG", "配置版本超出上限。", 400);
          const c = resolveContact(db, b.type, b.partner, b.partner_id);
          replaceItems(q.id, b.items, q.warehouse_id);
          db.prepare(
            `UPDATE stock_qr_codes SET name=?,max_scans=?,require_confirmation=?,partner_id=?,partner_name=?,note=?,enabled=?,version=version+1,updated_by=?,updated_by_name=?,updated_at=? WHERE id=?`,
          ).run(
            b.name.trim(),
            b.max_scans === undefined ? q.max_scans : b.max_scans,
            b.require_confirmation ? 1 : 0,
            c.id,
            c.name,
            b.note ?? "",
            b.enabled === undefined ? q.enabled : b.enabled ? 1 : 0,
            req.user.id,
            (req.user.name || req.user.username),
            now(),
            q.id,
          );
          const updated = db
            .prepare("SELECT * FROM stock_qr_codes WHERE id=?")
            .get(q.id);
          revision(updated, req);
          return detail(updated);
        }),
      true,
    ),
  );
  for (const [path, table] of [
    ["usages", "stock_qr_usages"],
    ["revisions", "stock_qr_revisions"],
  ]) {
    app.get(
      `/api/stock-qrs/:qr_id/${path}`,
      route((req) => {
        const q = get(req.params.qr_id, req.warehouse.id);
        const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
        const rows = db
          .prepare(
            `SELECT * FROM ${table} WHERE stock_qr_id=? ORDER BY id DESC LIMIT 20 OFFSET ?`,
          )
          .all(q.id, (page - 1) * 20);
        return {
          total: db
            .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE stock_qr_id=?`)
            .get(q.id).n,
          rows: rows.map((r) => ({
            ...r,
            snapshot: JSON.parse(r.snapshot),
            ...(r.order_id
              ? {
                  order: db
                    .prepare(
                      "SELECT id,number,status,void_reason FROM orders WHERE id=?",
                    )
                    .get(r.order_id),
                }
              : {}),
          })),
        };
      }),
    );
  }
  app.post(
    "/api/stock-qrs/preview",
    route((req) => {
      const b = req.body,
        label = b.label;
      if (
        !label ||
        label.format !== "77erp" ||
        label.version !== 1 ||
        label.type !== "stock_operation" ||
        !uuid(label.qr_id)
      )
        fail("INVALID_QR", "出入库二维码格式或版本无效。", 400);
      if (label.source_id !== source())
        fail("SOURCE_MISMATCH", "该二维码来自其他服务器。", 400);
      if (label.warehouse_id !== req.warehouse.id)
        fail(
          "WAREHOUSE_MISMATCH",
          "二维码属于其他仓库，请切换仓库后重新扫描。",
          400,
        );
      const q = get(label.qr_id, req.warehouse.id);
      if (b.mode !== q.type)
        fail(
          "MODE_MISMATCH",
          `这是${q.type === "in" ? "入库" : "出库"}二维码，请切换到对应扫码模式。`,
          400,
        );
      const view = validate(q),
        token = randomBytes(32).toString("hex");
      const expiry = new Date(Date.now() + 300000).toISOString();
      db.prepare(
        "DELETE FROM stock_qr_previews WHERE expires_at < ? AND order_id IS NULL",
      ).run(now());
      db.prepare(
        "INSERT INTO stock_qr_previews(token_hash,stock_qr_id,config_version,user_id,warehouse_id,snapshot,expires_at) VALUES (?,?,?,?,?,?,?)",
      ).run(
        hash(token),
        q.id,
        q.version,
        req.user.id,
        req.warehouse.id,
        JSON.stringify(view),
        expiry,
      );
      return { ...view, preview_token: token, expires_at: expiry };
    }, true),
  );
  app.post(
    "/api/stock-qrs/:qr_id/execute",
    route(
      (req) =>
        mutation(req, () => {
          const q = get(req.params.qr_id, req.warehouse.id),
            b = req.body;
          if (!text(b.preview_token, 128) || typeof b.confirmed !== "boolean")
            fail("INVALID_REQUEST", "缺少有效预览或确认标志。", 400);
          const preview = db
            .prepare("SELECT * FROM stock_qr_previews WHERE token_hash=?")
            .get(hash(b.preview_token));
          if (
            !preview ||
            preview.user_id !== req.user.id ||
            preview.warehouse_id !== req.warehouse.id ||
            preview.stock_qr_id !== q.id
          )
            fail("PREVIEW_EXPIRED", "预览无效或已过期，请重新扫码。");
          if (preview.response)
            return { ...JSON.parse(preview.response), replayed: true };
          if (preview.expires_at <= now())
            fail("PREVIEW_EXPIRED", "预览已过期，请重新扫码。");
          if (q.require_confirmation && b.confirmed !== true)
            fail(
              "CONFIRMATION_REQUIRED",
              "该二维码需要二次确认，请重新预览并确认。",
            );
          if (preview.config_version !== q.version)
            fail("CONFIG_CHANGED", "配置已变化，请重新扫码。");
          const view = validate(q),
            old = JSON.parse(preview.snapshot);
          if (old.partner_name !== view.partner_name)
            fail("PARTNER_CHANGED", "往来单位名称已变化，请重新扫码。");
          const order = createOrder(db, req, {
            type: q.type,
            partner: view.partner_name,
            partner_id: q.partner_id,
            note: q.note,
            items: view.items.map((i) => ({
              product_id: i.product_id,
              quantity: i.quantity,
              price: i.price_cents / 100,
            })),
          });
          if (
            !db
              .prepare(
                "UPDATE stock_qr_codes SET used_scans=used_scans+1 WHERE id=? AND (max_scans IS NULL OR used_scans<max_scans) AND used_scans<9007199254740991",
              )
              .run(q.id).changes
          )
            fail("SCAN_LIMIT_REACHED", "可扫描次数已用完。");
          db.prepare(
            "INSERT INTO stock_qr_usages(stock_qr_id,config_version,order_id,scan_number,snapshot,created_by,created_by_name,created_at) VALUES (?,?,?,?,?,?,?,?)",
          ).run(
            q.id,
            q.version,
            order.id,
            q.used_scans + 1,
            JSON.stringify(view),
            req.user.id,
            (req.user.name || req.user.username),
            now(),
          );
          const result = {
            ...order,
            items: view.items,
            total_cents: view.total_cents,
            used_scans: q.used_scans + 1,
            remaining_scans:
              q.max_scans === null ? null : q.max_scans - q.used_scans - 1,
          };
          db.prepare(
            "UPDATE stock_qr_previews SET order_id=?,response=? WHERE id=?",
          ).run(order.id, JSON.stringify(result), preview.id);
          return result;
        }),
      true,
      201,
    ),
  );
}

export function validateStockQrBackup(data) {
  const bad = () =>
    fail("INVALID_BACKUP", "备份出入库二维码配置、明细或使用记录无效。", 400);
  const codes = new Map(data.stock_qr_codes.map((q) => [q.id, q]));
  const products = new Map(data.products.map((p) => [p.id, p]));
  const contacts = new Map(data.contacts.map((c) => [c.id, c]));
  const orders = new Map(data.orders.map((o) => [o.id, o]));
  const warehouses = new Set(data.warehouses.map((w) => w.id));
  const ids = new Set(),
    itemKeys = new Set(),
    positions = new Set(),
    counts = new Map(),
    amounts = new Map();
  const actor = (row, prefix) =>
    (row[prefix] === null || integer(row[prefix], 1)) &&
    text(row[`${prefix}_name`], 60, true);
  for (const q of codes.values()) {
    if (
      !uuid(q.qr_id) ||
      ids.has(q.qr_id) ||
      !warehouses.has(q.warehouse_id) ||
      !text(q.name, 60) ||
      !["in", "out"].includes(q.type) ||
      !(q.max_scans === null || integer(q.max_scans, 1)) ||
      !integer(q.used_scans, 0, Number.MAX_SAFE_INTEGER) ||
      (q.max_scans !== null && q.used_scans > q.max_scans) ||
      ![0, 1].includes(q.enabled) ||
      ![0, 1].includes(q.require_confirmation) ||
      !integer(q.version, 1, Number.MAX_SAFE_INTEGER) ||
      !contacts.has(q.partner_id) ||
      !contactMatchesDirection(contacts.get(q.partner_id), q.type) ||
      !text(q.partner_name, 100) ||
      !text(q.note, 500, true) ||
      !actor(q, "created_by") ||
      !actor(q, "updated_by") ||
      !text(q.created_at, 100) ||
      !text(q.updated_at, 100)
    )
      bad();
    ids.add(q.qr_id);
  }
  for (const i of data.stock_qr_items) {
    const q = codes.get(i.stock_qr_id),
      p = products.get(i.product_id),
      key = `${i.stock_qr_id}:${i.product_id}`,
      pos = `${i.stock_qr_id}:${i.sort_order}`;
    if (
      !q ||
      !p ||
      p.warehouse_id !== q.warehouse_id ||
      itemKeys.has(key) ||
      positions.has(pos) ||
      !text(i.product_barcode, 64) ||
      !text(i.product_unit, 100) ||
      !validQuantity(i.quantity, true) ||
      !integer(i.price_cents, 0, 9999999900) ||
      !integer(i.sort_order, 0, 99)
    )
      bad();
    itemKeys.add(key);
    positions.add(pos);
    counts.set(q.id, (counts.get(q.id) || 0) + 1);
    const total = (amounts.get(q.id) || 0) + Math.round(i.quantity * (i.price_cents / 100) * 100);
    if (
      !Number.isSafeInteger(Math.round(i.quantity * (i.price_cents / 100) * 100)) ||
      !Number.isSafeInteger(total)
    )
      bad();
    amounts.set(q.id, total);
  }
  for (const q of codes.values()) if (!integer(counts.get(q.id), 1, 100)) bad();
  const snapshots = (row) => {
    let s;
    try {
      s = JSON.parse(row.snapshot);
    } catch {
      bad();
    }
    const q = codes.get(row.stock_qr_id);
    if (
      !s ||
      s.id !== q.id ||
      s.warehouse_id !== q.warehouse_id ||
      s.type !== q.type ||
      !Array.isArray(s.items) ||
      !integer(s.items.length, 1, 100) ||
      new Set(s.items.map((i) => i?.product_id)).size !== s.items.length ||
      s.items.some(
        (i) =>
          !i ||
          !integer(i.product_id, 1) ||
          !validQuantity(i.quantity, true) ||
          !integer(i.price_cents, 0, 9999999900) ||
          !text(i.name, 100) ||
          !text(i.product_barcode, 64) ||
          !text(i.product_unit, 100),
      )
    )
      bad();
    return s;
  };
  const revisionKeys = new Set();
  for (const r of data.stock_qr_revisions) {
    const q = codes.get(r.stock_qr_id),
      key = `${r.stock_qr_id}:${r.version}`;
    if (
      !q ||
      !integer(r.version, 1, q.version) ||
      revisionKeys.has(key) ||
      !actor(r, "created_by") ||
      !text(r.created_at, 100)
    )
      bad();
    if (snapshots(r).version !== r.version) bad();
    revisionKeys.add(key);
  }
  const orderItems = new Map();
  for (const item of data.order_items) {
    const rows = orderItems.get(item.order_id) || [];
    rows.push(item);
    orderItems.set(item.order_id, rows);
  }
  const usageKeys = new Set(),
    orderIds = new Set(),
    used = new Map();
  for (const u of data.stock_qr_usages) {
    const q = codes.get(u.stock_qr_id),
      o = orders.get(u.order_id),
      key = `${u.stock_qr_id}:${u.scan_number}`;
    if (
      !q ||
      !o ||
      o.warehouse_id !== q.warehouse_id ||
      o.type !== q.type ||
      !["normal", "internal"].includes(o.kind) ||
      orderIds.has(o.id) ||
      usageKeys.has(key) ||
      !integer(u.scan_number, 1, q.used_scans) ||
      !revisionKeys.has(`${q.id}:${u.config_version}`) ||
      !actor(u, "created_by") ||
      !text(u.created_at, 100)
    )
      bad();
    const s = snapshots(u),
      items = orderItems.get(o.id) || [];
    if (
      s.version !== u.config_version ||
      items.length !== s.items.length ||
      s.items.some(
        (i) =>
          !items.some(
            (j) =>
              j.product_id === i.product_id &&
              j.quantity === i.quantity &&
              Math.round(j.price * 100) === i.price_cents,
          ),
      )
    )
      bad();
    usageKeys.add(key);
    orderIds.add(o.id);
    used.set(q.id, (used.get(q.id) || 0) + 1);
  }
  for (const q of codes.values())
    if (
      (used.get(q.id) || 0) !== q.used_scans ||
      !revisionKeys.has(`${q.id}:${q.version}`)
    )
      bad();
}
