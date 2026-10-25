import { localizeError } from './i18n/errors.js';
import { ExportLanguageSelect } from './ExportLanguageSelect.jsx';
import { t as translate, getFormatLocale, getLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { currencySymbol, money as formatMoney } from './app/format.js';
import { ConfigProvider as AntConfigProvider } from 'antd';
import { Input as AntInput, Button as AntButton, Checkbox as AntCheckbox } from './ui/controls.jsx';
import { FormField } from './ui/FormField.jsx';

import { orderLabel } from './order-utils.js';
export { orderLabel, businessType, reportOrders } from './order-utils.js';
import { useQuery, usePagedQuery, queryPath } from './queries.js';
import { LoadingIndicator, LoadingStatus } from './Loading.jsx';
import { parseQuantity, addQuantity, materialQuantity, validQuantity } from "../shared/quantity.js";
import { usePermissions } from "./permissions.jsx";
import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, FileJson, FileSpreadsheet, Package, Trash2, Truck, Upload } from "lucide-react";
import { api } from "./api.js";
import { Select } from "./Dropdown.jsx";
import {
  download,
  downloadJSON,
  createImportTemplate,
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
      setError(localizeError(e.message));
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
  useLocale();
  const { busy, error, run, send } = useOperation();
  const [reason, setReason] = useState(""),
    [quantities, setQuantities] = useState({});
  if (order.status === "void")
    return (
      <div className="info-box">{translate("warehouse.obsolete")}{order.void_reason} · {order.voided_at}
      </div>
    );
  if (order.stock_applied === 0)
    return (
      <div className="info-box">{translate("warehouse.demonstration.documents.that.have.been.carried.forward.at.the.beginning.of")}</div>
    );
  const act = (action) =>
    run(async () => {
      if (!reason.trim()) throw new Error(translate("warehouse.please.fill.in.the.reason.for.the.operation"));
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
        throw new Error(translate("warehouse.please.fill.in.the.return.quantity.for.at.least.one.item"));
      if (
        !window.confirm(
          action === "void"
            ? translate("warehouse.confirm.to.void.this.document.and.reverse.inventory.adjustment.the.original")
            : translate("warehouse.confirm.the.return.and.adjust.the.inventory.at.the.original.order"),
        )
      )
        return;
      await send(`/orders/${order.id}/${action}`, {
        reason,
        ...(action === "returns" ? { items } : {}),
      });
      await onSaved(
        action === "void"
          ? translate("warehouse.the.document.has.been.voided.and.the.inventory.has.been.adjusted")
          : translate("warehouse.return.order.has.been.generated.and.inventory.has.been.adjusted"),
      );
    });
  return (
    <section className="operation-panel">
      <h3>{translate("warehouse.document.correction")}</h3>
      {busy && <p><LoadingStatus>{translate("warehouse.processing.document")}</LoadingStatus></p>}
      {order.source_order_id && <p>{translate("warehouse.associated.original.order.id")}{order.source_order_id}</p>}
      <label>{translate("warehouse.reason.for.operation")}<AntInput
          value={reason}
          maxLength={500}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {order.kind === "normal" && (
        <>
          <p>{translate("warehouse.the.original.order.price.will.be.used.for.returns.leaving.the")}</p>
          {order.items.map((i) => (
            <label key={i.product_id}>
              {i.name}{translate("warehouse.refundable")}{" "}{addQuantity(i.quantity, -(i.returned_quantity || 0))}）
              <FormField value={quantities[i.product_id] ?? ""} type="number" min="0" max={addQuantity(i.quantity, -(i.returned_quantity || 0))} label={translate("warehouse.return.quantity", { v0: i.name })}><AntInput
                aria-label={translate("warehouse.return.quantity", { v0: i.name })}
                type="number"
                min="0"
                step="0.0001"
                max={addQuantity(i.quantity, -(i.returned_quantity || 0))}
                value={quantities[i.product_id] ?? ""}
                disabled={busy}
                onChange={(e) =>
                  setQuantities({
                    ...quantities,
                    [i.product_id]: e.target.value,
                  })
                }
              /></FormField>
            </label>
          ))}
          <AntButton type="primary"
            className="btn btn-primary"
            htmlType="button"
            disabled={busy}
            onClick={() => act("returns")}
          >{translate("warehouse.confirm.return")}</AntButton>
        </>
      )}
      <AntButton type="default"
        className="btn"
        htmlType="button"
        disabled={busy}
        onClick={() => act("void")}
      >{translate("warehouse.void.document")}</AntButton>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
export function Stocktake({ data, onSaved }) {
  useLocale();
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
      {busy && <p><LoadingStatus>{translate("warehouse.saving.inventory")}</LoadingStatus></p>}
      <p>{translate("warehouse.check.the.materials.to.be.counted.and.fill.in.the.actual")}</p>
      <label>{translate("warehouse.search.for.inventory.items.2")}<AntInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={busy}
        />
      </label>
      {catalog.error && <div role="alert">{catalog.error}<AntButton type="default" htmlType="button" onClick={catalog.retry}>{translate("warehouse.reload")}</AntButton></div>}
      {catalog.loading && <LoadingStatus>{translate("warehouse.reading.material.2")}</LoadingStatus>}
      <div className="operation-scroll">
        {products
          .filter((p) =>
            `${p.name} ${p.barcode}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .map((p) => (
            <div className="operation-row stocktake-row" key={p.id}>
              <AntCheckbox  checked={!!selected[p.id]} disabled={busy} onChange={(e) => {
                    const next = { ...selected };
                    if (e.target.checked)
                      next[p.id] = {
                        product_id: p.id,
                        name: p.name,
                        expected_stock: p.stock,
                        unit_round_up: p.unit_round_up,
                        counted: String(p.stock),
                      };
                    else delete next[p.id];
                    setSelected(next);
                  }}>

                <div className="stocktake-product"><strong>{p.name}</strong><small>{p.barcode}{" "}{translate("warehouse.accounts")}{" "}{p.stock} {p.unit}</small></div>
              </AntCheckbox>
              {selected[p.id] && (
                <label className="stocktake-count">{translate("warehouse.counted.stock")}<FormField value={selected[p.id].counted} type="number" min="0" label={translate("warehouse.actual.quantity", { v0: p.name })}><AntInput
                    aria-label={translate("warehouse.actual.quantity", { v0: p.name })}
                    type="number"
                    min="0"
                    step="0.0001"
                    value={selected[p.id].counted}
                    onBlur={() => { if (p.unit_round_up && validQuantity(Number(selected[p.id].counted))) setSelected(current => ({ ...current, [p.id]: { ...current[p.id], counted: String(materialQuantity(Number(current[p.id].counted), p)) } })); }}
                    disabled={busy}
                    onChange={(e) =>
                      setSelected({
                        ...selected,
                        [p.id]: { ...selected[p.id], counted: e.target.value },
                      })
                    }
                  /></FormField>
                </label>
              )}
            </div>
          ))}
      </div>
      {catalog.result?.has_more && <AntButton type="default" htmlType="button" className="btn" disabled={catalog.loading} onClick={catalog.loadMore}>{translate("warehouse.load.more.materials")}</AntButton>}
      {items.length > 0 && (
        <p>{translate("warehouse.selected")}{items.length}{translate("warehouse.parts")}{items
            .map(
              (i) =>
                translate("warehouse.difference", { v0: i.name, v1: i.expected_stock, v2: i.counted || translate("warehouse.not.filled.in.2"), v3: i.counted === "" ? translate("warehouse.not.filled.in.2") : addQuantity(Number(i.counted), -i.expected_stock) }),
            )
            .join("；")}
        </p>
      )}
      <label>{translate("warehouse.reasons.for.inventory")}<AntInput
          value={reason}
          maxLength={500}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
          placeholder={translate("warehouse.for.example.month.end.inventory.damage.and.loss")}
        />
      </label>
      <AntButton type="primary"
        htmlType="button"
        className="btn btn-primary"
        disabled={busy || !items.length}
        onClick={() =>
          run(async () => {
            if (!reason.trim()) throw new Error(translate("warehouse.please.fill.in.the.reason.for.the.inventory"));
            items.forEach(i => parseQuantity(i.counted));
            if (
              !window.confirm(
                translate("warehouse.confirm.to.submit.the.inventory.of.materials.and.adjust.the.inventory", { v0: items.length }),
              )
            )
              return;
            await send("/stocktakes", {
              reason,
              items: items.map(({ product_id, expected_stock, counted, unit_round_up }) => ({
                product_id,
                expected_stock,
                counted: materialQuantity(Number(counted), { unit_round_up }),
              })),
            });
            await onSaved(translate("warehouse.the.inventory.has.been.completed.and.the.inventory.has.been.adjusted"));
          })
        }
      >{translate("warehouse.confirm.inventory")}</AntButton>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <details>
        <summary>{translate("warehouse.recent.inventory.adjustments.and.opening.inventory.records.up.to.1.000")}</summary>
        <div className="operation-scroll">
          {history.length ? (
            history.map((h) => (
              <p key={h.id}>
                {h.created_at.slice(0, 19).replace("T", " ")} · {h.name}：
                {h.before_stock} → {h.after_stock} · {h.reason}
              </p>
            ))
          ) : (
            <p>{translate("warehouse.no.records")}</p>
          )}
        </div>
      </details>
    </div>
  );
}
export function ProductImport({ onSaved }) {
  useLocale();
  const [exportLanguage, setExportLanguage] = useState('');
  const { busy, error, run, send } = useOperation();
  const [rows, setRows] = useState(null),
    [preview, setPreview] = useState(null),
    [fileName, setFileName] = useState("");
  const fileInput = useRef(null);
  const readFile = async (file) => {
    if (file.size > 5 * 1024 * 1024)
      throw new Error(translate("warehouse.item.files.cannot.exceed.5.mb"));
    let table;
    if (/\.xlsx$/i.test(file.name)) {
      const { readSheet } = await import("read-excel-file/browser");
      table = await readSheet(file);
    } else if (/\.csv$/i.test(file.name))
      table = parseCSV(await file.text());
    else throw new Error(translate("warehouse.please.select.a.csv.or.xlsx.file"));
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
      <p>{translate("warehouse.supports.first.sheet.of.utf.8.csv.and.excel.xlsx.up")}</p>
      <ExportLanguageSelect value={exportLanguage} onChange={setExportLanguage} disabled={busy} />
      <AntButton type="default"
        htmlType="button"
        className="btn"
        onClick={() =>
          download(
            createImportTemplate(exportLanguage || getLocale()),
            "77ERP-物料导入模板.csv",
            "text/csv;charset=utf-8",
          )
        }
      >{translate("warehouse.download.material.template")}</AntButton>
      <div className="file-upload-field" role="group">
        <div className="file-upload-label">{translate("warehouse.select.material.file")}</div>
        <input
          ref={fileInput}
          hidden
          type="file"
          accept=".csv,.xlsx"
          disabled={busy}
          aria-label={translate("warehouse.select.material.file")}
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
        <AntButton type="text"
          htmlType="button"
          className="file-upload-button"
          disabled={busy}
          aria-busy={busy}
          onClick={() => fileInput.current?.click()}
        >
          <span className="file-upload-icon" aria-hidden="true">
            {busy ? <LoadingIndicator size={22} /> : <FileSpreadsheet size={22} />}
          </span>
          <span className="file-upload-copy">
            <strong>{busy ? translate("warehouse.reading.file") : fileName || translate("warehouse.select.material.file")}</strong>
            <span>
              {busy
                ? translate("warehouse.parsing.and.generating.preview.please.wait")
                : translate("warehouse.click.to.select.file.supports.csv.excel.xlsx")}
            </span>
          </span>
          {!busy && <Upload size={18} aria-hidden="true" />}
        </AntButton>
      </div>
      {rows && (
        <div className="operation-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{translate("warehouse.material")}</th>
                <th>{translate("warehouse.barcode")}</th>
                <th>{translate("warehouse.classification")}</th>
                <th>{translate("warehouse.unit")}</th>
                <th>{translate("warehouse.reference.purchase.price")}</th>
                <th>{translate("warehouse.reference.sales.price")}</th>
                <th>{translate("warehouse.safety.stock")}</th>
                <th>{translate("warehouse.opening.stock")}</th>
                <th>{translate("warehouse.round.quantities.to.whole.units")}</th>
                <th>{translate("warehouse.production.type")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.name}</td>
                  <td>{r.barcode || translate("warehouse.automatically.generated")}</td>
                  <td>{r.category}</td>
                  <td>{r.unit}</td>
                  <td>{r.cost}</td>
                  <td>{r.price}</td>
                  <td>{r.threshold}</td>
                  <td>{r.stock}</td>
                  <td>{r.unit_round_up ? translate("warehouse.yes") : translate("warehouse.no")}</td>
                  <td>{r.production_type || translate("warehouse.not.set")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {preview && (
        <>
          <p>{translate("warehouse.total.2")}{preview.count}{" "}{translate("warehouse.ok")}{preview.errors.length}{" "}{translate("warehouse.line.error.please.check.the.preview.before.confirming")}</p>
          {preview.errors.map((e) => (
            <p className="form-error" key={e.row}>{translate("warehouse.no.2")}{e.row}{" "}{translate("warehouse.line")}{e.error}
            </p>
          ))}
          <AntButton type="primary"
            htmlType="button"
            className="btn btn-primary"
            disabled={busy || !!preview.errors.length}
            onClick={() =>
              run(async () => {
                if (
                  !window.confirm(
                    translate("warehouse.confirm.to.add.items.of.materials.and.register.the.opening.inventory", { v0: rows.length }),
                  )
                )
                  return;
                await send("/products/import", { rows, token: preview.token });
                await onSaved(translate("warehouse.materials.have.been.imported.in.batches"));
              })
            }
          >{translate("warehouse.confirm.import")}</AntButton>
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
  useLocale();
  const [exportLanguage, setExportLanguage] = useState('');
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
      const language = exportLanguage || getLocale();
      const targets = warehouses.filter((w) => selected.includes(w.id));
      if (!targets.length) throw new Error(translate("warehouse.please.select.at.least.one.warehouse"));
      setDone("");
      setProgress(translate("warehouse.reading.warehouse.materials"));
      const used = new Set();
      const sheets = [];
      let total = 0;
      for (const w of targets) {
        setProgress(translate("warehouse.reading.3", { v0: w.name }));
        const data = await api(
          `/products/export${fixedOnly ? "?fixed=1" : ""}`,
          { warehouseId: w.id },
        );
        total += data.products.length;
        sheets.push(warehouseSheet({ ...w, name: sheetName(w.name, used) }, data.products, language));
      }
      setProgress(translate("warehouse.generating.excel.file"));
      const { default: writeXlsxFile } = await import("write-excel-file/browser");
      await writeXlsxFile(sheets).toFile(exportFileName(new Date(), language));
      setProgress("");
      setDone(translate("warehouse.warehouses.and.a.total.of.items.have.been.exported", { v0: targets.length, v1: total }));
    }).catch((e) => {
      setProgress("");
      throw e;
    });
  return (
    <div>
      <p>{translate("warehouse.select.the.warehouse.to.be.exported.and.export.the.material.information")}</p>
      <ExportLanguageSelect value={exportLanguage} onChange={setExportLanguage} disabled={busy} />
      <AntConfigProvider componentDisabled={busy}><fieldset className="export-warehouses" disabled={busy}>
        <legend>{translate("warehouse.select.export.warehouse")}</legend>
        {warehouses.map((w) => (
          <AntCheckbox key={w.id} checked={selected.includes(w.id)} onChange={() => toggle(w.id)}>

            {w.name}
          </AntCheckbox>
        ))}
      </fieldset></AntConfigProvider>
      <AntCheckbox className="export-fixed-asset" checked={fixedOnly} disabled={busy} onChange={(e) => setFixedOnly(e.target.checked)}>{translate("warehouse.only.export.fixed.assets")}</AntCheckbox>
      <AntButton type="primary"
        htmlType="button"
        className="btn btn-primary"
        disabled={busy || !selected.length}
        onClick={exportAll}
      >{translate("warehouse.export.to.excel")}</AntButton>
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
  useLocale();
  const { busy, error, run, send } = useOperation();
  const [backup, setBackup] = useState(null),
    [preview, setPreview] = useState(null);
  const fileInput = useRef(null);
  const [fileName, setFileName] = useState("");
  return (
    <div className="backup-business">
      {busy && <p><LoadingStatus>{translate("warehouse.processing.backup")}</LoadingStatus></p>}
      <p>{translate("warehouse.the.backup.includes.all.warehouses.materials.inventory.costs.documents.inventory.dealing")}</p>
      <AntButton type="default"
        htmlType="button"
        className="btn"
        disabled={busy}
        onClick={() =>
          run(async () =>
            downloadJSON(
              await api("/backup"),
              translate("warehouse.77erp.business.backup.json", { v0: new Date().toISOString().replaceAll(":", "-") }),
            ),
          )
        }
      >{translate("warehouse.download.business.backup")}</AntButton>
      <div className="file-upload-field" role="group" aria-label={translate("warehouse.business.backup.files")}>
        <div className="file-upload-label">{translate("warehouse.select.backup.file")}</div>
        <input
          ref={fileInput}
          hidden
          aria-label={translate("warehouse.select.backup.file")}
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
                throw new Error(translate("warehouse.backups.cannot.exceed.95.mb"));
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
        <AntButton type="text"
          htmlType="button"
          className="file-upload-button"
          disabled={busy}
          aria-busy={busy}
          onClick={() => fileInput.current?.click()}
        >
          <span className="file-upload-icon" aria-hidden="true">
            {busy ? <LoadingIndicator size={22} /> : <FileJson size={22} />}
          </span>
          <span className="file-upload-copy">
            <strong>{busy ? translate("warehouse.processing.backup") : fileName || translate("warehouse.select.backup.file")}</strong>
            <span>{busy ? translate("warehouse.processing.please.wait") : translate("warehouse.click.to.select.json.business.backup.file.maximum.95.mb")}</span>
          </span>
          {!busy && <Upload size={18} aria-hidden="true" />}
        </AntButton>
      </div>
      {preview && (
        <>
          <p>{translate("warehouse.after.restoration.the.qr.code.for.entry.and.exit.will.be")}{backup.created_at}{translate("warehouse.warehouse.3")}{" "}{preview.warehouses ?? 1}{" "}{translate("warehouse.individual.material")}{" "}{preview.products}{" "}{translate("warehouse.piece.document")}{" "}
            {preview.orders}{" "}{translate("warehouse.zhang.inventory.adjustment")}{" "}{preview.adjustments}{" "}{translate("warehouse.article.contact.units")}{" "}{preview.contacts ?? 0}{" "}{translate("warehouse.individual.template")}{" "}{preview.templates ?? 0}{" "}{translate("warehouse.zhang.collection.and.payment")}{" "}{preview.payments ?? 0}{" "}{translate("warehouse.bar.qr.code.for.entry.and.exit")}{" "}{preview.stock_qrs ?? 0}{translate("warehouse.indivual.quality.template")}{preview.quality_templates ?? 0}{" "}{translate("warehouse.acceptance.form")}{" "}{preview.quality_acceptances ?? 0}{" "}{translate("warehouse.zhang.quality.chart")}{" "}{preview.quality_charts ?? 0}{" "}{translate("warehouse.r2.excel.file.reference")}{" "}{preview.quality_files ?? 0}{translate("warehouse.the.original.files.need.to.be.retained.in.r2.bom")}{preview.boms ?? 0}{" "}{translate("warehouse.zhang.scrap.rules")}{" "}{preview.bom_scraps ?? 0}{" "}{translate("warehouse.article.production.order")}{" "}{preview.production_orders ?? 0}{" "}{translate("warehouse.zhang.completed.batch")}{" "}{preview.production_batches ?? 0}{" "}{translate("warehouse.batch.scrap.record")}{" "}{preview.production_scraps ?? 0}{translate("warehouse.article")}</p>
          <AntButton type="primary"
            htmlType="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (
                  !window.confirm(
                    translate("warehouse.are.you.sure.to.replace.all.current.business.data.with.this"),
                  )
                )
                  return;
                await send("/backup/restore", {
                  backup,
                  token: preview.token,
                  current_token: preview.current_token,
                  confirmation: "RESTORE_BUSINESS_DATA",
                });
                await onSaved(translate("warehouse.business.data.has.been.restored.accounts.and.configurations.have.been.retained"));
              })
            }
          >{translate("warehouse.confirm.restore.backup")}</AntButton>
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
  useLocale();
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
      : [...prev, { product_id: product.id, name: product.name, unit: product.unit, unit_round_up: product.unit_round_up, stock: product.stock, quantity: "1" }]);
    setQuery("");
  };
  const update = (id, value) => setRows((prev) => prev.map((r) => (r.product_id === id ? { ...r, quantity: value } : r)));
  const submit = () => run(async () => {
    if (!target) throw new Error(translate("warehouse.please.select.transfer.to.warehouse"));
    if (!rows.length) throw new Error(translate("warehouse.please.add.at.least.one.item"));
    const items = rows.map((r) => ({ product_id: r.product_id, quantity: materialQuantity(parseQuantity(r.quantity, true), r) }));
    const over = rows.find((r) => materialQuantity(parseQuantity(r.quantity, true), r) > r.stock);
    if (over) throw new Error(translate("warehouse.the.allocated.quantity.of.exceeds.the.current.inventory.of", { v0: over.name, v1: over.stock, v2: over.unit }));
    const destination = others.find((w) => String(w.id) === target);
    if (!window.confirm(translate("warehouse.confirm.to.transfer.materials.from.the.current.warehouse.to.transfers.are", { v0: items.length, v1: destination.name }))) return;
    const result = await send("/transfers", { to_warehouse_id: Number(target), note, items });
    setRows([]); setNote("");
    setMessage(translate("warehouse.transfer.completed", { v0: result.number, v1: result.created?.length ? translate("warehouse.the.file.has.been.created.in.the.target.warehouse", { v0: result.created.join("、") }) : "" }));
    await load();
    await onSaved?.(translate("warehouse.warehouse.transfer.completed"));
  });
  const undo = (record) => run(async () => {
    if (!reason.trim()) throw new Error(translate("warehouse.please.fill.in.the.reason.for.cancellation"));
    if (!window.confirm(translate("warehouse.confirm.to.cancel.transfer.inventory.will.be.restored.in.both.warehouses", { v0: record.number }))) return;
    await send(`/transfers/${record.transfer_id}/void`, { reason });
    setVoiding(null); setReason("");
    await load();
    await onSaved?.(translate("warehouse.transfer.canceled.and.inventory.restored"));
  });
  return (
    <div>
      {busy && <p><LoadingStatus>{translate("warehouse.processing.transfer")}</LoadingStatus></p>}
      <p>{translate("warehouse.select.materials.and.quantities.in.the.current.warehouse.and.transfer.them")}</p>
      {!others.length && <div className="info-box">{translate("warehouse.there.is.currently.only.one.warehouse.please.first.add.a.new")}</div>}
      <div className="form-grid">
        <label>{translate("warehouse.transfer.out.warehouse")}<AntInput value={warehouses.find((w) => w.id === warehouseId)?.name || ""} disabled />
        </label>
        <label>{translate("warehouse.transfer.to.warehouse")}<Select label={translate("warehouse.transfer.to.warehouse")} aria-label={translate("warehouse.transfer.to.warehouse")} value={target} disabled={busy || !others.length} onChange={(e) => setTarget(e)}>
            <option value="">{translate("warehouse.please.select")}</option>
            {others.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </label>
      </div>
      <label>{translate("warehouse.search.for.materials.to.be.transferred")}<AntInput value={query} disabled={busy} placeholder={translate("warehouse.material.name.barcode.or.specification.model")} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {catalog.error && <div role="alert">{catalog.error}<AntButton type="default" htmlType="button" onClick={catalog.retry}>{translate("warehouse.reload")}</AntButton></div>}
      {matches.map((p) => (
        <div className="operation-row" key={p.id}>
          <div className="stocktake-product"><strong>{p.name}</strong><small>{p.barcode}{" "}{translate("warehouse.inventory.2")}{" "}{p.stock} {p.unit}{p.active === 0 ? translate("warehouse.deactivated.3") : ""}</small></div>
          <AntButton type="default" htmlType="button" className="btn" disabled={busy || p.stock <= 0} onClick={() => add(p)}>{translate("warehouse.add")}</AntButton>
        </div>
      ))}
      {keyword && !matches.length && <p>{translate("warehouse.no.matching.material.found")}</p>}
      {rows.length > 0 && (
        <div className="operation-scroll">
          <table className="data-table">
            <thead><tr><th>{translate("warehouse.material")}</th><th>{translate("warehouse.current.inventory")}</th><th className="number-cell">{translate("warehouse.transfer.quantity")}</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.product_id}>
                  <td>{r.name}</td>
                  <td>{r.stock} {r.unit}</td>
                  <td className="number-cell">
                    <FormField value={r.quantity} type="number" min="0" max={r.stock} label={translate("warehouse.transfer.quantity.2", { v0: r.name })}><AntInput
                      aria-label={translate("warehouse.transfer.quantity.2", { v0: r.name })}
                      type="number" min="0" step="0.0001" max={r.stock}
                      value={r.quantity} disabled={busy}
                      onChange={(e) => update(r.product_id, e.target.value)}
                    /></FormField>
                  </td>
                  <td className="number-cell">
                    <AntButton type="text" danger htmlType="button" className="text-button danger" aria-label={translate("warehouse.remove", { v0: r.name })} disabled={busy}
                      onClick={() => setRows((prev) => prev.filter((row) => row.product_id !== r.product_id))}>
                      <Trash2 size={14} />{translate("warehouse.remove.2")}</AntButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <label>{translate("warehouse.reason.for.transfer")}<AntInput value={note} maxLength={500} disabled={busy} placeholder={translate("warehouse.for.example.store.replenishment.warehouse.consolidation")} onChange={(e) => setNote(e.target.value)} />
      </label>
      <AntButton type="primary" htmlType="button" className="btn btn-primary" disabled={busy || !others.length || !rows.length} onClick={submit}>
        <Truck size={15} />{translate("warehouse.confirm.transfer")}</AntButton>
      {message && <p role="status" className="template-success">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <h3>{translate("warehouse.transfer.record")}</h3>
      {listError && <p className="form-error" role="alert">{listError}</p>}
      {!records && !listError && <p><LoadingStatus>{translate("warehouse.reading.transfer.records")}</LoadingStatus></p>}
      {records && !records.transfers.length && <p>{translate("warehouse.there.is.currently.no.transfer.record.in.the.warehouse")}</p>}
      {records?.transfers.map((record) => (
        <div className="operation-row" key={record.id}>
          <div className="stocktake-product">
            <strong>
              {record.direction === "in" ? translate("warehouse.transfer.in") : translate("warehouse.transfer.out")} · {record.number}
              {record.status === "void" ? translate("warehouse.canceled") : ""}
            </strong>
            <small>
              {record.direction === "in" ? translate("warehouse.from", { v0: record.counterpart_name }) : translate("warehouse.sent.to", { v0: record.counterpart_name })}
              {" · "}{new Date(record.created_at).toLocaleString(getFormatLocale(), { hour12: false })}
              {" · "}{record.item_count}{translate("warehouse.materials")}{costs && record.cost_cents != null ? translate("warehouse.cost.2", { v0: currencySymbol(), v1: formatMoney(record.cost_cents / 100) }) : ""}
            </small>
            <small>{record.items.map((i) => `${i.name} ${i.quantity}`).join("；")}</small>
            {record.note && <small>{translate("warehouse.reason.2")}{record.note}</small>}
            {record.status === "void" && <small>{translate("warehouse.reason.for.cancellation")}{record.void_reason}</small>}
          </div>
          {record.status !== "void" && record.direction === "out" && can("transfer") && (
            <AntButton type="default" htmlType="button" className="btn" disabled={busy} onClick={() => { setVoiding(record); setReason(""); }}>{translate("warehouse.undo.transfer")}</AntButton>
          )}
          {voiding?.id === record.id && (
            <div className="operation-row">
              <label>{translate("warehouse.reason.for.withdrawal")}<AntInput value={reason} maxLength={500} disabled={busy} onChange={(e) => setReason(e.target.value)} />
              </label>
              <AntButton type="primary" htmlType="button" className="btn btn-primary" disabled={busy} onClick={() => undo(record)}>{translate("warehouse.confirm.revocation")}</AntButton>
              <AntButton type="default" htmlType="button" className="btn" disabled={busy} onClick={() => setVoiding(null)}>{translate("warehouse.cancel")}</AntButton>
            </div>
          )}
        </div>
      ))}
      {records?.has_more && <p className="muted">{translate("warehouse.only.the.last.30.transfer.records.are.shown")}</p>}
    </div>
  );
}
