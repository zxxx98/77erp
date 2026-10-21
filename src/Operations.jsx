import { orderLabel } from './order-utils.js';
export { orderLabel, businessType, reportOrders } from './order-utils.js';
import { useQuery, usePagedQuery, queryPath } from './queries.js';
import { LoadingIndicator, LoadingStatus } from './Loading.jsx';
import { parseQuantity, addQuantity } from "../shared/quantity.js";
import { usePermissions } from "./permissions.jsx";
import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, FileJson, FileSpreadsheet, Package, Trash2, Truck, Upload } from "lucide-react";
import { api } from "./api.js";
import { Select } from "./Dropdown.jsx";
import {
  download,
  downloadJSON,
  importTemplate,
  parseCSV,
  rowsToProducts,
} from "./data-files.js";
import "./operations.css";
import { exportFileName, sheetName, warehouseSheet } from "./product-export.js";

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
            quantities[i.product_id]?.trim() &&
            Number(quantities[i.product_id]) !== 0,
        )
        .map((i) => ({
          product_id: i.product_id,
          quantity: Number(quantities[i.product_id]),
        }));
      if (action === "returns" && !items.length)
        throw new Error("请填写至少一件物料的退货数量。");
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
      {busy && <p><LoadingStatus>正在处理单据…</LoadingStatus></p>}
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
      {order.kind === "normal" && (
        <>
          <p>退货沿用原单价格；数量留空或为 0 表示不退此物料。</p>
          {order.items.map((i) => (
            <label key={i.product_id}>
              {i.name}（可退 {addQuantity(i.quantity, -(i.returned_quantity || 0))}）
              <input
                aria-label={`${i.name} 退货数量`}
                type="number"
                min="0"
                step="0.000001"
                max={addQuantity(i.quantity, -(i.returned_quantity || 0))}
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
export function Stocktake({ data, onSaved }) {
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
  const catalog = usePagedQuery(queryPath('/products', { q: query, status: 'all' }), data, 'products', query ? 250 : 0);
  const products = catalog.result?.products || [];
  const items = Object.values(selected);
  return (
    <div>
      {busy && <p><LoadingStatus>正在保存盘点…</LoadingStatus></p>}
      <p>
        勾选要盘点的物料，填写实盘数量。提交时校验账面库存，库存变化后需刷新重新盘点。
      </p>
      <label>
        搜索盘点物料
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={busy}
        />
      </label>
      {catalog.error && <div role="alert">{catalog.error}<button onClick={catalog.retry}>重新加载</button></div>}
      {catalog.loading && <LoadingStatus>正在读取物料…</LoadingStatus>}
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
                    step="0.000001"
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
      {catalog.result?.has_more && <button type="button" className="btn" disabled={catalog.loading} onClick={catalog.loadMore}>加载更多物料</button>}
      {items.length > 0 && (
        <p>
          已选 {items.length} 件：
          {items
            .map(
              (i) =>
                `${i.name} ${i.expected_stock} → ${i.counted || "未填"}（差异 ${i.counted === "" ? "未填" : addQuantity(Number(i.counted), -i.expected_stock)}）`,
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
            if (!reason.trim()) throw new Error("请填写盘点原因。");
            items.forEach(i => parseQuantity(i.counted));
            if (
              !window.confirm(
                `确认提交 ${items.length} 种物料的盘点，按实盘数量调整库存？`,
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
        <summary>最近库存调整与期初库存记录（最多 1000 条）</summary>
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
export function ProductImport({ onSaved }) {
  const { busy, error, run, send } = useOperation();
  const [rows, setRows] = useState(null),
    [preview, setPreview] = useState(null),
    [fileName, setFileName] = useState("");
  const fileInput = useRef(null);
  const readFile = async (file) => {
    if (file.size > 5 * 1024 * 1024)
      throw new Error("物料文件不能超过 5 MB。");
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
  };
  return (
    <div>
      <p>
        支持 UTF-8 CSV 和 Excel .xlsx 的第一张工作表，每次最多 1000
        行。仅新增物料，不覆盖已有条码；期初库存会记录来源。条码请使用文本格式保留前导零。
      </p>
      <button
        type="button"
        className="btn"
        onClick={() =>
          download(
            importTemplate,
            "77ERP-物料导入模板.csv",
            "text/csv;charset=utf-8",
          )
        }
      >
        下载物料模板
      </button>
      <div className="file-upload-field" role="group">
        <div className="file-upload-label">选择物料文件</div>
        <input
          ref={fileInput}
          hidden
          type="file"
          accept=".csv,.xlsx"
          disabled={busy}
          aria-label="选择物料文件"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            setRows(null);
            setPreview(null);
            setFileName("");
            if (!file) return;
            void run(async () => {
              await readFile(file);
              setFileName(file.name);
            });
          }}
        />
        <button
          type="button"
          className="file-upload-button"
          disabled={busy}
          aria-busy={busy}
          onClick={() => fileInput.current?.click()}
        >
          <span className="file-upload-icon" aria-hidden="true">
            {busy ? <LoadingIndicator size={22} /> : <FileSpreadsheet size={22} />}
          </span>
          <span className="file-upload-copy">
            <strong>{busy ? "正在读取文件…" : fileName || "选择物料文件"}</strong>
            <span>
              {busy
                ? "正在解析并生成预览，请稍候"
                : "点击选择文件，支持 CSV、Excel（.xlsx）"}
            </span>
          </span>
          {!busy && <Upload size={18} aria-hidden="true" />}
        </button>
      </div>
      {rows && (
        <div className="operation-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>物料</th>
                <th>条码</th>
                <th>分类</th>
                <th>单位</th>
                <th>参考采购价</th>
                <th>参考销售价</th>
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
                    `确认新增 ${rows.length} 件物料并登记期初库存？`,
                  )
                )
                  return;
                await send("/products/import", { rows, token: preview.token });
                await onSaved("物料已批量导入");
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
export function ProductExport({ warehouses = [], warehouseId }) {
  const { busy, error, run } = useOperation();
  const [selected, setSelected] = useState(() =>
    warehouseId ? [warehouseId] : warehouses.map((w) => w.id),
  );
  const [fixedOnly, setFixedOnly] = useState(false);
  const [progress, setProgress] = useState("");
  const [done, setDone] = useState("");
  const toggle = (id) =>
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  const exportAll = () =>
    run(async () => {
      const targets = warehouses.filter((w) => selected.includes(w.id));
      if (!targets.length) throw new Error("请至少选择一个仓库。");
      setDone("");
      setProgress("正在读取仓库物料…");
      const used = new Set();
      const sheets = [];
      let total = 0;
      for (const w of targets) {
        setProgress(`正在读取「${w.name}」…`);
        const data = await api(
          `/products/export${fixedOnly ? "?fixed=1" : ""}`,
          { warehouseId: w.id },
        );
        total += data.products.length;
        sheets.push(warehouseSheet({ ...w, name: sheetName(w.name, used) }, data.products));
      }
      setProgress("正在生成 Excel 文件…");
      const { default: writeXlsxFile } = await import("write-excel-file/browser");
      await writeXlsxFile(sheets).toFile(exportFileName());
      setProgress("");
      setDone(`已导出 ${targets.length} 个仓库、共 ${total} 件物料。`);
    }).catch((e) => {
      setProgress("");
      throw e;
    });
  return (
    <div>
      <p>
        选择要导出的仓库，将各仓库的物料信息导出为包含多个工作表的 Excel（.xlsx）文件，每个仓库一张工作表。仅导出启用中的物料，列顺序与批量导入模板一致，可直接回导。
      </p>
      <fieldset className="export-warehouses" disabled={busy}>
        <legend>选择导出仓库</legend>
        {warehouses.map((w) => (
          <label key={w.id}>
            <input
              type="checkbox"
              checked={selected.includes(w.id)}
              onChange={() => toggle(w.id)}
            />
            {w.name}
          </label>
        ))}
      </fieldset>
      <label className="export-fixed-asset">
        <input
          type="checkbox"
          checked={fixedOnly}
          disabled={busy}
          onChange={(e) => setFixedOnly(e.target.checked)}
        />
        只导出固定资产
      </label>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || !selected.length}
        onClick={exportAll}
      >
        导出为 Excel
      </button>
      {progress && <p><LoadingStatus>{progress}</LoadingStatus></p>}
      {done && <p className="template-success" role="status">{done}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export function Backup({ onSaved }) {
  const { busy, error, run, send } = useOperation();
  const [backup, setBackup] = useState(null),
    [preview, setPreview] = useState(null);
  const fileInput = useRef(null);
  const [fileName, setFileName] = useState("");
  return (
    <div className="backup-business">
      {busy && <p><LoadingStatus>正在处理备份…</LoadingStatus></p>}
      <p>
        备份包含全部仓库、物料、库存成本、单据、盘点、往来单位、模板、收付款记录及操作人名称，不包含用户账号、密码和图床凭据。物料图片只备份 URL，图片文件需在图床保留。品质模板包含配置、历史版本和文件引用，原始 Excel 需在 R2 保留。恢复会替换全部业务数据，保留当前账户、登录信息、图床配置、服务器及商户名称，仓库配置随备份恢复。请先下载当前备份。
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
      <div className="file-upload-field" role="group" aria-label="业务备份文件">
        <div className="file-upload-label">选择备份文件</div>
        <input
          ref={fileInput}
          hidden
          aria-label="选择备份文件"
          type="file"
          accept=".json"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setFileName("");
            setBackup(null);
            setPreview(null);
            void run(async () => {
              if (file.size > 95 * 1024 * 1024)
                throw new Error("备份不能超过 95 MB。");
              const value = JSON.parse(await file.text());
              const result = await api("/backup/preview", {
                method: "POST",
                body: { backup: value },
              });
              setFileName(file.name);
              setBackup(value);
              setPreview(result);
            });
          }}
        />
        <button
          type="button"
          className="file-upload-button"
          disabled={busy}
          aria-busy={busy}
          onClick={() => fileInput.current?.click()}
        >
          <span className="file-upload-icon" aria-hidden="true">
            {busy ? <LoadingIndicator size={22} /> : <FileJson size={22} />}
          </span>
          <span className="file-upload-copy">
            <strong>{busy ? "正在处理备份…" : fileName || "选择备份文件"}</strong>
            <span>{busy ? "正在处理，请稍候" : "点击选择 JSON 业务备份文件，最大 95 MB"}</span>
          </span>
          {!busy && <Upload size={18} aria-hidden="true" />}
        </button>
      </div>
      {preview && (
        <>
          <p>
            恢复后出入库二维码将停用，旧标签失效，需核对、启用并重新打印。备份时间：{backup.created_at}；仓库 {preview.warehouses ?? 1} 个，物料 {preview.products} 件，单据{" "}
            {preview.orders} 张，库存调整 {preview.adjustments} 条。往来单位 {preview.contacts ?? 0} 个，模板 {preview.templates ?? 0} 张，收付款 {preview.payments ?? 0} 条，出入库二维码 {preview.stock_qrs ?? 0} 个。
            品质模板 {preview.quality_templates ?? 0} 个，验收单 {preview.quality_acceptances ?? 0} 张，品质图表 {preview.quality_charts ?? 0} 个，R2 Excel 文件引用 {preview.quality_files ?? 0} 个，原文件需在 R2 保留。
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

export function Transfer({ data, warehouses = [], warehouseId, onSaved }) {
  const { can, costs } = usePermissions();
  const { busy, error, run, send } = useOperation();
  const [rows, setRows] = useState([]);
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [records, setRecords] = useState(null);
  const [listError, setListError] = useState("");
  const [voiding, setVoiding] = useState(null);
  const [reason, setReason] = useState("");
  const others = warehouses.filter((w) => w.id !== warehouseId);
  const load = async () => {
    try { setRecords(await api("/transfers")); setListError(""); }
    catch (e) { setListError(e.message); }
  };
  useEffect(() => { load(); }, [warehouseId]);
  useEffect(() => {
    if (target && !others.some((w) => String(w.id) === target)) setTarget("");
  }, [warehouses, warehouseId]);
  const keyword = query.trim().toLowerCase();
  const catalog = useQuery(queryPath('/products', { q: query, limit: 6, status: 'all' }), data, query ? 250 : 0);
  const matches = keyword ? catalog.result?.products || [] : [];
  const add = (product) => {
    setMessage("");
    setRows((prev) => prev.some((r) => r.product_id === product.id)
      ? prev
      : [...prev, { product_id: product.id, name: product.name, unit: product.unit, stock: product.stock, quantity: "1" }]);
    setQuery("");
  };
  const update = (id, value) => setRows((prev) => prev.map((r) => (r.product_id === id ? { ...r, quantity: value } : r)));
  const submit = () => run(async () => {
    if (!target) throw new Error("请选择调入仓库。");
    if (!rows.length) throw new Error("请至少添加一件物料。");
    const items = rows.map((r) => ({ product_id: r.product_id, quantity: parseQuantity(r.quantity, true) }));
    const over = rows.find((r) => Number(r.quantity) > r.stock);
    if (over) throw new Error(`${over.name} 的调拨数量超过当前库存 ${over.stock} ${over.unit}。`);
    const destination = others.find((w) => String(w.id) === target);
    if (!window.confirm(`确认将 ${items.length} 种物料从当前仓库调拨到「${destination.name}」？调拨按移动加权平均成本结转，可在调拨记录中撤销。`)) return;
    const result = await send("/transfers", { to_warehouse_id: Number(target), note, items });
    setRows([]); setNote("");
    setMessage(`调拨完成 · ${result.number}${result.created?.length ? `，已在目标仓库建立 ${result.created.join("、")} 档案` : ""}`);
    await load();
    await onSaved?.("仓库调拨已完成");
  });
  const undo = (record) => run(async () => {
    if (!reason.trim()) throw new Error("请填写撤销原因。");
    if (!window.confirm(`确认撤销调拨 ${record.number}？两个仓库的库存都会恢复。`)) return;
    await send(`/transfers/${record.transfer_id}/void`, { reason });
    setVoiding(null); setReason("");
    await load();
    await onSaved?.("调拨已撤销，库存已恢复");
  });
  return (
    <div>
      {busy && <p><LoadingStatus>正在处理调拨…</LoadingStatus></p>}
      <p>
        在当前仓库选择物料和数量，调入目标仓库；库存按移动加权平均成本结转，两个仓库都会留下调拨单据。目标仓库没有该物料时会自动建立档案（库存为零）。
      </p>
      {!others.length && <div className="info-box">当前只有一个仓库，请先在「基础设置 → 仓库管理」中新增仓库。</div>}
      <div className="form-grid">
        <label>
          调出仓库
          <input value={warehouses.find((w) => w.id === warehouseId)?.name || ""} disabled />
        </label>
        <label>
          调入仓库
          <Select label="调入仓库" aria-label="调入仓库" value={target} disabled={busy || !others.length} onChange={(e) => setTarget(e.target.value)}>
            <option value="">请选择</option>
            {others.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </label>
      </div>
      <label>
        搜索要调拨的物料
        <input value={query} disabled={busy} placeholder="物料名称、条码或规格型号" onChange={(e) => setQuery(e.target.value)} />
      </label>
      {catalog.error && <div role="alert">{catalog.error}<button onClick={catalog.retry}>重新加载</button></div>}
      {matches.map((p) => (
        <div className="operation-row" key={p.id}>
          <div className="stocktake-product"><strong>{p.name}</strong><small>{p.barcode} · 库存 {p.stock} {p.unit}{p.active === 0 ? " · 已停用" : ""}</small></div>
          <button type="button" className="btn" disabled={busy || p.stock <= 0} onClick={() => add(p)}>添加</button>
        </div>
      ))}
      {keyword && !matches.length && <p>未找到匹配的物料。</p>}
      {rows.length > 0 && (
        <div className="operation-scroll">
          <table className="data-table">
            <thead><tr><th>物料</th><th>当前库存</th><th className="number-cell">调拨数量</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.product_id}>
                  <td>{r.name}</td>
                  <td>{r.stock} {r.unit}</td>
                  <td className="number-cell">
                    <input
                      aria-label={`${r.name} 调拨数量`}
                      type="number" min="0" step="0.000001" max={r.stock}
                      value={r.quantity} disabled={busy}
                      onChange={(e) => update(r.product_id, e.target.value)}
                    />
                  </td>
                  <td className="number-cell">
                    <button type="button" className="text-button danger" aria-label={`移除 ${r.name}`} disabled={busy}
                      onClick={() => setRows((prev) => prev.filter((row) => row.product_id !== r.product_id))}>
                      <Trash2 size={14} /> 移除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <label>
        调拨原因
        <input value={note} maxLength={500} disabled={busy} placeholder="例如：门店补货、仓库合并" onChange={(e) => setNote(e.target.value)} />
      </label>
      <button type="button" className="btn btn-primary" disabled={busy || !others.length || !rows.length} onClick={submit}>
        <Truck size={15} /> 确认调拨
      </button>
      {message && <p role="status" className="template-success">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <h3>调拨记录</h3>
      {listError && <p className="form-error" role="alert">{listError}</p>}
      {!records && !listError && <p><LoadingStatus>正在读取调拨记录…</LoadingStatus></p>}
      {records && !records.transfers.length && <p>当前仓库暂无调拨记录。</p>}
      {records?.transfers.map((record) => (
        <div className="operation-row" key={record.id}>
          <div className="stocktake-product">
            <strong>
              {record.direction === "in" ? "调拨入库" : "调拨出库"} · {record.number}
              {record.status === "void" ? " · 已撤销" : ""}
            </strong>
            <small>
              {record.direction === "in" ? `来自 ${record.counterpart_name}` : `发往 ${record.counterpart_name}`}
              {" · "}{new Date(record.created_at).toLocaleString("zh-CN", { hour12: false })}
              {" · "}{record.item_count} 种物料
              {costs && record.cost_cents != null ? ` · 成本 ¥${(record.cost_cents / 100).toFixed(2)}` : ""}
            </small>
            <small>{record.items.map((i) => `${i.name} ${i.quantity}`).join("；")}</small>
            {record.note && <small>原因：{record.note}</small>}
            {record.status === "void" && <small>撤销原因：{record.void_reason}</small>}
          </div>
          {record.status !== "void" && record.direction === "out" && can("transfer") && (
            <button type="button" className="btn" disabled={busy} onClick={() => { setVoiding(record); setReason(""); }}>撤销调拨</button>
          )}
          {voiding?.id === record.id && (
            <div className="operation-row">
              <label>
                撤销原因
                <input value={reason} maxLength={500} disabled={busy} onChange={(e) => setReason(e.target.value)} />
              </label>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => undo(record)}>确认撤销</button>
              <button type="button" className="btn" disabled={busy} onClick={() => setVoiding(null)}>取消</button>
            </div>
          )}
        </div>
      ))}
      {records?.has_more && <p className="muted">仅显示最近 30 条调拨记录。</p>}
    </div>
  );
}
