import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import {
  download,
  downloadJSON,
  importTemplate,
  parseCSV,
  rowsToProducts,
} from "./data-files.js";
import "./operations.css";

export const orderLabel = (o) =>
  `${o.kind === "return" ? (o.type === "in" ? "销售退货" : "采购退货") : o.type === "in" ? "采购入库" : "销售出库"}${o.status === "void" ? " · 已作废" : ""}`;
export const businessType = (o) =>
  o.kind === "return" ? (o.type === "in" ? "out" : "in") : o.type;
// Reports use the original business direction; returns reduce its amount.
export const reportOrders = (orders) =>
  orders
    .filter((o) => o.status !== "void")
    .map((o) =>
      o.kind === "return"
        ? { ...o, type: o.type === "in" ? "out" : "in", total: -o.total }
        : o,
    );
function useOperation() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    request = useRef({});
  const run = async (fn) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const send = (path, body) => {
    const key = JSON.stringify([path, body]);
    if (request.current.key !== key)
      request.current = {
        key,
        id: Array.from(
          globalThis.crypto.getRandomValues(new Uint32Array(4)),
          (n) => n.toString(16),
        ).join("-"),
      };
    return api(path, {
      method: "POST",
      body: { ...body, request_id: request.current.id },
    });
  };
  return { busy, error, run, send };
}
export function OrderActions({ order, onSaved }) {
  const { busy, error, run, send } = useOperation();
  const [reason, setReason] = useState(""),
    [quantities, setQuantities] = useState({});
  if (order.status === "void")
    return (
      <div className="info-box">
        已作废：{order.void_reason} · {order.voided_at}
      </div>
    );
  if (order.stock_applied === 0)
    return (
      <div className="info-box">期初已结转的演示单据，不支持作废或退货。</div>
    );
  const act = (action) =>
    run(async () => {
      if (!reason.trim()) throw new Error("请填写操作原因。");
      const items = order.items
        .filter(
          (i) =>
            quantities[i.product_id] !== undefined &&
            quantities[i.product_id] !== "" &&
            quantities[i.product_id] !== "0",
        )
        .map((i) => ({
          product_id: i.product_id,
          quantity: Number(quantities[i.product_id]),
        }));
      if (action === "returns" && !items.length)
        throw new Error("请填写至少一件商品的退货数量。");
      if (
        !window.confirm(
          action === "void"
            ? "确认作废此单据并反向调整库存？原单将保留，无法撤销作废。"
            : "确认按原单价格退货并调整库存？",
        )
      )
        return;
      await send(`/orders/${order.id}/${action}`, {
        reason,
        ...(action === "returns" ? { items } : {}),
      });
      await onSaved(
        action === "void"
          ? "单据已作废，库存已调整"
          : "退货单已生成，库存已调整",
      );
    });
  return (
    <section className="operation-panel">
      <h3>单据纠正</h3>
      {order.source_order_id && <p>关联原单 ID：{order.source_order_id}</p>}
      <label>
        操作原因
        <input
          value={reason}
          maxLength={500}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {order.kind !== "return" && (
        <>
          <p>退货沿用原单价格；数量留空或为 0 表示不退此商品。</p>
          {order.items.map((i) => (
            <label key={i.product_id}>
              {i.name}（可退 {i.quantity - (i.returned_quantity || 0)}）
              <input
                aria-label={`${i.name} 退货数量`}
                type="number"
                min="0"
                step="1"
                max={i.quantity - (i.returned_quantity || 0)}
                value={quantities[i.product_id] ?? ""}
                disabled={busy}
                onChange={(e) =>
                  setQuantities({
                    ...quantities,
                    [i.product_id]: e.target.value,
                  })
                }
              />
            </label>
          ))}
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy}
            onClick={() => act("returns")}
          >
            确认退货
          </button>
        </>
      )}
      <button
        className="btn"
        type="button"
        disabled={busy}
        onClick={() => act("void")}
      >
        作废单据
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
export function DataTools({ products, onSaved }) {
  const [tab, setTab] = useState("stocktake");
  return (
    <section className="operation-panel">
      <h3>库存与数据管理</h3>
      <div className="operation-tabs">
        {[
          ["stocktake", "库存盘点"],
          ["import", "批量导入"],
          ["backup", "备份与恢复"],
        ].map(([id, label]) => (
          <button
            type="button"
            className={`btn ${tab === id ? "btn-primary" : "btn-secondary"}`}
            key={id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div hidden={tab !== "stocktake"}>
        <Stocktake products={products} onSaved={onSaved} />
      </div>
      <div hidden={tab !== "import"}>
        <ProductImport onSaved={onSaved} />
      </div>
      <div hidden={tab !== "backup"}>
        <Backup onSaved={onSaved} />
      </div>
    </section>
  );
}
function Stocktake({ products, onSaved }) {
  const { busy, error, run, send } = useOperation();
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState({}),
    [reason, setReason] = useState(""),
    [history, setHistory] = useState([]);
  useEffect(() => {
    api("/stocktakes")
      .then(setHistory)
      .catch(() => {});
  }, []);
  const items = Object.values(selected);
  return (
    <div>
      <p>
        勾选要盘点的商品，填写实盘数量。提交时校验账面库存，库存变化后需刷新重新盘点。
      </p>
      <label>
        搜索盘点商品
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={busy}
        />
      </label>
      <div className="operation-scroll">
        {products
          .filter((p) =>
            `${p.name} ${p.barcode}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .map((p) => (
            <div className="operation-row stocktake-row" key={p.id}>
              <label>
                <input
                  type="checkbox"
                  checked={!!selected[p.id]}
                  disabled={busy}
                  onChange={(e) => {
                    const next = { ...selected };
                    if (e.target.checked)
                      next[p.id] = {
                        product_id: p.id,
                        name: p.name,
                        expected_stock: p.stock,
                        counted: String(p.stock),
                      };
                    else delete next[p.id];
                    setSelected(next);
                  }}
                />
                <div className="stocktake-product"><strong>{p.name}</strong><small>{p.barcode} · 账面 {p.stock} {p.unit}</small></div>
              </label>
              {selected[p.id] && (
                <label className="stocktake-count">
                  实盘
                  <input
                    aria-label={`${p.name} 实盘数量`}
                    type="number"
                    min="0"
                    step="1"
                    value={selected[p.id].counted}
                    disabled={busy}
                    onChange={(e) =>
                      setSelected({
                        ...selected,
                        [p.id]: { ...selected[p.id], counted: e.target.value },
                      })
                    }
                  />
                </label>
              )}
            </div>
          ))}
      </div>
      {items.length > 0 && (
        <p>
          已选 {items.length} 件：
          {items
            .map(
              (i) =>
                `${i.name} ${i.expected_stock} → ${i.counted || "未填"}（差异 ${i.counted === "" ? "未填" : Number(i.counted) - i.expected_stock}）`,
            )
            .join("；")}
        </p>
      )}
      <label>
        盘点原因
        <input
          value={reason}
          maxLength={500}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
          placeholder="例如：月末盘点、破损损耗"
        />
      </label>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || !items.length}
        onClick={() =>
          run(async () => {
            if (!reason.trim() || items.some((i) => !/^\d+$/.test(i.counted)))
              throw new Error("请填写原因和非负整数实盘数量。");
            if (
              !window.confirm(
                `确认提交 ${items.length} 种商品的盘点，按实盘数量调整库存？`,
              )
            )
              return;
            await send("/stocktakes", {
              reason,
              items: items.map(({ product_id, expected_stock, counted }) => ({
                product_id,
                expected_stock,
                counted: Number(counted),
              })),
            });
            await onSaved("盘点已完成，库存已调整");
          })
        }
      >
        确认盘点
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <details>
        <summary>最近盘点与期初库存记录（最多 1000 条）</summary>
        <div className="operation-scroll">
          {history.length ? (
            history.map((h) => (
              <p key={h.id}>
                {h.created_at.slice(0, 19).replace("T", " ")} · {h.name}：
                {h.before_stock} → {h.after_stock} · {h.reason}
              </p>
            ))
          ) : (
            <p>暂无记录</p>
          )}
        </div>
      </details>
    </div>
  );
}
function ProductImport({ onSaved }) {
  const { busy, error, run, send } = useOperation();
  const [rows, setRows] = useState(null),
    [preview, setPreview] = useState(null);
  return (
    <div>
      <p>
        支持 UTF-8 CSV 和 Excel .xlsx 的第一张工作表，每次最多 1000
        行。仅新增商品，不覆盖已有条码；期初库存会记录来源。条码请使用文本格式保留前导零。
      </p>
      <button
        type="button"
        className="btn"
        onClick={() =>
          download(
            importTemplate,
            "77ERP-商品导入模板.csv",
            "text/csv;charset=utf-8",
          )
        }
      >
        下载商品模板
      </button>
      <label>
        选择商品文件
        <input
          type="file"
          accept=".csv,.xlsx"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            setRows(null);
            setPreview(null);
            if (!file) return;
            void run(async () => {
              if (file.size > 5 * 1024 * 1024)
                throw new Error("商品文件不能超过 5 MB。");
              let table;
              if (/\.xlsx$/i.test(file.name)) {
                const { readSheet } = await import("read-excel-file/browser");
                table = await readSheet(file);
              } else if (/\.csv$/i.test(file.name))
                table = parseCSV(await file.text());
              else throw new Error("请选择 .csv 或 .xlsx 文件。");
              const parsed = rowsToProducts(table);
              setRows(parsed);
              setPreview(
                await api("/products/import/preview", {
                  method: "POST",
                  body: { rows: parsed },
                }),
              );
            });
          }}
        />
      </label>
      {rows && (
        <div className="operation-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>商品</th>
                <th>条码</th>
                <th>分类</th>
                <th>单位</th>
                <th>采购价</th>
                <th>销售价</th>
                <th>安全库存</th>
                <th>期初库存</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.name}</td>
                  <td>{r.barcode || "自动生成"}</td>
                  <td>{r.category}</td>
                  <td>{r.unit}</td>
                  <td>{r.cost}</td>
                  <td>{r.price}</td>
                  <td>{r.threshold}</td>
                  <td>{r.stock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {preview && (
        <>
          <p>
            共 {preview.count} 行，{preview.errors.length}{" "}
            行错误。确认前请核对预览。
          </p>
          {preview.errors.map((e) => (
            <p className="form-error" key={e.row}>
              第 {e.row} 行：{e.error}
            </p>
          ))}
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !!preview.errors.length}
            onClick={() =>
              run(async () => {
                if (
                  !window.confirm(
                    `确认新增 ${rows.length} 件商品并登记期初库存？`,
                  )
                )
                  return;
                await send("/products/import", { rows, token: preview.token });
                await onSaved("商品已批量导入");
              })
            }
          >
            确认导入
          </button>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
function Backup({ onSaved }) {
  const { busy, error, run, send } = useOperation();
  const [backup, setBackup] = useState(null),
    [preview, setPreview] = useState(null);
  return (
    <div>
      <p>
        备份包含商品、库存成本、单据、盘点、往来单位、草稿及收付款记录。恢复会替换全部业务数据，保留当前账户、登录信息、服务器及商户设置。请先下载当前备份。
      </p>
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={() =>
          run(async () =>
            downloadJSON(
              await api("/backup"),
              `77ERP-业务备份-${new Date().toISOString().replaceAll(":", "-")}.json`,
            ),
          )
        }
      >
        下载业务备份
      </button>
      <label>
        选择备份文件
        <input
          type="file"
          accept=".json"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            setBackup(null);
            setPreview(null);
            if (!file) return;
            void run(async () => {
              if (file.size > 95 * 1024 * 1024)
                throw new Error("备份不能超过 95 MB。");
              const value = JSON.parse(await file.text());
              const result = await api("/backup/preview", {
                method: "POST",
                body: { backup: value },
              });
              setBackup(value);
              setPreview(result);
            });
          }}
        />
      </label>
      {preview && (
        <>
          <p>
            备份时间：{backup.created_at}；商品 {preview.products} 件，单据{" "}
            {preview.orders} 张，库存调整 {preview.adjustments} 条。往来单位 {preview.contacts ?? 0} 个，草稿 {preview.drafts ?? 0} 张，收付款 {preview.payments ?? 0} 条。
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (
                  !window.confirm(
                    "确认用此备份替换当前全部业务数据？此操作无法撤销，请确保已经下载当前备份。",
                  )
                )
                  return;
                await send("/backup/restore", {
                  backup,
                  token: preview.token,
                  current_token: preview.current_token,
                  confirmation: "RESTORE_BUSINESS_DATA",
                });
                await onSaved("业务数据已恢复，账户和配置已保留");
              })
            }
          >
            确认恢复备份
          </button>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
