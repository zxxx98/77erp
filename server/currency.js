export const currencies = ["USD", "CNY"];
export const currencyLabels = { USD: "美元", CNY: "人民币" };
export const currencySymbols = { USD: "$", CNY: "¥" };
export const RATE_SOURCE = "open.er-api.com";
const DEFAULT_RATE = 7.2;

const addColumn = (db, name, definition) => {
  if (db.prepare("PRAGMA table_info(settings)").all().some((c) => c.name === name)) return;
  db.exec(`ALTER TABLE settings ADD COLUMN ${name} ${definition}`);
};

export function migrateCurrency(db) {
  addColumn(db, "base_currency", "TEXT NOT NULL DEFAULT 'USD'");
  addColumn(db, "display_currency", "TEXT NOT NULL DEFAULT 'USD'");
  addColumn(db, "usd_cny_rate", `REAL NOT NULL DEFAULT ${DEFAULT_RATE}`);
  addColumn(db, "rate_updated_at", "TEXT NOT NULL DEFAULT ''");
  db.prepare(
    "UPDATE settings SET base_currency='USD' WHERE base_currency NOT IN ('USD','CNY') OR base_currency IS NULL",
  ).run();
  db.prepare(
    "UPDATE settings SET display_currency=base_currency WHERE display_currency NOT IN ('USD','CNY') OR display_currency IS NULL",
  ).run();
  db.prepare(
    `UPDATE settings SET usd_cny_rate=${DEFAULT_RATE} WHERE usd_cny_rate IS NULL OR usd_cny_rate <= 0`,
  ).run();
}

export const currencySettings = (db) => {
  const row = db
    .prepare(
      "SELECT base_currency,display_currency,usd_cny_rate,rate_updated_at FROM settings WHERE id=1",
    )
    .get();
  return {
    base_currency: row.base_currency,
    display_currency: row.display_currency,
    usd_cny_rate: row.usd_cny_rate,
    rate_updated_at: row.rate_updated_at,
  };
};

export const validRate = (value) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0.000001 &&
  value <= 1000000;

export function saveCurrencySettings(db, body) {
  const current = currencySettings(db);
  const display = body.display_currency ?? current.display_currency;
  const rate = body.usd_cny_rate ?? current.usd_cny_rate;
  if (!currencies.includes(display))
    throw new Error("请选择有效的显示币种。");
  if (!validRate(rate))
    throw new Error("汇率需为大于 0 的有效数字。");
  db.prepare(
    "UPDATE settings SET display_currency=?,usd_cny_rate=? WHERE id=1",
  ).run(display, rate);
  return currencySettings(db);
}

const parseRate = (payload) => {
  if (payload?.result && payload.result !== "success") return null;
  const rate = Number(payload?.rates?.CNY);
  return validRate(rate) ? rate : null;
};

export async function fetchUsdCnyRate() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(
      "https://open.er-api.com/v6/latest/USD",
      { signal: controller.signal, headers: { accept: "application/json" } },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rate = parseRate(await response.json());
    if (!rate) throw new Error("汇率数据无效");
    return rate;
  } finally {
    clearTimeout(timer);
  }
}

export function installCurrency(app, db) {
  app.put("/api/settings/currency", (req, res) => {
    try {
      res.json({ ok: true, ...saveCurrencySettings(db, req.body || {}) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/settings/currency/sync-rate", async (_req, res) => {
    try {
      const rate = await fetchUsdCnyRate();
      const updatedAt = new Date().toISOString();
      db.prepare(
        "UPDATE settings SET usd_cny_rate=?,rate_updated_at=? WHERE id=1",
      ).run(rate, updatedAt);
      res.json({ ok: true, usd_cny_rate: rate, rate_updated_at: updatedAt, source: RATE_SOURCE });
    } catch (error) {
      res.status(502).json({
        error:
          error?.name === "AbortError"
            ? "获取汇率超时，请检查网络后重试。"
            : "暂时无法获取最新汇率，请稍后重试或手动填写。",
      });
    }
  });
}
