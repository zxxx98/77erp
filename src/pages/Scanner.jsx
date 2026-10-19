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
import { stockStatus, money, stockTone } from '../app/format.js';

function Scanner({ data, openOrder, notify, userKey, isAdmin, manageStockQr, onSaved }) {
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
      .catch(error => { if (!controller.signal.aborted) { setSelected(null); setError(error.message); } });
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
      setError(e.message);
      setSelected(null);
      return;
    }
    if (!p) {
      setError(`未找到「${code.trim()}」对应的物料，请先在物料管理中建档。`);
      setSelected(null);
      return;
    }
    setError("");
    setSelected(p);
    setBarcode("");
    setRecent((prev) => [p, ...prev.filter((x) => x.id !== p.id)].slice(0, 4));
    notify(`已识别：${p.name}`);
    if (mode !== "query") openOrder(mode, p);
  };
  return (
    <>
      <PageHeading
        eyebrow="SCAN WORKSPACE"
        title="扫码工作台"
        description="使用手机摄像头识别物料条码或二维码标签，进行物料查询、入库或出库。"
      >
        {isAdmin && <Button onClick={manageStockQr}>管理出入库二维码</Button>}
        <span className="scanner-ready">
          <i />
          手机摄像头扫码
        </span>
      </PageHeading>
      <div className="scanner-layout">
        <section className="panel scanner-main">
          <div className="scanner-mode-tabs">
            {[
              ["query", "查找物料", Search],
              ["in", "扫码入库", ArrowDownToLine],
              ["out", "扫码出库", ArrowUpFromLine],
            ].map(([id, name, Icon]) => (
              <button
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
              </button>
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
                ? "扫描物料条码"
                : mode === "in"
                  ? "扫描入库物料"
                  : "扫描出库物料"}
            </h2>
            <p>打开手机摄像头，将物料条码或二维码放入取景框</p>
            {mode !== "query" && <p>免确认出入库二维码将直接执行全部物料。</p>}
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
              {camera ? "关闭摄像头" : "手机扫码"}
            </Button>
            {camera && <CameraScanner onResult={scan} onClose={() => setCamera(false)}
              title={mode === 'query' ? '扫一扫 · 查找物料' : mode === 'in' ? '扫一扫 · 入库' : '扫一扫 · 出库'}
              note={mode === 'query' ? '识别后自动返回查看物料' : '识别后自动返回；免确认出入库二维码会直接更新库存。'}
              onManual={() => { setCamera(false); setManual(true); requestAnimationFrame(() => input.current?.focus()); }} />}
            <button
              className="manual-entry-toggle"
              onClick={() => setManual(!manual)}
            >
              {manual ? "收起手动输入" : "手动输入条码"}
              <ChevronDown size={14} className={manual ? "rotate" : ""} />
            </button>
            {manual && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (barcode) scan(barcode);
                }}
                className="scanner-input"
              >
                <ScanLine size={21} />
                <input
                  ref={input}
                  aria-label="物料条码"
                  placeholder="输入物料条码"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                />
                <button type="submit" disabled={!barcode || stockBusy}>
                  识别
                  <ArrowRight size={16} />
                </button>
              </form>
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
                <CircleCheck size={16} />
                物料已识别
              </div>
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
                  <small>当前库存</small>
                  <strong>
                    {product.stock}
                    <em> {product.unit}</em>
                  </strong>
                </div>
              </div>
              <div className="scan-result-prices">
                <span>
                  参考采购价 <strong>¥ {money(product.cost)}</strong>
                </span>
                <span>
                  参考销售价 <strong>¥ {money(product.price)}</strong>
                </span>
              </div>
              <div className="scan-result-actions">
                <Button permission="purchase"
                  icon={ArrowDownToLine}
                  onClick={() => openOrder("in", product)}
                >
                  采购入库
                </Button>
                <Button permission="sale"
                  kind="primary"
                  icon={ArrowUpFromLine}
                  onClick={() => openOrder("out", product)}
                >
                  销售出库
                </Button>
              </div>
            </div>
          )}
        </section>
        <div className="scanner-aside">
          <Panel title="扫码操作说明" icon={ScanLine}>
            <div className="scan-guide">
              {[
                [
                  "01",
                  "打开手机摄像头",
                  "点击手机扫码，并允许浏览器访问摄像头。",
                ],
                [
                  "02",
                  "选择工作模式",
                  "查找、入库或出库，按当前工作自由切换。",
                ],
                [
                  "03",
                  "扫描并确认",
                  "物料标签确认开单；业务二维码按配置确认整单。",
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
              <p>物料标签只识别物料；免确认出入库二维码会直接更新全部物料库存。</p>
            </div>
          </Panel>
          <Panel
            title="最近识别"
            extra={<span className="muted">本次会话</span>}
          >
            {recent.length ? (
              <div className="recent-scans">
                {recent.map((p) => (
                  <button key={p.id} onClick={() => scan(p.barcode)}>
                    <ProductArt product={p} size="small" preview={false} />
                    <span>
                      <strong>{p.name}</strong>
                      <small>{p.barcode}</small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="recent-scans-empty">
                <ScanLine size={23} />
                <p>扫过的物料会出现在这里</p>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

export { Scanner };
