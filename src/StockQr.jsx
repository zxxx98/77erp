import { useQuery } from './queries.js';
import { lookupProductCode, useProductSelection } from './product-query.js';
import { LoadingIndicator, LoadingStatus } from './Loading.jsx';
import { Select, ContactPicker } from "./Dropdown.jsx";
import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { stockQrPayload, newRequestId } from "./stock-qr-client.js";
import { download } from "./data-files.js";
import "./stock-qr.css";
const money = (n) => `¥${(n / 100).toFixed(2)}`;
const button = "btn";
function Lines({ items }) {
  return (
    <div className="stock-qr-lines">
      {items.map((i) => (
        <div key={i.product_id} className="stock-qr-line">
          <div>
            <strong>{i.name}</strong>
            <small>
              {i.barcode} · 库存 {i.stock} {i.unit}
            </small>
          </div>
          <div>
            {i.quantity} {i.unit} × {money(i.price_cents)}
            <small>{money(i.amount_cents ?? i.quantity * i.price_cents)}</small>
          </div>
        </div>
      ))}
    </div>
  );
}
// Keep complete product names and units readable on exported labels.
function PrintableLabel({ qr, symbol, labelRef }) {
  const wrap = (value, max) => {
    const lines = [];
    let line = "",
      width = 0;
    for (const ch of Array.from(value)) {
      const size = ch.charCodeAt(0) < 128 ? 0.6 : 1;
      if (width + size > max) {
        lines.push(line);
        line = "";
        width = 0;
      }
      line += ch;
      width += size;
    }
    if (line) lines.push(line);
    return lines;
  };
  const textRows = [];
  let y = 24;
  const add = (value, size = 12, max = 30) => {
    for (const text of wrap(value, max)) {
      textRows.push({ text, y, size });
      y += size + 6;
    }
  };
  add(qr.name, 16, 23);
  const qrY = y;
  y += 280;
  add(
    `${qr.warehouse_name} · ${qr.type === "in" ? "入库" : "出库"} · ${qr.require_confirmation ? "需要确认" : "免确认"} · ${qr.items.length} 种物料`,
  );
  for (const item of qr.items) {
    y += 6;
    add(`${item.name} · ${item.quantity} ${item.unit}`);
    add(item.barcode, 11);
  }
  y += 10;
  add("以系统当前配置为准", 11);
  return (
    <svg
      ref={labelRef}
      role="img"
      aria-label="出入库二维码"
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 420 ${y}`}
      width="420"
      height={y}
      className="stock-qr-label"
    >
      <rect width="420" height={y} fill="white" />
      <svg
        x="82"
        y={qrY}
        width="256"
        height="256"
        viewBox={`0 0 ${symbol.size} ${symbol.size}`}
        shapeRendering="crispEdges"
      >
        <rect width={symbol.size} height={symbol.size} fill="white" />
        <path d={symbol.path} fill="black" />
      </svg>
      {textRows.map((row, n) => (
        <text key={n} x="20" y={row.y} fontSize={row.size}>
          {row.text}
        </text>
      ))}
    </svg>
  );
}
export function StockQrManager({
  data,
  initialProduct,
  Modal,
  CameraScanner,
  onClose,
}) {
  const [rows, setRows] = useState([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [type, setType] = useState(""),
    [status, setStatus] = useState("");
  const [selected, setSelected] = useState(null),
    [form, setForm] = useState(null),
    [records, setRecords] = useState(null),
    [recordPage, setRecordPage] = useState(1),
    [recordKind, setRecordKind] = useState("usages");
  const [query, setQuery] = useState(""),
    [camera, setCamera] = useState(false),
    [barcode, setBarcode] = useState(""),
    [symbol, setSymbol] = useState(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    request = useRef({}),
    labelRef = useRef(), barcodeInput = useRef();
  const load = async () => {
    const r = await api(
      `/stock-qrs?page=${page}&type=${type}&status=${status}${initialProduct ? `&product_id=${initialProduct.id}` : ""}`,
    );
    setRows(r.rows);
    setTotal(r.total);
  };
  useEffect(() => {
    let live = true;
    setError("");
    api(
      `/stock-qrs?page=${page}&type=${type}&status=${status}${initialProduct ? `&product_id=${initialProduct.id}` : ""}`,
    )
      .then((r) => {
        if (live) {
          setRows(r.rows);
          setTotal(r.total);
        }
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [page, type, status, initialProduct]);
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
  const send = async (path, method, body) => {
    const key = JSON.stringify([path, method, body]);
    if (request.current.key !== key)
      request.current = { key, id: newRequestId() };
    return api(path, {
      method,
      body: { ...body, request_id: request.current.id },
    });
  };
  const selection = useProductSelection(data, form?.items || [], query, true, initialProduct);
  const contacts = useQuery('/contacts', data);
  data = { ...data, products: selection.products, contacts: contacts.result || [] };
  const line = (p) => ({
    product_id: p.id,
    name: p.name,
    barcode: p.barcode,
    unit: p.unit,
    stock: p.stock,
    quantity: "1",
    price: String(p.cost),
  });
  const edit = (q) => {
    setSelected(q);
    setRecords(null);
    setError("");
    setSymbol(null);
    setForm(
      q
        ? {
            ...q,
            partner: q.partner_name,
            price: undefined,
            items: q.items.map((i) => ({
              ...i,
              quantity: String(i.quantity),
              price: String(i.price_cents / 100),
            })),
          }
        : {
            name: initialProduct ? `${initialProduct.name}入库` : "入库二维码",
            type: "in",
            max_scans: "1",
            require_confirmation: true,
            enabled: true,
            partner: "",
            note: "",
            items: initialProduct ? [line(initialProduct)] : [],
          },
    );
  };
  const add = (p) => {
    selection.remember(p);
    if (form.items.some((i) => i.product_id === p.id)) {
      setError("该物料已在明细中，请编辑已有数量。");
      return;
    }
    if (form.items.length >= 100) {
      setError("最多配置 100 种物料。");
      return;
    }
    setForm({
      ...form,
      items: [
        ...form.items,
        { ...line(p), price: String(form.type === "in" ? p.cost : p.price) },
      ],
    });
    setQuery("");
    setError("");
  };
  const scan = async (raw) => {
    setCamera(false);
    try {
      const p = await lookupProductCode(raw, data);
      if (!p) throw new Error("未找到物料，请先建立物料档案。");
      add(p);
      setBarcode("");
    } catch (e) {
      setError(e.message);
    }
  };
  const updateLine = (id, key, value) =>
    setForm({
      ...form,
      items: form.items.map((i) =>
        i.product_id === id ? { ...i, [key]: value } : i,
      ),
    });
  const save = () =>
    run(async () => {
      if (
        selected &&
        !window.confirm(
          "保存后，已打印的二维码将按新的物料明细和配置执行。确认保存？",
        )
      )
        return;
      const body = {
        name: form.name,
        type: form.type,
        max_scans: form.max_scans === null ? null : Number(form.max_scans),
        require_confirmation: form.require_confirmation,
        enabled: form.enabled,
        partner: form.partner,
        ...(form.partner_id ? { partner_id: form.partner_id } : {}),
        note: form.note,
        items: form.items.map((i) => ({
          product_id: i.product_id,
          quantity: Number(i.quantity),
          price_cents: Math.round(Number(i.price) * 100),
        })),
        ...(selected ? { version: selected.version } : {}),
      };
      if (
        form.items.some(
          (i) =>
            !i.price.trim() ||
            !Number.isFinite(Number(i.price)) ||
            Math.abs(
              Number(i.price) * 100 - Math.round(Number(i.price) * 100),
            ) > 0.00001,
        )
      )
        throw new Error("各物料成交单价最多两位小数。");
      const q = await send(
        selected ? `/stock-qrs/${selected.qr_id}` : "/stock-qrs",
        selected ? "PUT" : "POST",
        body,
      );
      setForm(null);
      setSelected(q);
      await load();
    });
  useEffect(() => {
    if (!selected || form || records) {
      setSymbol(null);
      return;
    }
    let live = true;
    import("./product-code.js")
      .then(({ qrSymbol }) => {
        if (live)
          setSymbol(qrSymbol(stockQrPayload(selected, data.instance_id)));
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [selected, form, records, data.instance_id]);
  const recordLoad = (q, kind, n = 1) =>
    run(async () => {
      const r = await api(`/stock-qrs/${q.qr_id}/${kind}?page=${n}`);
      setSelected(q);
      setForm(null);
      setRecordKind(kind);
      setRecordPage(n);
      setRecords(r);
    });
  const back = () => {
    setSelected(null);
    setForm(null);
    setRecords(null);
    setCamera(false);
    setError("");
  };
  const close = () => {
    if (!busy) onClose();
  };
  const title = form
    ? selected
      ? "编辑出入库二维码"
      : "新建出入库二维码"
    : records
      ? recordKind === "usages"
        ? "使用记录"
        : "配置修改记录"
      : selected
        ? "出入库二维码标签"
        : "管理出入库二维码";
  return (
    <Modal title={title} onClose={close} wide>
      <div className="form-body stock-qr-manager" aria-busy={busy}>
        {busy && <p><LoadingStatus>正在处理出入库二维码…</LoadingStatus></p>}
        {(selected || form) && (
          <button className={button} disabled={busy} onClick={back}>
            返回列表
          </button>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {form ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <fieldset disabled={busy}>
              <label>
                二维码名称
                <input
                  required
                  maxLength={60}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                操作类型
                <Select
                  value={form.type}
                  disabled={!!selected}
                  onChange={(e) => {
                    const t = e.target.value;
                    setForm({
                      ...form,
                      type: t,
                      partner: t === "out" ? "零售客户" : "",
                      partner_id: undefined,
                      items: form.items.map((i) => ({
                        ...i,
                        price: String(
                          data.products.find((p) => p.id === i.product_id)?.[
                            t === "in" ? "cost" : "price"
                          ] ?? 0,
                        ),
                      })),
                    });
                  }}
                >
                  <option value="in">入库</option>
                  <option value="out">出库</option>
                </Select>
              </label>
              <h3>物料明细（{form.items.length}/100）</h3>
              <label>
                搜索添加物料
                <input
                  value={query}
                  placeholder="输入名称或编码"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {(selection.error || contacts.error) && <div role="alert">{selection.error || contacts.error}</div>}
              <div className="stock-qr-options">
                {query &&
                  selection.matches
                    .map((p) => (
                      <button
                        type="button"
                        className={button}
                        key={p.id}
                        onClick={() => add(p)}
                      >
                        {p.name} · {p.barcode}
                      </button>
                    ))}
              </div>
              <div className="stock-qr-actions">
                <button
                  type="button"
                  className={button}
                  onClick={() => setCamera(!camera)}
                >
                  {camera ? "关闭摄像头" : "扫描添加物料"}
                </button>
                <input
                  ref={barcodeInput}
                  aria-label="添加物料条码"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                />
                <button
                  type="button"
                  className={button}
                  onClick={() => scan(barcode)}
                >
                  识别物料
                </button>
              </div>
              {camera && <CameraScanner onResult={scan} onClose={() => setCamera(false)} title="扫码添加物料" note="识别后自动添加到二维码物料明细"
                onManual={() => { setCamera(false); requestAnimationFrame(() => barcodeInput.current?.focus()); }} />}
              {form.items.map((i, index) => (
                <div className="stock-qr-edit-line" key={i.product_id}>
                  <strong>
                    {i.name}{" "}
                    <small>
                      {i.barcode} · 库存 {i.stock} {i.unit}
                    </small>
                  </strong>
                  <label>
                    {i.name} 单次数量（{i.unit}）
                    <input
                      type="number"
                      required
                      min={0.000001}
                      max={99999999}
                      step={0.000001}
                      value={i.quantity}
                      onChange={(e) =>
                        updateLine(i.product_id, "quantity", e.target.value)
                      }
                    />
                  </label>
                  <label>
                    {i.name} 成交单价
                    <input
                      type="number"
                      required
                      min={0}
                      max={99999999}
                      step="0.01"
                      value={i.price}
                      onChange={(e) =>
                        updateLine(i.product_id, "price", e.target.value)
                      }
                    />
                  </label>
                  <span>
                    金额{" "}
                    {money(
                      Math.round(Number(i.quantity) * Number(i.price) * 100),
                    )}
                  </span>
                  {form.type === "out" && Number(i.quantity) > i.stock && (
                    <p className="form-error">
                      当前库存不足，暂时无法整组执行。
                    </p>
                  )}
                  <div className="stock-qr-actions">
                    <button
                      type="button"
                      className={button}
                      disabled={!index}
                      onClick={() => {
                        const items = [...form.items];
                        [items[index - 1], items[index]] = [
                          items[index],
                          items[index - 1],
                        ];
                        setForm({ ...form, items });
                      }}
                    >
                      上移
                    </button>
                    <button
                      type="button"
                      className={button}
                      onClick={() =>
                        setForm({
                          ...form,
                          items: form.items.filter(
                            (j) => j.product_id !== i.product_id,
                          ),
                        })
                      }
                    >
                      移除 {i.name}
                    </button>
                  </div>
                </div>
              ))}
              <p>
                单次总金额：
                {money(
                  form.items.reduce(
                    (s, i) =>
                      s +
                      Math.round(Number(i.quantity) * Number(i.price) * 100),
                    0,
                  ),
                )}
              </p>
              {selected && (
                <p>
                  已使用 {selected.used_scans} 次；修改组合不会清零已用次数。
                </p>
              )}
              <label>
                次数限制
                <Select
                  value={form.max_scans === null ? "unlimited" : "limited"}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      max_scans:
                        e.target.value === "unlimited"
                          ? null
                          : String(Math.max(selected?.used_scans || 0, 1)),
                    })
                  }
                >
                  <option value="limited">限制次数</option>
                  <option value="unlimited">不限次数</option>
                </Select>
              </label>
              {form.max_scans !== null && (
                <label>
                  可扫描次数（累计上限）
                  <input
                    type="number"
                    required
                    min={Math.max(selected?.used_scans || 0, 1)}
                    max={99999999}
                    step={1}
                    value={form.max_scans}
                    onChange={(e) =>
                      setForm({ ...form, max_scans: e.target.value })
                    }
                  />
                </label>
              )}
              <label className="stock-qr-check">
                <input
                  type="checkbox"
                  checked={form.require_confirmation}
                  onChange={(e) =>
                    setForm({ ...form, require_confirmation: e.target.checked })
                  }
                />
                需要二次确认
              </label>
              {!form.require_confirmation && (
                <p className="info-box">
                  扫码后将直接生成整张单据并更新全部物料库存。
                </p>
              )}
              <ContactPicker contacts={(data.contacts || []).filter(c => c.active && c.role === (form.type === "in" ? "supplier" : "customer"))}
                label="往来单位" value={form.partner} selectedId={form.partner_id} required disabled={busy}
                onChange={partner => {
                  const contact = (data.contacts || []).find(c => c.active && c.role === (form.type === "in" ? "supplier" : "customer") && c.name === partner);
                  setForm({ ...form, partner, partner_id: contact?.id });
                }}
                onSelect={contact => setForm({ ...form, partner: contact.name, partner_id: contact.id })} />
              <label>
                单据备注
                <textarea
                  maxLength={500}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </label>
              <label className="stock-qr-check">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) =>
                    setForm({ ...form, enabled: e.target.checked })
                  }
                />
                启用
              </label>
              <button className="btn btn-primary" type="submit">
                保存二维码
              </button>
            </fieldset>
          </form>
        ) : records ? (
          <>
            {!records.rows.length && <p>暂无记录。</p>}
            {records.rows.map((r) => (
              <section className="stock-qr-record" key={r.id}>
                <strong>
                  {r.order
                    ? `${r.order.number} · ${r.order.status === "void" ? "已作废" : "有效"}`
                    : `配置版本 ${r.version}`}
                </strong>
                <p>
                  {r.created_by_name || "操作人未知"} · {r.created_at}
                </p>
                <Lines items={r.snapshot.items} />
              </section>
            ))}
            <div className="stock-qr-actions">
              <button
                className={button}
                disabled={busy || recordPage === 1}
                onClick={() => recordLoad(selected, recordKind, recordPage - 1)}
              >
                上一页
              </button>
              <span>
                第 {recordPage} 页 · 共 {records.total} 条
              </span>
              <button
                className={button}
                disabled={busy || recordPage * 20 >= records.total}
                onClick={() => recordLoad(selected, recordKind, recordPage + 1)}
              >
                下一页
              </button>
            </div>
          </>
        ) : selected ? (
          <>
            <h3>{selected.name}</h3>
            <p>
              {selected.warehouse_name} ·{" "}
              {selected.type === "in" ? "入库" : "出库"} ·{" "}
              {selected.require_confirmation ? "需要二次确认" : "免确认"} · 已用{" "}
              {selected.used_scans}/{selected.max_scans ?? "不限"} 次
            </p>
            {symbol && (
              <PrintableLabel
                qr={selected}
                symbol={symbol}
                labelRef={labelRef}
              />
            )}
            <Lines items={selected.items} />
            <div className="stock-qr-actions">
              <button
                className={button}
                disabled={busy}
                onClick={() => edit(selected)}
              >
                编辑配置
              </button>
              <button
                className={button}
                disabled={!symbol}
                onClick={() =>
                  download(
                    new XMLSerializer().serializeToString(labelRef.current),
                    `${selected.qr_id}-stock-qr.svg`,
                    "image/svg+xml",
                  )
                }
              >
                下载标签
              </button>
              <button
                className={button}
                disabled={busy}
                onClick={() => recordLoad(selected, "usages")}
              >
                查看使用记录
              </button>
              <button
                className={button}
                disabled={busy}
                onClick={() => recordLoad(selected, "revisions")}
              >
                查看修改记录
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="stock-qr-actions">
              <button className="btn btn-primary" onClick={() => edit(null)}>
                新建二维码
              </button>
              <Select
                aria-label="按操作类型筛选"
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">全部类型</option>
                <option value="in">入库</option>
                <option value="out">出库</option>
              </Select>
              <Select
                aria-label="按二维码状态筛选"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">全部状态</option>
                <option value="available">可用</option>
                <option value="exhausted">已用完</option>
                <option value="disabled">已停用</option>
              </Select>
            </div>
            {!rows.length && <p>暂无出入库二维码，请新建并添加物料明细。</p>}
            {rows.map((q) => (
              <section key={q.qr_id} className="stock-qr-record">
                <h3>{q.name}</h3>
                <p>
                  {q.type === "in" ? "入库" : "出库"} · {q.items.length} 种物料
                  · 已用 {q.used_scans}/{q.max_scans ?? "不限"} 次 ·{" "}
                  {q.require_confirmation ? "需要二次确认" : "免确认"} ·{" "}
                  {!q.enabled
                    ? "已停用"
                    : q.remaining_scans === 0
                      ? "已用完"
                      : q.items.some((i) => i.product_changed)
                        ? "物料已变化"
                        : "可用"}
                </p>
                <Lines items={q.items} />
                <div className="stock-qr-actions">
                  <button
                    className={button}
                    onClick={() => {
                      setSelected(q);
                      setError("");
                    }}
                  >
                    查看标签
                  </button>
                  <button className={button} aria-label={`编辑 ${q.name}`} onClick={() => edit(q)}>
                    编辑
                  </button>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await send(`/stock-qrs/${q.qr_id}`, "PUT", {
                          ...q,
                          partner: q.partner_name,
                          enabled: !q.enabled,
                        });
                        await load();
                      })
                    }
                  >
                    {q.enabled ? "停用" : "启用"}
                  </button>
                </div>
              </section>
            ))}
            <div className="stock-qr-actions">
              <button
                className={button}
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                上一页
              </button>
              <span>
                第 {page} 页 · 共 {total} 条
              </span>
              <button
                className={button}
                disabled={page * 20 >= total}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export function StockQrExecution({
  label,
  onLabelDone,
  mode,
  userKey,
  data,
  Modal,
  onSaved,
  onBusy,
}) {
  const storageKey = `77erp-stock-qr-pending:${location.origin}:${data.instance_id}:${userKey}:${data.warehouse_id}`;
  const [preview, setPreview] = useState(null),
    [pending, setPending] = useState(() => {
      try {
        return JSON.parse(localStorage.getItem(storageKey));
      } catch {
        return null;
      }
    }),
    [result, setResult] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false),
    processed = useRef(null);
  const execute = async (task) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      localStorage.setItem(storageKey, JSON.stringify(task));
      setPending(task);
      const r = await api(`/stock-qrs/${task.qr_id}/execute`, {
        method: "POST",
        body: task.body,
        warehouseId: data.warehouse_id,
      });
      setResult(r);
      setPreview(null);
      setPending(null);
      localStorage.removeItem(storageKey);
      onLabelDone();
      try {
        await onSaved(`单据 ${r.number} 已保存`);
      } catch {
        setError("单据已保存，数据刷新失败，请刷新页面。");
      }
    } catch (e) {
      setError(e.message);
      if (e.status >= 400 && e.status < 500 && ![401, 403].includes(e.status)) {
        setPending(null);
        setPreview(null);
        localStorage.removeItem(storageKey);
        onLabelDone();
      }
    } finally {
      lock.current = false;
      setBusy(false);
      onBusy(false);
    }
  };
  const submit = (p) =>
    execute({
      qr_id: p.qr_id,
      preview: p,
      body: {
        preview_token: p.preview_token,
        confirmed: p.require_confirmation,
        request_id: newRequestId(),
      },
    });
  useEffect(() => {
    if (!label || processed.current === label) return;
    processed.current = label;
    if (pending) {
      setError("上次扫码结果未知，请先重试原请求。");
      onLabelDone();
      return;
    }
    let live = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setResult(null);
    api("/stock-qrs/preview", {
      method: "POST",
      body: { label, mode },
      warehouseId: data.warehouse_id,
    })
      .then((p) => {
        if (!live) return;
        setPreview(p);
        setBusy(false);
        onBusy(false);
        if (!p.require_confirmation) void submit(p);
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          onLabelDone();
        }
      })
      .finally(() => {
        if (live && !lock.current) {
          setBusy(false);
          onBusy(false);
        }
      });
    return () => {
      live = false;
    };
  }, [label]);
  const cancel = () => {
    if (!busy) {
      setPreview(null);
      setError("");
      onLabelDone();
    }
  };
  return (
    <>
      {busy && <p><LoadingStatus>正在处理扫码请求…</LoadingStatus></p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {pending && (
        <section className="info-box">
          <p>上次扫码提交结果未知，请重试同一请求，避免重复出入库。</p>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => execute(pending)}
          >
            重试原扫码请求
          </button>
        </section>
      )}
      {result && (
        <section className="stock-qr-record" role="status">
          <strong>单据 {result.number} 已保存</strong>
          <Lines items={result.items} />
          <p>剩余次数：{result.remaining_scans ?? "不限"}</p>
        </section>
      )}
      {preview?.require_confirmation && !pending && (
        <Modal
          title={preview.type === "in" ? "确认入库" : "确认出库"}
          onClose={cancel}
          wide
        >
          <div className="form-body">
            <p>
              {preview.warehouse_name} · {preview.name}
            </p>
            <Lines items={preview.items} />
            <p>
              总金额 {money(preview.total_cents)} · 往来单位：
              {preview.partner_name}
            </p>
            <p>
              备注：{preview.note || "无"} · 剩余次数：
              {preview.remaining_scans ?? "不限"}
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <button className={button} disabled={busy} onClick={cancel}>
              取消
            </button>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => submit(preview)}
              aria-busy={busy}
            >
              {busy && <LoadingIndicator size={20} />}
              {preview.type === "in" ? "确认入库" : "确认出库"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
