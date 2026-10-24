import { customerPartNumbersValue, validateCustomerPartNumbers } from './customer-part-numbers.js';
import { orderLineAmount, validUnitPrice } from "../shared/money.js";
import { validQuantity, addQuantity, materialQuantity, validStoredQuantity } from '../shared/quantity.js';
import { stockQrTables, clearStockQr, validateStockQrBackup } from './stock-qr.js';
import { installCommerce, moveInventory, allocate } from "./commerce.js";
import { createHash, randomUUID } from "node:crypto";
import { categoryPaths, productDetails, splitLegacyCategories } from "./catalog.js";
import { notificationMutation } from './notifications.js';
import { installTransfers } from './transfers.js';
import { validInspectionDate } from '../shared/inspection.js';
import { qualityTables, clearQuality, validateQualityBackup } from './quality.js';
import { bomTables, clearBom, validateBomBackup } from './bom.js';
import { productionTables, productionBatchTables, clearProduction, validateProductionBackup } from './production.js';
import { validateProductionReceiptBackup } from './production-receipts.js';
import { validateProductionMaterialBackup } from './production-materials.js';
import { productionStageTables, validateProductionStageBackup } from './production-stages.js';

const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const integer = (value) =>
  Number.isSafeInteger(value) && value >= 0 && value <= 99999999;
const text = (value, max = 500) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const fail = (message) => {
  throw new Error(message);
};
const reasonOf = (body) =>
  text(body.reason)
    ? body.reason.trim()
    : fail("请填写操作原因（最多 500 字）。");

// Both regular orders and corrections use user-scoped request identifiers.
export function operationRequest(db, req, optional = false) {
  const raw = req.body.request_id;
  if (raw === undefined && optional) return null; // Older clients remain compatible.
  if (!text(raw, 100)) fail("缺少操作标识，请重新打开页面。");
  const id = hash([req.user.id, raw]);
  const fingerprint = hash([req.user.id, req.warehouse.id, req.method, req.path, req.body]);
  const previous = db.prepare('SELECT * FROM operation_requests WHERE id=?').get(id);
  if (previous && previous.fingerprint !== fingerprint) fail('操作标识重复，请刷新后重试。');
  return { id, fingerprint, previous: previous ? JSON.parse(previous.response) : null };
}
export function saveOperationRequest(db, request, result) {
  if (request) db.prepare('INSERT INTO operation_requests VALUES (?,?,?)')
    .run(request.id, request.fingerprint, JSON.stringify(result));
}

