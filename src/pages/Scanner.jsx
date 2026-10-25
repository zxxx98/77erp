import { localizeError } from '../i18n/errors.js';
import { t as translate, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Form as AntForm } from 'antd';
import { Button as AntButton, Input as AntInput } from '../ui/controls.jsx';

import { usePermissions } from '../permissions.jsx';
import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { stockQrLabel } from '../stock-qr-client.js';
import { lookupProductCode } from '../product-query.js';
import { PageHeading, Button, Modal, ProductArt, Badge, Panel } from '../components/common.jsx';
import {
  Search,
  ArrowDownToLine,
  ArrowUpFromLine,
  ScanLine,
  Camera,
  ChevronDown,
  ArrowRight,
  TriangleAlert,
  CircleCheck,
  ShieldCheck,
  ChevronRight,
} from 'lucide-react';
import { CameraScanner, StockQrExecution } from '../LazyComponents.jsx';
import { stockStatus, price, money, stockTone, currencySymbol } from '../app/format.js';

function Scanner({ data, openOrder, notify, userKey, isAdmin, manageStockQr, onSaved }) {
  useLocale();
  const { can } = usePermissions();
  const [stockLabel, setStockLabel] = useState(null), [stockBusy, setStockBusy] = useState(false);
  const [mode, setMode] = useState("query"),
    [barcode, setBarcode] = useState(""),
    [camera, setCamera] = useState(false),
    [manual, setManual] = useState(false),
    [selected, setSelected] = useState(null),
    [error, setError] = useState(""),
    [recent, setRecent] = useState([]);
  useEffect(() => {
    if (mode !== 'query' && !can(mode === 'in' ? 'purchase' : 'sale')) { setMode('query'); setCamera(false); setStockLabel(null); }
  }, [mode, data.user]);
  useEffect(() => {
    if (!selected?.id) return;
    const controller = new AbortController();
    api(`/products/${selected.id}`, { warehouseId: data.warehouse_id, signal: controller.signal })
      .then(({ product }) => { if (!controller.signal.aborted) setSelected(product); })
      .catch(error => { if (!controller.signal.aborted) { setSelected(null); setError(localizeError(error.message)); } });
    return () => controller.abort();
  }, [data, selected?.id]);
  const product = selected;
  const scanGeneration = useRef(0);
  useEffect(() => () => { scanGeneration.current++; }, [data.warehouse_id]);
  const input = useRef();
  useEffect(() => {
    if (manual) input.current?.focus();
  }, [manual]);
  const scan = async (code) => {
    if (stockBusy) return;
    const generation = ++scanGeneration.current;
    setCamera(false);
    const operation = stockQrLabel(code);
    if (operation) { setSelected(null); setError(""); setStockLabel(operation); setBarcode(""); return; }
    let p = null;
    try {
      p = await lookupProductCode(code, data);
      if (generation !== scanGeneration.current) return;
    } catch (e) {
      if (generation !== scanGeneration.current) return;
      setError(localizeError(e.message));
      setSelected(null);
      return;
    }
    if (!p) {
      setError(translate("warehouse.the.material.corresponding.to.was.not.found.please.create.a.file", { v0: code.trim() }));
      setSelected(null);
      return;
    }
    setError("");
    setSelected(p);
    setBarcode("");
    setRecent((prev) => [p, ...prev.filter((x) => x.id !== p.id)].slice(0, 4));
    notify(translate("warehouse.recognized", { v0: p.name }));
    if (mode !== "query") openOrder(mode, p);
  };
  return (
    <>
      <PageHeading
        eyebrow="SCAN WORKSPACE"
        title={translate("warehouse.scanning.workbench")}
        description={translate("warehouse.use.the.mobile.phone.camera.to.identify.material.barcodes.or.qr")}
      >
        {isAdmin && <Button onClick={manageStockQr}>{translate("warehouse.manage.incoming.and.outgoing.qr.codes")}</Button>}
        <span className="scanner-ready">
          <i />{translate("warehouse.scan.code.with.mobile.phone.camera")}</span>
      </PageHeading>
      <div className="scanner-layout">
        <section className="panel scanner-main">
          <div className="scanner-mode-tabs">
            {[
              ["query", translate("warehouse.find.items"), Search],
              ["in", translate("warehouse.scan.code.to.store"), ArrowDownToLine],
              ["out", translate("warehouse.scan.the.qr.code.to.exit.the.warehouse"), ArrowUpFromLine],
            ].map(([id, name, Icon]) => (
              <AntButton type="text" htmlType="button"
                key={id}
                hidden={id !== 'query' && !can(id === 'in' ? 'purchase' : 'sale')}
                disabled={stockBusy}
                className={mode === id ? "active" : ""}
                onClick={() => {
                  setMode(id);
                }}
              >
                <Icon size={17} />
                {name}
              </AntButton>
            ))}
          </div>
          <div className="scan-focus-area">
            <div className="big-scanner-icon">
              <ScanLine size={42} strokeWidth={1.4} />
              <span className="big-scan-corner a" />
              <span className="big-scan-corner b" />
            </div>
            <h2>
              {mode === "query"
                ? translate("warehouse.scan.material.barcode")
                : mode === "in"
                  ? translate("warehouse.scan.incoming.materials")
                  : translate("warehouse.scan.outbound.materials")}
            </h2>
            <p>{translate("warehouse.open.the.mobile.phone.camera.and.put.the.material.barcode.or")}</p>
            {mode !== "query" && <p>{translate("warehouse.the.qr.code.for.entering.and.exiting.the.warehouse.without.confirmation")}</p>}
            <Button
              kind="primary"
              icon={Camera}
              className="mobile-scan-button"
              disabled={stockBusy}
              onClick={() => {
                setCamera(!camera);
                setError("");
              }}
            >
              {camera ? translate("warehouse.turn.off.camera") : translate("warehouse.scan.code.with.mobile.phone")}
            </Button>
            {camera && <CameraScanner onResult={scan} onClose={() => setCamera(false)}
              title={mode === 'query' ? translate("warehouse.scan.find.materials") : mode === 'in' ? translate("warehouse.scan.store") : translate("warehouse.scan.delivery")}
              note={mode === 'query' ? translate("warehouse.automatically.return.to.view.materials.after.identification") : translate("warehouse.it.will.automatically.return.after.identification.the.qr.code.for.entering")}
              onManual={() => { setCamera(false); setManual(true); requestAnimationFrame(() => input.current?.focus()); }} />}
            <AntButton type="text" htmlType="button"
              className="manual-entry-toggle"
              onClick={() => setManual(!manual)}
            >
              {manual ? translate("warehouse.close.manual.input") : translate("warehouse.enter.barcode.manually")}
              <ChevronDown size={14} className={manual ? "rotate" : ""} />
            </AntButton>
            {manual && (
              <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }}
                onFinish={() => {

                  if (barcode) scan(barcode);
                }}
                className="scanner-input"
              >
                <ScanLine size={21} />
                <AntInput
                  ref={input}
                  aria-label={translate("warehouse.material.barcode")}
                  placeholder={translate("warehouse.enter.material.barcode")}
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                />
                <AntButton type="default" htmlType="submit" disabled={!barcode || stockBusy}>{translate("warehouse.identify")}<ArrowRight size={16} />
                </AntButton>
              </AntForm>
            )}
            {error && (
              <div className="form-error">
                <TriangleAlert size={16} />
                {error}
              </div>
            )}
          </div>
          <StockQrExecution label={stockLabel} onLabelDone={() => setStockLabel(null)} mode={mode} userKey={userKey} data={data} Modal={Modal} onSaved={onSaved} onBusy={setStockBusy} />
          {product && (
            <div className="scan-result">
              <div className="scan-result-label">
                <CircleCheck size={16} />{translate("warehouse.material.identified")}</div>
              <div className="scan-result-product">
                <ProductArt product={product} size="large" />
                <div>
                  <h3>{product.name}</h3>
                  <p>
                    {product.barcode} · {product.category}
                  </p>
                  <Badge
                    tone={
                      stockTone(product)
                    }
                  >
                    {stockStatus(product)}
                  </Badge>
                </div>
                <div className="scan-result-stock">
                  <small>{translate("warehouse.current.inventory")}</small>
                  <strong>
                    {product.stock}
                    <em> {product.unit}</em>
                  </strong>
                </div>
              </div>
              <div className="scan-result-prices">
                <span>{translate("warehouse.reference.purchase.price")}<strong>{currencySymbol()} {price(product.cost)}</strong>
                </span>
                <span>{translate("warehouse.reference.sales.price")}<strong>{currencySymbol()} {price(product.price)}</strong>
                </span>
              </div>
              <div className="scan-result-actions">
                <Button permission="purchase"
                  icon={ArrowDownToLine}
                  onClick={() => openOrder("in", product)}
                >{translate("warehouse.stock.in")}</Button>
                <Button permission="sale"
                  kind="primary"
                  icon={ArrowUpFromLine}
                  onClick={() => openOrder("out", product)}
                >{translate("warehouse.stock.out")}</Button>
              </div>
            </div>
          )}
        </section>
        <div className="scanner-aside">
          <Panel title={translate("warehouse.scan.code.operation.instructions")} icon={ScanLine}>
            <div className="scan-guide">
              {[
                [
                  "01",
                  translate("warehouse.turn.on.your.phone.camera"),
                  translate("warehouse.click.on.your.phone.to.scan.the.qr.code.and.allow"),
                ],
                [
                  "02",
                  translate("warehouse.select.working.mode"),
                  translate("warehouse.search.enter.or.exit.the.warehouse.and.switch.freely.according.to"),
                ],
                [
                  "03",
                  translate("warehouse.scan.and.confirm"),
                  translate("warehouse.the.material.label.confirms.the.billing.the.business.qr.code.confirms"),
                ],
              ].map(([n, title, desc]) => (
                <div key={n}>
                  <span>{n}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="scan-guide-note">
              <ShieldCheck size={16} />
              <p>{translate("warehouse.the.material.label.only.identifies.the.material.the.qr.code.for")}</p>
            </div>
          </Panel>
          <Panel
            title={translate("warehouse.recently.recognized")}
            extra={<span className="muted">{translate("warehouse.this.session")}</span>}
          >
            {recent.length ? (
              <div className="recent-scans">
                {recent.map((p) => (
                  <AntButton type="default" htmlType="button" key={p.id} onClick={() => scan(p.barcode)}>
                    <ProductArt product={p} size="small" preview={false} />
                    <span>
                      <strong>{p.name}</strong>
                      <small>{p.barcode}</small>
                    </span>
                    <ChevronRight size={14} />
                  </AntButton>
                ))}
              </div>
            ) : (
              <div className="recent-scans-empty">
                <ScanLine size={23} />
                <p>{translate("warehouse.the.scanned.materials.will.appear.here")}</p>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

export { Scanner };
