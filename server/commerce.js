const fail = (message) => {
  throw new Error(message);
};
const text = (s, max = 100, optional = false) =>
  typeof s === "string" && s.length <= max && (optional || !!s.trim());
export const cents = (n) => {
  if (
    typeof n !== "number" ||
    !Number.isFinite(n) ||
    n < 0 ||
    !Number.isSafeInteger(Math.round(n * 100)) ||
    Math.abs(n * 100 - Math.round(n * 100)) > 0.00001
  )
    fail("金额需为非负数，最多两位小数。");
  return Math.round(n * 100);
};
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
export const businessRole = (order) =>
  (order.kind === "return" ? order.type === "out" : order.type === "in")
    ? "supplier"
    : "customer";
export function migrateCommerce(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS contacts (id INTEGER PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('supplier','customer')), name TEXT NOT NULL, person TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, UNIQUE(role,name));
    CREATE TABLE IF NOT EXISTS drafts (id INTEGER PRIMARY KEY, type TEXT NOT NULL, partner TEXT NOT NULL, partner_id INTEGER REFERENCES contacts(id), note TEXT NOT NULL, items TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'active', order_id INTEGER REFERENCES orders(id), updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), amount_cents INTEGER NOT NULL, method TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL, reversed_at TEXT, reverse_reason TEXT NOT NULL DEFAULT '');`);
  const add = (table, name, def) => {
    if (
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((c) => c.name === name)
    )
      return false;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
    return true;
  };
  if (add("products", "inventory_value_cents", "INTEGER NOT NULL DEFAULT 0"))
    db.exec("UPDATE products SET inventory_value_cents=ROUND(stock*cost*100)");
  add("order_items", "cost_cents", "INTEGER");
  add("orders", "settlement_tracked", "INTEGER NOT NULL DEFAULT 0");
  if (add("orders", "partner_id", "INTEGER REFERENCES contacts(id)")) {
    for (const o of db.prepare("SELECT * FROM orders").all()) {
      const role = businessRole(o);
      db.prepare("INSERT OR IGNORE INTO contacts(role,name) VALUES (?,?)").run(
        role,
        o.partner,
      );
      db.prepare("UPDATE orders SET partner_id=? WHERE id=?").run(
        db
          .prepare("SELECT id FROM contacts WHERE role=? AND name=?")
          .get(role, o.partner).id,
        o.id,
      );
    }
  }
}
export function resolveContact(db, type, name, id) {
  const role = type === "in" ? "supplier" : "customer";
  if (id != null) {
    const c = db.prepare("SELECT * FROM contacts WHERE id=?").get(id);
    if (!c || c.role !== role || !c.active)
      fail("往来单位不存在、已停用或类型不匹配。");
    return c;
  }
  db.prepare("INSERT OR IGNORE INTO contacts(role,name) VALUES (?,?)").run(
    role,
    name.trim(),
  );
  const c = db
    .prepare("SELECT * FROM contacts WHERE role=? AND name=?")
    .get(role, name.trim());
  if (!c.active) fail("此往来单位已停用，请先启用或选择其他单位。");
  return c;
}
export function allocate(value, quantity, stock) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    !integer(quantity) ||
    !integer(stock) ||
    !stock
  )
    fail("库存成本数据无效。");
  return Number(
    (BigInt(value) * BigInt(quantity) * 2n + BigInt(stock)) /
      (BigInt(stock) * 2n),
  );
}
// Value and quantity move together. Explicit value is used for receipts and reversals.
export function moveInventory(db, id, delta, explicit) {
  const p = db.prepare("SELECT * FROM products WHERE id=?").get(id);
  if (!p || !integer(p.stock + delta) || p.stock + delta > 99999999)
    fail("库存不足或超出上限。");
  const amount =
    explicit == null
      ? p.stock
        ? allocate(p.inventory_value_cents, Math.abs(delta), p.stock)
        : Math.round(p.cost * Math.abs(delta) * 100)
      : explicit;
  const next = p.inventory_value_cents + (delta < 0 ? -amount : amount);
  if (!integer(amount) || !integer(next))
    fail("库存成本不足或超出范围，请使用退货或盘点纠正后续业务。");
  if (p.stock + delta === 0 && next !== 0)
    fail("后续交易已改变库存成本，不能直接作废此单，请使用退货处理。");
  db.prepare(
    "UPDATE products SET stock=?,inventory_value_cents=? WHERE id=?",
  ).run(p.stock + delta, next, id);
  return amount;
}
export function settlement(db, order) {
  const paid = db
    .prepare(
      "SELECT COALESCE(SUM(amount_cents),0) AS n FROM payments WHERE order_id=? AND reversed_at IS NULL",
    )
    .get(order.id).n;
  const total = Math.round(order.total * 100);
  return {
    paid_cents: paid,
    due_cents:
      order.status === "void" || !order.settlement_tracked ? 0 : total - paid,
    payment_status:
      order.status === "void"
        ? "void"
        : !order.settlement_tracked
          ? "unverified"
          : paid === total
            ? "paid"
            : paid
              ? "partial"
              : "unpaid",
    direction: order.type === "out" ? "receive" : "pay",
  };
}
export function validateDraft(db, body) {
  if (
    !["in", "out"].includes(body.type) ||
    !text(body.partner, 100, true) ||
    !text(body.note, 500, true) ||
    !Array.isArray(body.items) ||
    body.items.length > 100
  )
    fail("草稿格式无效，每张最多 100 种商品。");
  if (body.partner_id != null) {
    const c = db
      .prepare("SELECT * FROM contacts WHERE id=?")
      .get(body.partner_id);
    if (!c || c.role !== (body.type === "in" ? "supplier" : "customer"))
      fail("草稿往来单位无效。");
  }
  const seen = new Set();
  for (const i of body.items) {
    if (
      !Number.isSafeInteger(i.product_id) ||
      seen.has(i.product_id) ||
      !db.prepare("SELECT 1 FROM products WHERE id=?").get(i.product_id) ||
      !["string", "number"].includes(typeof i.quantity) ||
      !["string", "number"].includes(typeof i.price) ||
      String(i.quantity).length > 30 ||
      String(i.price).length > 30
    )
      fail("草稿商品不存在、重复或输入过长。");
    seen.add(i.product_id);
  }
}
export function installCommerce(app, db, { route, mutation }) {
  app.get(
    "/api/contacts",
    route(() =>
      db.prepare("SELECT * FROM contacts ORDER BY active DESC,name,id").all(),
    ),
  );
  app.post(
    "/api/contacts",
    route((req) =>
      mutation(req, () => {
        const b = req.body;
        if (
          !["supplier", "customer"].includes(b.role) ||
          !text(b.name) ||
          !text(b.person, 100, true) ||
          !text(b.phone, 50, true) ||
          !text(b.address, 300, true) ||
          !text(b.note, 500, true) ||
          ![0, 1].includes(b.active)
        )
          fail("请填写名称，检查联系人、电话、地址和备注长度。");
        if (
          db
            .prepare(
              "SELECT id FROM contacts WHERE role=? AND name=? AND id!=?",
            )
            .get(b.role, b.name.trim(), b.id || 0)
        )
          fail("同类往来单位名称已存在。");
        if (b.id) {
          const current = db
            .prepare("SELECT * FROM contacts WHERE id=?")
            .get(b.id);
          if (
            !current ||
            current.version !== b.version ||
            current.role !== b.role
          )
            fail("往来单位已变化，请刷新；已有记录不能更换类型。");
          db.prepare(
            "UPDATE contacts SET name=?,person=?,phone=?,address=?,note=?,active=?,version=version+1 WHERE id=?",
          ).run(
            b.name.trim(),
            b.person.trim(),
            b.phone.trim(),
            b.address.trim(),
            b.note.trim(),
            b.active,
            b.id,
          );
          return { id: b.id };
        }
        return {
          id: Number(
            db
              .prepare(
                "INSERT INTO contacts(role,name,person,phone,address,note,active) VALUES (?,?,?,?,?,?,?)",
              )
              .run(
                b.role,
                b.name.trim(),
                b.person.trim(),
                b.phone.trim(),
                b.address.trim(),
                b.note.trim(),
                b.active,
              ).lastInsertRowid,
          ),
        };
      }),
    ),
  );
  app.get(
    "/api/drafts",
    route((req) =>
      db
        .prepare(
          "SELECT * FROM drafts WHERE status='active' AND warehouse_id=? ORDER BY updated_at DESC,id DESC",
        )
        .all(req.warehouse.id)
        .map((d) => ({ ...d, items: JSON.parse(d.items) })),
    ),
  );
  app.post(
    "/api/drafts",
    route((req) =>
      mutation(req, () => {
        const b = req.body;
        validateDraft(db, b);
        const fields = [
          b.type,
          b.partner,
          b.partner_id ?? null,
          b.note,
          JSON.stringify(b.items),
          new Date().toISOString(),
        ];
        let id = b.id;
        if (id) {
          const d = db.prepare("SELECT * FROM drafts WHERE id=?").get(id);
          if (!d || d.status !== "active" || d.version !== b.version)
            fail("草稿已被修改或提交，请刷新后重新打开。");
          db.prepare(
            "UPDATE drafts SET type=?,partner=?,partner_id=?,note=?,items=?,updated_at=?,version=version+1 WHERE id=?",
          ).run(...fields, id);
        } else
          id = Number(
            db
              .prepare(
                "INSERT INTO drafts(type,partner,partner_id,note,items,updated_at,warehouse_id) VALUES (?,?,?,?,?,?,?)",
              )
              .run(...fields, req.warehouse.id).lastInsertRowid,
          );
        const d = db.prepare("SELECT * FROM drafts WHERE id=?").get(id);
        return { ...d, items: JSON.parse(d.items) };
      }),
    ),
  );
  app.post(
    "/api/drafts/:id/discard",
    route((req) =>
      mutation(req, () => {
        const d = db
          .prepare("SELECT * FROM drafts WHERE id=?")
          .get(req.params.id);
        if (!d || d.status !== "active" || d.version !== req.body.version)
          fail("草稿已变化，请刷新。");
        db.prepare("DELETE FROM drafts WHERE id=?").run(d.id);
        return { ok: true };
      }),
    ),
  );
  app.get(
    "/api/orders/:id/payments",
    route((req) => {
      const o = db
        .prepare("SELECT * FROM orders WHERE id=?")
        .get(req.params.id);
      if (!o) fail("单据不存在。");
      return {
        ...settlement(db, o),
        total: o.total,
        entries: db
          .prepare("SELECT * FROM payments WHERE order_id=? ORDER BY id DESC")
          .all(o.id),
      };
    }),
  );
  app.post(
    "/api/orders/:id/settlement",
    route((req) =>
      mutation(req, () => {
        const o = db
          .prepare("SELECT * FROM orders WHERE id=?")
          .get(req.params.id);
        if (
          !o ||
          o.status !== "active" ||
          o.settlement_tracked ||
          req.body.confirmation !== "TRACK_SETTLEMENT"
        )
          fail("请确认将此历史单据纳入收付款管理。");
        const paid = cents(req.body.paid);
        if (paid > Math.round(o.total * 100) || !text(req.body.note, 500))
          fail("已收付金额超过单据总额或缺少核对说明。");
        db.prepare("UPDATE orders SET settlement_tracked=1 WHERE id=?").run(
          o.id,
        );
        if (paid)
          db.prepare(
            "INSERT INTO payments(order_id,amount_cents,method,note,created_at) VALUES (?,?,'期初核对',?,?)",
          ).run(o.id, paid, req.body.note, new Date().toISOString());
        return { ok: true };
      }),
    ),
  );
  app.post(
    "/api/orders/:id/payments",
    route((req) =>
      mutation(req, () => {
        const o = db
          .prepare("SELECT * FROM orders WHERE id=?")
          .get(req.params.id);
        if (!o || o.status !== "active" || !o.settlement_tracked)
          fail("单据不存在、已作废或尚未核对收付款。");
        const amount = cents(req.body.amount);
        if (
          !amount ||
          amount > settlement(db, o).due_cents ||
          !text(req.body.method, 50) ||
          !text(req.body.note, 500, true)
        )
          fail("金额必须大于零且不能超过待收付金额，请填写收付款方式。");
        const id = db
          .prepare(
            "INSERT INTO payments(order_id,amount_cents,method,note,created_at) VALUES (?,?,?,?,?)",
          )
          .run(
            o.id,
            amount,
            req.body.method.trim(),
            req.body.note,
            new Date().toISOString(),
          ).lastInsertRowid;
        return { id: Number(id) };
      }),
    ),
  );
  app.post(
    "/api/payments/:id/reverse",
    route((req) =>
      mutation(req, () => {
        if (!text(req.body.reason, 500)) fail("请填写撤销原因。");
        const p = db
          .prepare("SELECT * FROM payments WHERE id=?")
          .get(req.params.id);
        if (!p || p.reversed_at) fail("收付款记录不存在或已经撤销。");
        db.prepare(
          "UPDATE payments SET reversed_at=?,reverse_reason=? WHERE id=?",
        ).run(new Date().toISOString(), req.body.reason, p.id);
        return { ok: true };
      }),
    ),
  );
  app.get(
    "/api/finance",
    route((req) => {
      const orders = db
        .prepare(
          "SELECT * FROM orders WHERE status='active' AND warehouse_id=? ORDER BY created_at DESC,id DESC",
        )
        .all(req.warehouse.id)
        .map((o) => ({ ...o, ...settlement(db, o) }));
      const balances = new Map();
      for (const o of orders) {
        const key = o.partner_id || `${businessRole(o)}:${o.partner}`;
        if (!balances.has(key))
          balances.set(key, {
            partner_id: o.partner_id,
            name:
              (o.partner_id &&
                db
                  .prepare("SELECT name FROM contacts WHERE id=?")
                  .get(o.partner_id)?.name) ||
              o.partner,
            role: businessRole(o),
            receivable_cents: 0,
            payable_cents: 0,
            unverified: 0,
          });
        const b = balances.get(key);
        if (!o.settlement_tracked) b.unverified++;
        else
          b[o.direction === "receive" ? "receivable_cents" : "payable_cents"] +=
            o.due_cents;
      }
      return { orders, balances: [...balances.values()] };
    }),
  );
  app.get(
    "/api/reports/profit",
    route((req) => {
      const date = (value) =>
        typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        new Date(value).toISOString().slice(0, 10) === value;
      const from = req.query.from || "1970-01-01",
        to = req.query.to || new Date().toISOString().slice(0, 10);
      if (!date(from) || !date(to) || from > to) fail("请选择有效的起止日期。");
      const lines = db
        .prepare(
          `SELECT i.*,o.kind,o.created_at FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.warehouse_id=? AND o.status='active' AND ((o.kind='normal' AND o.type='out') OR (o.kind='return' AND o.type='in')) AND substr(o.created_at,1,10) BETWEEN ? AND ? ORDER BY o.created_at,i.id`,
        )
        .all(req.warehouse.id, from, to);
      const groups = new Map();
      for (const i of lines) {
        const sign = i.kind === "return" ? -1 : 1;
        if (!groups.has(i.product_id))
          groups.set(i.product_id, {
            product_id: i.product_id,
            name: i.name,
            quantity: 0,
            revenue_cents: 0,
            known_revenue_cents: 0,
            cost_cents: 0,
            unknown_revenue_cents: 0,
            unknown_lines: 0,
          });
        const g = groups.get(i.product_id),
          revenue = sign * Math.round(i.quantity * i.price * 100);
        g.quantity += sign * i.quantity;
        g.revenue_cents += revenue;
        if (i.cost_cents == null) {
          g.unknown_revenue_cents += revenue;
          g.unknown_lines++;
        } else {
          g.cost_cents += sign * i.cost_cents;
          g.known_revenue_cents += revenue;
        }
      }
      const rows = [...groups.values()].map((g) => ({
        ...g,
        gross_profit_cents: g.known_revenue_cents - g.cost_cents,
        margin:
          g.known_revenue_cents > 0
            ? (g.known_revenue_cents - g.cost_cents) / g.known_revenue_cents
            : null,
      }));
      const totals = rows.reduce(
        (a, g) => {
          for (const k of [
            "revenue_cents",
            "known_revenue_cents",
            "cost_cents",
            "gross_profit_cents",
            "unknown_revenue_cents",
            "unknown_lines",
          ])
            a[k] += g[k];
          return a;
        },
        {
          revenue_cents: 0,
          known_revenue_cents: 0,
          cost_cents: 0,
          gross_profit_cents: 0,
          unknown_revenue_cents: 0,
          unknown_lines: 0,
        },
      );
      return {
        from,
        to,
        rows,
        totals,
        inventory_value_cents: db
          .prepare(
            "SELECT COALESCE(SUM(inventory_value_cents),0) AS n FROM products WHERE warehouse_id=?",
          )
          .get(req.warehouse.id).n,
      };
    }),
  );
}