export function migrateOperations(db) {
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(orders)")
      .all()
      .map((c) => c.name),
  );
  for (const [name, definition] of Object.entries({
    kind: "TEXT NOT NULL DEFAULT 'normal'",
    status: "TEXT NOT NULL DEFAULT 'active'",
    source_order_id: "INTEGER REFERENCES orders(id)",
    stock_applied: "INTEGER NOT NULL DEFAULT 1",
    void_reason: "TEXT NOT NULL DEFAULT ''",
    voided_at: "TEXT",
  }))
    if (!columns.has(name))
      db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${definition}`);
  if (!columns.has("stock_applied"))
    db.exec(
      "UPDATE orders SET stock_applied=0 WHERE note='演示单据（期初库存已结转）'",
    );
  db.exec(`CREATE TABLE IF NOT EXISTS stock_adjustments (
    id INTEGER PRIMARY KEY, batch TEXT NOT NULL, product_id INTEGER NOT NULL REFERENCES products(id),
    name TEXT NOT NULL, before_stock REAL NOT NULL, after_stock REAL NOT NULL,
    reason TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS operation_requests (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response TEXT NOT NULL);
  `);
}

export function installOperations(app, db, { productValues, generateBarcode, catalogValues }) {
  const transaction = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      db.exec("COMMIT");
      return value;
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  };
  const route = (fn) => (req, res) => {
    try {
      res.json(fn(req));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };
  const mutation = (req, fn) =>
    transaction(() => {
      const request = operationRequest(db, req);
      if (request.previous) return request.previous;
      const result = notificationMutation(db, req, fn);
      saveOperationRequest(db, request, result);
      return result;
    });
  const product = (id) =>
    db.prepare("SELECT * FROM products WHERE id=?").get(id) ||
    fail("物料不存在，请刷新。");
  const changeStock = (id, delta, cost) => moveInventory(db, id, delta, cost);
  installCommerce(app, db, { route, mutation });
  const { createTransfer } = installTransfers(app, db, { route, mutation });
  const originalOrder = (id) => {
    const order = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
    if (!order || order.status !== "active") fail("单据不存在或已作废。");
    // Both legs of a warehouse transfer are corrected together, never one side.
    if (order.kind === "transfer") fail("仓库调拨请在「业务管理 → 仓库调拨」中撤销。");
    if (!order.stock_applied)
      fail("期初已结转的演示单据不能作废或退货，请使用数据重置清理。");
    return order;
  };
  const orderItems = (id) =>
    db.prepare("SELECT * FROM order_items WHERE order_id=?").all(id);
  app.post(
    "/api/orders/:id/void",
    route((req) =>
      mutation(req, () => {
        const reason = reasonOf(req.body),
          order = originalOrder(req.params.id);
        if (
          db
            .prepare(
              "SELECT 1 FROM orders WHERE source_order_id=? AND status='active'",
            )
            .get(order.id)
        )
          fail("此单据已有退货，请先作废关联退货单。");
        if (db.prepare("SELECT 1 FROM payments WHERE order_id=? AND reversed_at IS NULL").get(order.id)) fail("请先撤销此单据的收付款记录，再作废单据。");
        for (const item of orderItems(order.id))
          changeStock(
            item.product_id,
            (order.type === "in" ? -1 : 1) * item.quantity,
            item.cost_cents,
          );
        db.prepare(
          "UPDATE orders SET status='void',void_reason=?,voided_at=? WHERE id=?",
        ).run(reason, new Date().toISOString(), order.id);
        return { ok: true };
      }),
    ),
  );
  app.post(
    "/api/orders/:id/returns",
    route((req) =>
      mutation(req, () => {
        const reason = reasonOf(req.body),
          source = originalOrder(req.params.id);
        if (source.kind !== "normal") fail("此单据不支持采购或销售退货，请作废或另开出入库单。");
        const selected = req.body.items;
        if (
          !Array.isArray(selected) ||
          !selected.length ||
          selected.length > 100
        )
          fail("请选择退货物料。");
        const originals = orderItems(source.id),
          seen = new Set();
        const items = selected.map((item) => {
          if (
            !integer(item.product_id) ||
            !validQuantity(item.quantity, true) ||
            !item.quantity ||
            seen.has(item.product_id)
          )
            fail("退货数量需为正数且最多 4 位小数，物料不能重复。");
          seen.add(item.product_id);
          const original = originals.find(
            (i) => i.product_id === item.product_id,
          );
          if (!original) fail("退货物料不在原单中。");
          item.quantity = materialQuantity(item.quantity, product(item.product_id));
          const returned = db
            .prepare(
              `SELECT COALESCE(SUM(i.quantity),0) AS quantity FROM order_items i JOIN orders o ON o.id=i.order_id
        WHERE o.source_order_id=? AND o.status='active' AND i.product_id=?`,
            )
            .get(source.id, item.product_id).quantity;
          if (item.quantity > addQuantity(original.quantity, -returned))
            fail(
              `${original.name} 退货数量超过可退数量 ${addQuantity(original.quantity, -returned)}。`,
            );
          let cost = null;
          if (source.type === "out" && original.cost_cents != null) {
            const prior = db.prepare("SELECT COALESCE(SUM(i.cost_cents),0) AS n FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.source_order_id=? AND o.status='active' AND i.product_id=?").get(source.id,item.product_id).n;
            cost = allocate(original.cost_cents - prior, item.quantity, addQuantity(original.quantity, -returned));
          }
          const priorAmount = db.prepare(`SELECT i.* FROM order_items i JOIN orders o ON o.id=i.order_id
            WHERE o.source_order_id=? AND o.status='active' AND i.product_id=?`).all(source.id, item.product_id)
            .reduce((sum, line) => sum + orderLineAmount(line), 0);
          const remainingAmount = orderLineAmount(original) - priorAmount;
          if (remainingAmount < 0) fail('历史退货金额已超过原单，请先核对并作废错误退货单。');
          const amount = allocate(remainingAmount, item.quantity, addQuantity(original.quantity, -returned));
          return { ...original, quantity: item.quantity, return_cost: cost, amount_cents: amount };
        });
        const type = source.type === "in" ? "out" : "in",
          at = new Date().toISOString();
        const number = `TH${at.slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8)}`;
        const total = items.reduce(
          (sum, i) => sum + i.amount_cents,
          0,
        );
        if (!Number.isSafeInteger(total)) fail("退货金额过大。");
        const result = db
          .prepare(
            "INSERT INTO orders(number,type,partner,note,total,created_at,kind,source_order_id,partner_id,settlement_tracked,warehouse_id,created_by,created_by_name) VALUES (?,?,?,?,?,?,'return',?,?,1,?,?,?)",
          )
          .run(
            number,
            type,
            source.partner,
            reason,
            total / 100,
            at,
            source.id,
            source.partner_id,
            source.warehouse_id,
            req.user.id, (req.user.name || req.user.username),
          );
        for (const i of items) {
          const movedCost = changeStock(i.product_id, (type === "in" ? 1 : -1) * i.quantity, i.return_cost);
          db.prepare(
            "INSERT INTO order_items(order_id,product_id,name,barcode,quantity,price,cost_cents,amount_cents) VALUES (?,?,?,?,?,?,?,?)",
          ).run(
            result.lastInsertRowid,
            i.product_id,
            i.name,
            i.barcode,
            i.quantity,
            i.price,
            source.type === "out" ? i.return_cost : movedCost,
            i.amount_cents,
          );
        }
        return { id: Number(result.lastInsertRowid), number };
      }),
    ),
  );
  const adjustment = (batch, p, next, reason, kind) =>
    db
      .prepare(
        `INSERT INTO stock_adjustments
    (batch,product_id,name,before_stock,after_stock,reason,kind,created_at) VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        batch,
        p.id,
        p.name,
        p.stock,
        next,
        reason,
        kind,
        new Date().toISOString(),
      );
  app.get(
    "/api/stocktakes",
    route((req) =>
      db
        .prepare("SELECT a.* FROM stock_adjustments a JOIN products p ON p.id=a.product_id WHERE p.warehouse_id=? ORDER BY a.id DESC LIMIT 1000")
        .all(req.warehouse.id),
    ),
  );
  // Caller owns transaction and notification handling.
  function createStocktake(req) {
    const reason = reasonOf(req.body),
      items = req.body.items,
      seen = new Set(),
      batch = randomUUID();
    if (!Array.isArray(items) || !items.length || items.length > 1000)
      fail("每次盘点请选择 1–1000 种物料。");
    for (const item of items) {
      if (
        !integer(item.product_id) ||
        !validQuantity(item.counted) ||
        !validStoredQuantity(item.expected_stock) ||
        seen.has(item.product_id)
      )
        fail("实盘数量需为非负数且最多 4 位小数，物料不能重复。");
      seen.add(item.product_id);
      const p = product(item.product_id);
      if (p.warehouse_id !== req.warehouse.id) fail("物料不属于当前仓库。");
      if (p.stock !== item.expected_stock)
        fail(`${p.name} 库存已变化，请刷新后重新盘点。`);
      item.counted = materialQuantity(item.counted, p);
      adjustment(batch, p, item.counted, reason, "stocktake");
      changeStock(p.id, addQuantity(item.counted, -p.stock));
    }
    return { ok: true, batch };
  }
  app.post("/api/stocktakes", route(req => mutation(req, () => createStocktake(req))));

  app.post(
    "/api/stock/reduce",
    route((req) =>
      mutation(req, () => {
        const reason = reasonOf(req.body),
          { product_id, quantity: requestedQuantity, expected_stock } = req.body;
        let quantity = requestedQuantity;
        if (!integer(product_id) || !validQuantity(quantity, true))
          fail("请填写有效的物料和减少数量（正数，最多 4 位小数）。");
        const p = product(product_id);
        quantity = materialQuantity(quantity, p);
        if (p.warehouse_id !== req.warehouse.id)
          fail("物料不属于当前仓库。");
        if (expected_stock !== undefined && p.stock !== expected_stock)
          fail(`${p.name} 库存已变化，请刷新后重试。`);
        if (quantity > p.stock)
          fail(`减少数量不能超过现有库存 ${p.stock}。`);
        if (quantity === 0) fail("减少数量需大于 0。");
        const next = addQuantity(p.stock, -quantity);
        adjustment(randomUUID(), p, next, reason, "reduce");
        changeStock(p.id, -quantity);
        return { ok: true, stock: next };
      }),
    ),
  );

  app.post(
    "/api/stock/increase",
    route(req => mutation(req, () => {
      const reason = reasonOf(req.body);
      const { product_id, quantity: requestedQuantity, expected_stock } = req.body;
      let quantity = requestedQuantity;
      if (!integer(product_id) || !validQuantity(quantity, true) || !validStoredQuantity(expected_stock))
        fail("请填写有效的物料、增加数量（正数，最多 4 位小数）及当前库存。");
      const p = product(product_id);
      quantity = materialQuantity(quantity, p);
      if (p.warehouse_id !== req.warehouse.id) fail("物料不属于当前仓库。");
      if (p.stock !== expected_stock) fail(`${p.name} 库存已变化，请刷新后重试。`);
      const next = addQuantity(p.stock, quantity);
      if (!validStoredQuantity(next)) fail("增加后库存超出上限。");
      adjustment(randomUUID(), p, next, reason, "increase");
      changeStock(p.id, quantity);
      return { ok: true, stock: next };
    })),
  );

  function validateRows(rows, warehouseId) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 1000)
      fail("每次导入 1–1000 行物料。");
    const seen = new Set(),
      errors = [],
      normalized = [];
    rows.forEach((row, index) => {
      try {
        const values = productValues(row);
        if (!validQuantity(row.stock)) fail("期初库存需为非负数且最多 4 位小数。");
        if (
          values[1] &&
          (seen.has(values[1]) ||
            db.prepare("SELECT 1 FROM products WHERE barcode=? AND warehouse_id=?").get(values[1], warehouseId))
        )
          fail("条码重复或已存在，不会覆盖已有物料。");
        if (values[1]) seen.add(values[1]);
        const details = productDetails(row);
        values[6] = materialQuantity(values[6], details);
        customerPartNumbersValue(db, row);
        if (row.category_id != null && row.category_id !== '' && (!Number.isSafeInteger(row.category_id) || !db.prepare("SELECT 1 FROM categories WHERE id=? AND warehouse_id=?").get(row.category_id, warehouseId))) fail("分类不存在或不属于当前仓库。");
        normalized.push({ values, stock: materialQuantity(row.stock, details), index });
      } catch (error) {
        errors.push({ row: index + 2, error: error.message });
      }
    });
    return { normalized, errors };
  }
  // Shared by HTTP import and AI confirmation; the caller owns the transaction.
  function importProducts(req, { includeBatch = false } = {}) {
    if (req.body.token !== hash(req.body.rows))
      fail("导入内容已变化，请重新预览。");
    const { normalized, errors } = validateRows(req.body.rows, req.warehouse.id);
    if (errors.length) fail(`第 ${errors[0].row} 行：${errors[0].error}`);
    const batch = randomUUID();
    // Reserve explicit barcodes before generating codes for blank cells.
    for (const row of [
      ...normalized.filter((r) => r.values[1]),
      ...normalized.filter((r) => !r.values[1]),
    ]) {
      const values = [...row.values];
      const catalog = catalogValues(req.body.rows[row.index], undefined, req.warehouse.id);
      values[2] = catalog.path;
      if (!values[1]) values[1] = generateBarcode(req.warehouse.id);
      const result = db
        .prepare(
          "INSERT INTO products(name,barcode,category,unit,cost,price,threshold,category_id,image,specification,note,is_fixed_asset,unit_round_up,inspection_date,inspection_interval,inspection_unit,customer_part_numbers,production_type,created_at,warehouse_id,sync_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(...values, ...catalog.values, new Date().toISOString(), req.warehouse.id, randomUUID());
      const p = product(Number(result.lastInsertRowid));
      adjustment(batch, p, row.stock, "批量导入期初库存", "opening");
      changeStock(p.id, row.stock, Math.round(p.cost * row.stock * 100));
    }
    return { ok: true, count: normalized.length, ...(includeBatch ? { batch } : {}) };
  }

  app.post(
    "/api/products/import/preview",
    route((req) => {
      const result = validateRows(req.body.rows, req.warehouse.id);
      return {
        count: req.body.rows.length,
        errors: result.errors,
        token: hash(req.body.rows),
      };
    }),
  );
  app.post(
    "/api/products/import",
    route((req) =>
      mutation(req, () => importProducts(req)),
    ),
  );

  const tables = ["warehouses", "categories", "contacts", "products", "orders", "order_items", "stock_adjustments", "product_changes", "templates", "payments", ...stockQrTables, ...qualityTables, ...bomTables, ...productionTables];
  const columns = Object.fromEntries(
    tables.map((table) => [
      table,
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((c) => c.name),
    ]),
  );
  const snapshot = () =>
    Object.fromEntries(
      tables.map((table) => [
        table,
        db.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
      ]),
    );
  const backup = () => ({
    format: "77erp-business",
    version: 38,
    source_instance_id: db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value,
    created_at: new Date().toISOString(),
    data: snapshot(),
  });
  function validateBackup(value) {
    const validQuantity = validStoredQuantity;
    if (
      value?.format !== "77erp-business" ||
      ![1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38].includes(value.version) ||
      !value.data
    )
      fail("不是支持的 77 ERP 业务备份文件。");
    const data = structuredClone(value.data);
    if (value.version < 38) {
      for (const table of productionStageTables) data[table] = [];
      for (const order of data.production_orders || []) order.stage_workflow = 0;
    }
    if (value.version < 37) {
      for (const row of data.production_orders || []) { row.production_group_id = null; row.production_group_name = ''; }
      for (const row of data.production_batches || []) {
        row.production_group_id = null; row.production_group_name = ''; row.created_by = null;
      }
    }
    const validAssociation = id => id === null || (Number.isSafeInteger(id) && id > 0);
    for (const row of [...(data.production_orders || []), ...(data.production_batches || []), ...(data.production_stage_batches || [])]) {
      if (!validAssociation(row.production_group_id) || typeof row.production_group_name !== 'string' || row.production_group_name.length > 60)
        fail('备份生产班组无效。');
    }
    for (const row of [...(data.production_batches || []), ...(data.production_stage_batches || [])]) {
      if (!validAssociation(row.created_by) || typeof row.created_by_name !== 'string' || row.created_by_name.length > 60)
        fail('备份生产登记人无效。');
    }
    if (value.version < 36) for (const row of data.products || []) row.production_type = '';
    if (value.version < 35) {
      data.production_receipts = []; data.production_receipt_items = [];
      for (const row of data.production_batches || []) row.receipt_required = 0;
    }
    if (value.version < 34) {
      data.production_material_documents = []; data.production_material_document_items = [];
      for (const row of data.production_orders || []) { row.material_workflow = 0; row.material_phase = 'draft'; }
    }
    if (value.version < 33) for (const row of data.production_orders || []) row.quantity_decimals = 6;
    if (value.version < 33) for (const table of ['products', 'production_items', 'production_orders', 'production_bom_nodes', 'production_scraps'])
      for (const row of data[table] || []) row.unit_round_up = 0;
    if (value.version < 32) {
      data.production_bom_nodes = [];
      for (const row of data.bom_items || []) { row.usage_mode = 'stock'; row.child_bom_id = null; }
      for (const row of data.production_orders || []) row.snapshot_format = 1;
    }
    if (value.version < 31) for (const table of ['boms', 'production_orders'])
      for (const row of data[table] || []) row.loss_method = 'internal';
    if (value.version < 30) {
      for (const item of data.stock_qr_items || []) {
        if (item && item.price_e4 == null && item.price_cents != null) {
          item.price_e4 = item.price_cents * 100;
          delete item.price_cents;
        }
      }
      for (const table of ['stock_qr_revisions', 'stock_qr_usages', 'stock_qr_previews']) {
        for (const row of data[table] || []) {
          try {
            const snapshot = JSON.parse(row.snapshot);
            if (!Array.isArray(snapshot.items)) continue;
            for (const item of snapshot.items) {
              if (item && item.price_e4 == null && item.price_cents != null) {
                item.price_e4 = item.price_cents * 100;
                delete item.price_cents;
              }
            }
            row.snapshot = JSON.stringify(snapshot);
          } catch {}
        }
      }
    }
    if (value.version < 29) {
      for (const table of productionBatchTables) data[table] = [];
      for (const row of data.production_orders || []) row.batch_tracking = 0;
    }
    if (value.version < 28) for (const table of ['bom_items', 'production_items'])
      for (const row of data[table] || []) row.loss_rate = 0;
    if (value.version < 27) for (const row of data.production_items || []) row.variance_reason = '';
    if (value.version < 26) { data.bom_scraps = []; data.production_scraps = []; }
    if (value.version < 24) for (const table of productionTables) data[table] = [];
    if (value.version < 23) for (const table of bomTables) data[table] = [];
    if (value.version < 25) {
      for (const row of data.bom_items || []) row.quantity_fraction = '';
      for (const row of data.production_items || []) row.base_quantity_fraction = '';
    }
    if (value.version < 17) for (const table of qualityTables) data[table] = [];
    if (value.version < 18) data.quality_acceptances = [];
    if (value.version < 21) data.quality_charts = [];
    if (value.version < 22) for (const row of data.quality_acceptances || []) row.checks_acknowledged = 0;
    if (value.version < 20) for (const row of data.quality_acceptances || []) row.bindings = '[]';
    if (value.version < 16) for (const p of data.products || []) p.customer_part_numbers ??= '[]';
    if (value.version < 15) for (const p of data.products || []) {
      p.inspection_date = ''; p.inspection_interval = 0; p.inspection_unit = 'month'; p.last_inspected_on = '';
    }
    if (value.version < 13) data.product_changes = [];
    if (value.version < 11) for (const item of data.order_items || []) {
      if (item && !('amount_cents' in item)) item.amount_cents = null;
    }
    if (value.version < 12) {
      // Transfers arrive with version 12, so older backups never carry them.
      const transferIds = new Set((data.orders || []).filter((o) => o.kind === 'transfer').map((o) => o.id));
      data.orders = (data.orders || []).filter((o) => o.kind !== 'transfer');
      if (data.order_items) data.order_items = data.order_items.filter((i) => !transferIds.has(i.order_id));
      for (const o of data.orders) { o.transfer_id = ''; o.transfer_warehouse_id = null; }
    }
    if (value.version < 9) data.templates = [];
    if (value.version < 7) for (const table of stockQrTables) data[table] = [];
    if (value.version === 1) {
      data.contacts = []; data.templates = []; data.payments = [];
      for (const p of data.products || []) p.inventory_value_cents = Math.round(p.stock*p.cost*100);
      for (const o of data.orders || []) { o.partner_id = null; o.settlement_tracked = 0; }
      for (const i of data.order_items || []) i.cost_cents = null;
    }
    if (value.version < 3) {
      data.categories = [];
      const names = new Map();
      for (const p of data.products || []) {
        if (!names.has(p.category)) {
          const id = names.size + 1;
          names.set(p.category, id);
          data.categories.push({ id, name: p.category, parent_id: null });
        }
        p.category_id = names.get(p.category);
        p.image = ''; p.specification = ''; p.note = '';
      }
    }
    if (value.version < 4) {
      data.warehouses = db.prepare('SELECT * FROM warehouses ORDER BY id').all();
      for (const p of data.products || []) { p.warehouse_id ??= 1; p.sync_key ??= `legacy-${p.id}`; }
      for (const table of ['orders', 'templates']) for (const row of data[table] || []) row.warehouse_id ??= 1;
    }
    if (value.version < 5) {
      for (const table of ['orders','templates']) for (const row of data[table] || []) {
        row.created_by = null; row.created_by_name = '';
      }
    }
    for (const table of ['orders','templates']) for (const row of data[table] || []) {
      if (!(row.created_by === null || (Number.isSafeInteger(row.created_by) && row.created_by > 0)) ||
          typeof row.created_by_name !== 'string' || row.created_by_name.length > 60)
        fail('备份操作人信息无效。');
    }
    // Backups made before product lifecycle support default to listed products.
    for (const p of data.products || []) if (p && !('active' in p)) p.active = 1;
    if (value.version < 8) for (const p of data.products || []) if (p && !('version' in p)) p.version = 1;
    for (const table of tables) {
      if (!Array.isArray(data[table]) || data[table].length > 100000)
        fail(`备份中的 ${table} 格式或数量无效。`);
      const ids = new Set();
      const fields = table === 'categories' && value.version < 10 ? columns[table].filter(c => c !== 'warehouse_id') : columns[table];
      for (const row of data[table]) {
        if (
          !row ||
          !integer(row.id) ||
          row.id < 1 ||
          ids.has(row.id) ||
          Object.keys(row).length !== fields.length ||
          fields.some((c) => !(c in row))
        )
          fail(`备份中的 ${table} 字段或编号无效。`);
        ids.add(row.id);
      }
    }
    const warehouseIds = new Set(data.warehouses.map(w => w.id));
    if (!warehouseIds.has(1) || new Set(data.warehouses.map(w => w.name)).size !== data.warehouses.length || data.warehouses.some(w => !text(w.name,60) || w.name !== w.name.trim() || !text(w.created_at,100))) fail('备份仓库信息无效。');
    for (const table of ['products', 'orders', 'templates']) if (data[table].some(row => !warehouseIds.has(row.warehouse_id))) fail('备份仓库关联无效。');
    if (value.version < 10) {
      if (data.categories.length * data.warehouses.length > 100000) fail('备份分类迁移后的数量过多。');
      const migrated = splitLegacyCategories(data.categories, data.warehouses, data.products);
      if (migrated.categories.some(c => !integer(c.id))) fail('备份分类迁移后的编号无效。');
      data.categories = migrated.categories;
      data.products = migrated.products;
    }
    if (data.categories.some(c => !warehouseIds.has(c.warehouse_id))) fail('备份分类仓库关联无效。');
    const syncKeys = new Set();
    for (const p of data.products) {
      const key = JSON.stringify([p.warehouse_id,p.sync_key]);
      if (!text(p.sync_key,100) || syncKeys.has(key)) fail('备份物料同步关联无效。');
      syncKeys.add(key);
    }
    const categoryMap = categoryPaths(data.categories);
    const categoryOwners = new Map(data.categories.map(c => [c.id, c.warehouse_id]));
    const contacts = new Map(data.contacts.map(c => [c.id,c]));
    for (const c of data.contacts) if (!['supplier','customer','internal'].includes(c.role) || !text(c.name,100) || ![0,1].includes(c.active) || !Number.isSafeInteger(c.version) || c.version < 1 || ['person','phone','address','note'].some(k => typeof c[k] !== 'string' || c[k].length > ({person:100,phone:50,address:300,note:500})[k])) fail('备份往来单位无效。');
    const contactKeys = new Set(data.contacts.map(c => `${c.role}:${c.name}`));
    if (contactKeys.size !== data.contacts.length) fail('备份往来单位重复。');
    const products = new Map(data.products.map((p) => [p.id, p])),
      orders = new Map(data.orders.map((o) => [o.id, o]));
    const barcodes = new Set();
    for (const p of data.products) {
      productValues(p, true);
      if (typeof p.production_type !== 'string') fail('备份物料生产类型无效。');
      productDetails(p);
      if (typeof p.customer_part_numbers !== 'string') fail('备份客户料号格式无效。');
      const parts = JSON.parse(p.customer_part_numbers);
      const normalizedParts = validateCustomerPartNumbers(parts, contacts, parts);
      if (JSON.stringify(parts) !== JSON.stringify(normalizedParts)) fail('备份客户料号格式无效。');
      if (p.last_inspected_on !== '' && !validInspectionDate(p.last_inspected_on)) fail('备份上次校验日期无效。');
      if (!Number.isSafeInteger(p.version) || p.version < 1) fail('备份物料版本无效。');
      if (![0,1].includes(p.unit_round_up)) fail('备份物料取整属性无效。');
      if (![0,1].includes(p.active)) fail("备份物料使用状态无效。");
      if (!categoryMap.has(p.category_id) || categoryMap.get(p.category_id) !== p.category || categoryOwners.get(p.category_id) !== p.warehouse_id) fail("备份物料分类关联无效。");
      if (
        !p.barcode ||
        barcodes.has(JSON.stringify([p.warehouse_id,p.barcode])) ||
        !validQuantity(p.stock) ||
        !Number.isSafeInteger(p.inventory_value_cents) || p.inventory_value_cents < 0 || (!p.stock && p.inventory_value_cents !== 0) ||
        !text(p.color, 30) ||
        !text(p.created_at, 100)
      )
        fail("备份物料库存或条码无效。");
      barcodes.add(JSON.stringify([p.warehouse_id,p.barcode]));
    }
    const numbers = new Set();
    for (const o of data.orders) {
      if (
        !text(o.number, 100) ||
        numbers.has(o.number) ||
        !["in", "out"].includes(o.type) ||
        !["normal", "return", "transfer", "internal"].includes(o.kind) ||
        !["active", "void"].includes(o.status) ||
        !text(o.partner, 100) ||
        typeof o.note !== "string" ||
        o.note.length > 500 ||
        !Number.isFinite(o.total) ||
        o.total < 0 ||
        !Number.isSafeInteger(Math.round(o.total * 100)) ||
        !text(o.created_at, 100) ||
        ![0, 1].includes(o.stock_applied) ||
        ![0,1].includes(o.settlement_tracked) || (o.partner_id !== null && !contacts.has(o.partner_id)) ||
        typeof o.void_reason !== "string" ||
        o.void_reason.length > 500 ||
        !(o.voided_at === null || text(o.voided_at, 100))
      )
        fail("备份单据内容无效。");
      if ((o.kind === 'internal') !== (contacts.get(o.partner_id)?.role === 'internal') ||
          (o.kind === 'internal' && o.settlement_tracked !== 0)) fail('备份内部流转类型或收付款设置无效。');
      numbers.add(o.number);
      if (o.kind === "transfer") {
        if (o.source_order_id !== null || o.settlement_tracked !== 0 || Math.round(o.total * 100) !== 0 ||
            !text(o.transfer_id, 100) || !warehouseIds.has(o.transfer_warehouse_id) ||
            o.transfer_warehouse_id === o.warehouse_id)
          fail("备份调拨单据无效。");
      } else if (o.transfer_id !== "" || o.transfer_warehouse_id !== null) fail("备份调拨关联无效。");
      if (o.kind === "return") {
        const source = orders.get(o.source_order_id);
        if (
          !source ||
          source.warehouse_id !== o.warehouse_id ||
          source.kind !== "normal" ||
          source.type === o.type ||
          (o.status === "active" && source.status === "void")
        )
          fail("备份退货关联无效。");
      } else if (o.source_order_id !== null) fail("备份原单关联无效。");
    }
    // A transfer is exactly two linked legs whose item sets mirror by barcode.
    const transferLegs = new Map();
    for (const o of data.orders)
      if (o.kind === "transfer") transferLegs.set(o.transfer_id, [...(transferLegs.get(o.transfer_id) || []), o]);
    for (const legs of transferLegs.values()) {
      const out = legs.find((leg) => leg.type === "out"), incoming = legs.find((leg) => leg.type === "in");
      if (legs.length !== 2 || !out || !incoming || out.status !== incoming.status ||
          out.transfer_warehouse_id !== incoming.warehouse_id || incoming.transfer_warehouse_id !== out.warehouse_id)
        fail("备份调拨单据不完整。");
      const quantities = new Map();
      for (const item of data.order_items)
        if (item.order_id === out.id) quantities.set(products.get(item.product_id)?.barcode, item.quantity);
      const inbound = data.order_items.filter((item) => item.order_id === incoming.id);
      if (inbound.length !== quantities.size ||
          inbound.some((item) => quantities.get(products.get(item.product_id)?.barcode) !== item.quantity))
        fail("备份调拨明细不一致。");
    }
    const keys = new Set(),
      totals = new Map(),
      originalItems = new Map();
    for (const i of data.order_items) {
      const key = `${i.order_id}:${i.product_id}`;
      if (
        (i.amount_cents !== null && (!Number.isSafeInteger(i.amount_cents) || i.amount_cents < 0)) ||
        (i.cost_cents !== null && (!Number.isSafeInteger(i.cost_cents) || i.cost_cents < 0)) ||
        !orders.has(i.order_id) ||
        !products.has(i.product_id) ||
        products.get(i.product_id)?.warehouse_id !== orders.get(i.order_id)?.warehouse_id ||
        keys.has(key) ||
        !text(i.name, 100) ||
        !text(i.barcode, 64) ||
        !validQuantity(i.quantity, true) ||
        !validUnitPrice(i.price)
      )
        fail("备份单据明细无效。");
      if (['normal', 'internal'].includes(orders.get(i.order_id).kind) && orderLineAmount(i) !== Math.round(i.quantity * i.price * 100))
        fail('备份原单明细金额无效。');
      keys.add(key);
      originalItems.set(key, i);
      totals.set(
        i.order_id,
        (totals.get(i.order_id) || 0) + orderLineAmount(i),
      );
    }
    for (const o of data.orders)
      if (!totals.has(o.id) || totals.get(o.id) !== Math.round(o.total * 100))
        fail("备份单据合计与明细不一致。");
    const returned = new Map(), returnedAmounts = new Map();
    for (const i of data.order_items) {
      const order = orders.get(i.order_id);
      if (order.kind !== "return") continue;
      const key = `${order.source_order_id}:${i.product_id}`,
        original = originalItems.get(key);
      if (!original || original.price !== i.price)
        fail("备份退货明细与原单不一致。");
      if (order.status === "active") {
        const amount = returnedAmounts.get(key) || { cents: 0, allocated: false };
        amount.cents += orderLineAmount(i);
        amount.allocated ||= i.amount_cents !== null;
        returnedAmounts.set(key, amount);
        if (amount.allocated && amount.cents > orderLineAmount(original)) fail('备份退货金额超过原单。');
        returned.set(key, addQuantity(returned.get(key) || 0, i.quantity));
        if (returned.get(key) > original.quantity)
          fail("备份退货数量超过原单。");
      }
    }
    for (const a of data.stock_adjustments)
      if (
        !products.has(a.product_id) ||
        !validQuantity(a.before_stock) ||
        !validQuantity(a.after_stock) ||
        !text(a.batch, 100) ||
        !text(a.name, 100) ||
        !text(a.reason) ||
        !["stocktake", "opening", "reduce", "increase"].includes(a.kind) ||
        !text(a.created_at, 100)
      )
        fail("备份盘点记录无效。");
    for (const change of data.product_changes) {
      if (!products.has(change.product_id) ||
          !['before_cost','after_cost','before_price','after_price'].every(key =>
            validUnitPrice(change[key])) ||
          (change.before_cost === change.after_cost && change.before_price === change.after_price) ||
          !(change.created_by === null || (Number.isSafeInteger(change.created_by) && change.created_by > 0)) ||
          !text(change.created_by_name, 60) || !text(change.created_at, 100))
        fail('备份物料改价记录无效。');
    }
    const paid = new Map();
    for (const p of data.payments) {
      const o = orders.get(p.order_id);
      if (!o || !o.settlement_tracked || !Number.isSafeInteger(p.amount_cents) || p.amount_cents <= 0 || !text(p.method,50) || typeof p.note !== 'string' || p.note.length > 500 || !text(p.created_at,100) || !(p.reversed_at === null || text(p.reversed_at,100)) || typeof p.reverse_reason !== 'string' || p.reverse_reason.length > 500) fail('备份收付款无效。');
      if (p.reversed_at === null) { paid.set(o.id,(paid.get(o.id)||0)+p.amount_cents); if (o.status === 'void' || paid.get(o.id) > Math.round(o.total*100)) fail('备份收付款超过单据金额。'); }
    }
    for (const d of data.templates) {
      if (!['in','out'].includes(d.type) || !text(d.name,100) || !Number.isSafeInteger(d.version) || d.version < 1 || typeof d.partner !== 'string' || d.partner.length > 100 || typeof d.note !== 'string' || d.note.length > 500 || (d.partner_id !== null && !contacts.has(d.partner_id)) || !text(d.updated_at,100)) fail('备份模板无效。');
      const items = JSON.parse(d.items);
      if (!Array.isArray(items) || !items.length || items.length > 100 || new Set(items.map(i => i.product_id)).size !== items.length || items.some(i => !products.has(i.product_id) || products.get(i.product_id)?.warehouse_id !== d.warehouse_id || !validQuantity(i.quantity, true) || !validUnitPrice(i.price))) fail('备份模板明细无效。');
    }
    validateStockQrBackup(data);
    validateQualityBackup(data);
    validateBomBackup(data);
    validateProductionBackup(data);
    validateProductionMaterialBackup(data);
    validateProductionReceiptBackup(data);
    validateProductionStageBackup(data);
    return data;
  }
  app.get(
    "/api/backup",
    route(() => transaction(() => backup())),
  );
  app.post(
    "/api/backup/preview",
    route((req) => {
      const data = validateBackup(req.body.backup);
      return {
        token: hash(req.body.backup),
        current_token: hash(snapshot()),
        warehouses: data.warehouses.length,
        products: data.products.length,
        orders: data.orders.length,
        adjustments: data.stock_adjustments.length,
        contacts: data.contacts.length, templates: data.templates.length, payments: data.payments.length, stock_qrs: data.stock_qr_codes.length,
        quality_templates: data.quality_templates.length, quality_acceptances: data.quality_acceptances.length, quality_charts: data.quality_charts.length, quality_files: data.quality_template_files.length,
        boms: data.boms.length, bom_scraps: data.bom_scraps.length, production_scraps: data.production_scraps.length,
        production_bom_nodes: data.production_bom_nodes.length, production_orders: data.production_orders.length, production_batches: data.production_batches.length,
      };
    }),
  );
  app.post(
    "/api/backup/restore",
    route((req) =>
      mutation(req, () => {
        if (
          req.body.confirmation !== "RESTORE_BUSINESS_DATA" ||
          req.body.token !== hash(req.body.backup)
        )
          fail("请先预览并确认恢复备份。");
        if (req.body.current_token !== hash(snapshot()))
          fail("业务数据已变化，请重新预览后恢复。");
        const data = validateBackup(req.body.backup);
        // Deferred references allow return records to refer to original orders regardless of array order.
        clearStockQr(db);
        clearQuality(db);
        clearProduction(db);
        clearBom(db);
        db.exec("UPDATE ai_conversations SET auth_context=''; UPDATE ai_actions SET expires_at=0 WHERE result IS NULL;");
        db.exec(
          "PRAGMA defer_foreign_keys=ON; DELETE FROM payments; DELETE FROM templates; DELETE FROM stock_adjustments; DELETE FROM product_changes; DELETE FROM order_items; DELETE FROM orders; DELETE FROM products; DELETE FROM categories; DELETE FROM contacts; DELETE FROM warehouses; DELETE FROM operation_requests;",
        );
        for (const table of tables) {
          const fields = columns[table];
          const insert = db.prepare(
            `INSERT INTO ${table} (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`,
          );
          for (const row of data[table]) {
            if (['quality_templates','quality_charts'].includes(table)) row.version = Date.now() + Math.floor(Math.random() * 1000000);
            // Cross-server user IDs must never become local owners of restored templates.
            if (['orders','templates','product_changes','production_batches','production_stage_batches'].includes(table) && row.created_by !== null &&
                (req.body.backup.source_instance_id !== db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value ||
                 !db.prepare('SELECT 1 FROM users WHERE id=?').get(row.created_by))) row.created_by = null;
            if (['production_orders', 'production_batches', 'production_stage_batches'].includes(table) && row.production_group_id !== null &&
                (req.body.backup.source_instance_id !== db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value ||
                 !db.prepare('SELECT 1 FROM production_groups WHERE id=?').get(row.production_group_id))) row.production_group_id = null;
            if (table === 'stock_qr_codes') { row.qr_id = randomUUID(); row.enabled = 0; }
            if (stockQrTables.includes(table)) for (const owner of ['created_by','updated_by']) {
              if (owner in row && row[owner] !== null &&
                  (req.body.backup.source_instance_id !== db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value ||
                   !db.prepare('SELECT 1 FROM users WHERE id=?').get(row[owner]))) row[owner] = null;
            }
            insert.run(...fields.map((c) => row[c]));
          }
        }
        db.prepare('UPDATE settings SET warehouse_name=? WHERE id=1').run(data.warehouses.find(w => w.id === 1).name);
        db.prepare(
          "INSERT OR REPLACE INTO app_metadata VALUES ('demo_initialized','1')",
        ).run();
        return { ok: true };
      }),
    ),
  );
  return {
    previewImport(rows, warehouseId) {
      const result = validateRows(rows, warehouseId);
      return { count: rows.length, errors: result.errors, token: hash(rows) };
    },
    importProducts,
    createTransfer,
    createStocktake: req => notificationMutation(db, req, () => createStocktake(req)),
  };

}
