import { AiAssistant, AiSettings } from './AiAssistant.jsx';
import { LoadingIndicator, LoadingStatus } from './Loading.jsx';
import { orderLineAmount } from "../shared/money.js";
import { CameraScanner } from './CameraScanner.jsx';
import { mobileDevice } from './device.js';
import { PwaProvider } from './pwa/Pwa.jsx';
import { MobileShell, WarehousePicker, DraftList, MobileProductDetail } from './mobile-web/MobileShell.jsx';
import { MobileOrderForm } from './mobile-web/MobileOrderForm.jsx';
import { MobileOrderDetail } from './mobile-web/MobileOrderDetail.jsx';
import { Select } from "./Dropdown.jsx";
import { PermissionContext, usePermissions } from './permissions.jsx';
import { hasPermission, canManage } from '../shared/permissions.js';
import { StockQrManager, StockQrExecution } from './StockQr.jsx';
import { addQuantity, parseQuantity } from "../shared/quantity.js";
import { stockQrLabel } from './stock-qr-client.js';
import React, { useEffect, useId, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  Bell,
  Box,
  Boxes,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  Ellipsis,
  FilePenLine,
  Grid2X2,
  History,
  ImagePlus,
  LayoutDashboard,
  List,
  Minus,
  Package,
  PackageCheck,
  Plus,
  ScanLine,
  Search,
  Settings,
  ShieldCheck,
  TriangleAlert,
  Trash2,
  Warehouse,
  Truck,
  X,
  Camera,
  CircleCheck,
  RefreshCw,
  LogOut,
} from "lucide-react";
import JsBarcode from "jsbarcode";
import "./styles.css";
import { api, getWarehouseId, setWarehouseId } from "./api.js";
import { WarehouseManager, ProductSync } from "./Warehouses.jsx";
import { ProductHistory } from './ProductHistory.jsx';
import { flattenCategories, categoryBranch, readProductImage } from "./catalog.js";
import { ProductImage } from "./ProductImage.jsx";
import { ProductConflict } from './ProductConflict.jsx';
import { ImagebedSettings } from './ImagebedSettings.jsx';
import { NotificationSettings } from './NotificationSettings.jsx';
import { AuthGate } from "./Auth.jsx";
import { resolveProductCode } from "./product-scan.js";
import { ChangePassword, UserManager } from "./Users.jsx";
import { version as appVersion } from "../package.json";
import { BusinessTools, ContactPicker, Templates, Payments, useBusiness } from "./Commerce.jsx";
import { Backup, OrderActions, orderLabel, reportOrders, businessType } from "./Operations.jsx";

const money = (v) =>
  new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
const count = (v) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(v);
const shortDate = (v) =>
  new Date(v).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
const dateTime = (v) =>
  new Date(v).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const todayKey = () => new Date().toLocaleDateString("en-CA");
const sameDay = (a, b) =>
  new Date(a).toDateString() === new Date(b).toDateString();
const stockStatus = (p) =>
  p.stock === 0 ? "缺货" : p.stock <= p.threshold ? "库存偏低" : "库存充足";
const navItems = [
  { id: "overview", name: "工作台", icon: LayoutDashboard },
  { id: "products", name: "物料管理", icon: Box },
  { id: "purchases", name: "采购入库", icon: ArrowDownToLine },
  { id: "sales", name: "销售出库", icon: ArrowUpFromLine },
  { id: "inventory", name: "库存管理", icon: Warehouse },
  { id: "scanner", name: "扫码工作台", icon: ScanLine },
  { id: "history", name: "操作记录", icon: History },
  ...(mobileDevice ? [{ id: 'more', name: '工作空间', icon: Settings }] : []),
];
function Button({
  children,
  icon: Icon,
  kind = "secondary",
  className = "",
  permission,
  busy = false,
  ...props
}) {
  const { can } = usePermissions();
  if (permission && !can(permission)) return null;
  return (
    <button className={`btn btn-${kind} ${className}`} {...props} disabled={props.disabled || busy} aria-busy={busy || undefined}>
      {busy ? <LoadingIndicator size={20} /> : Icon && <Icon size={16} strokeWidth={1.8} />}
      {children}
    </button>
  );
}
function Badge({ children, tone = "green", dot = true }) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <i />}
      {children}
    </span>
  );
}
function ProductArt({ product, size = "normal", preview = true }) {
  if (product.image) return <ProductImage src={product.image} alt={product.name} preview={preview} thumbnailSize={size === 'large' ? 200 : 100} className={`product-art art-${size}`} />;
  const n = product.name;
  const type = /杯/.test(n)
    ? /保温/.test(n)
      ? "bottle"
      : "cup"
    : /笔记本/.test(n)
      ? "book"
      : /线/.test(n)
        ? "cable"
        : /袋|毛巾/.test(n)
          ? "bag"
          : /笔/.test(n)
            ? "pen"
            : /音箱|鼠标/.test(n)
              ? "speaker"
              : "box";
  return (
    <span className={`product-art art-${product.color || "blue"} art-${size}`}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        {type === "cup" && (
          <>
            <path
              d="M13 15h23v17c0 6-23 6-23 0z"
              fill="#f1e6d7"
              stroke="#bcaa91"
              strokeWidth="1.5"
            />
            <ellipse
              cx="24.5"
              cy="15"
              rx="11.5"
              ry="3.5"
              fill="#f9f4ec"
              stroke="#bcaa91"
              strokeWidth="1.5"
            />
            <ellipse cx="24.5" cy="15" rx="8" ry="1.8" fill="#d3c1a8" />
            <path
              d="M36 19h3c7 0 7 12-3 12"
              fill="none"
              stroke="#bcaa91"
              strokeWidth="2.5"
            />
            <path d="M17 20v11" stroke="#fff" strokeWidth="2" opacity=".8" />
          </>
        )}
        {type === "bottle" && (
          <>
            <rect x="18" y="8" width="14" height="5" rx="2" fill="#8fadb7" />
            <rect x="17" y="13" width="16" height="28" rx="5" fill="#aec3cb" />
            <path d="M20 17v18" stroke="#e9f4f7" strokeWidth="2" />
            <path d="M17 32h16" stroke="#93aeb8" strokeWidth="1.5" />
          </>
        )}
        {type === "book" && (
          <>
            <path d="M12 12l22-3 3 28-22 3z" fill="#819b85" />
            <path
              d="M14 10l22-3 3 28-22 3z"
              fill="#a9bfa8"
              stroke="#748e78"
              strokeWidth="1"
            />
            <path d="M18 10l3 28" stroke="#64856c" strokeWidth="2" />
            <path
              d="M23 17l11-1m-10 5 11-1"
              stroke="#e5eee3"
              strokeWidth="1.5"
            />
            <path d="M16 39l22-3" stroke="#e9eee5" strokeWidth="2" />
          </>
        )}
        {type === "cable" && (
          <>
            <path
              d="M29 13c-18-5-20 15-9 20 10 5 18-6 12-11-8-7-18 6-8 12"
              fill="none"
              stroke="#9c91bb"
              strokeWidth="2.5"
            />
            <rect x="27" y="9" width="8" height="7" rx="2" fill="#8373a8" />
            <rect x="26" y="33" width="6" height="7" rx="1.5" fill="#8373a8" />
            <path d="M30 8v-3m-2 36v3" stroke="#b3adbc" strokeWidth="3" />
          </>
        )}
        {type === "bag" && (
          <>
            <path
              d="M13 18h23l3 22H10z"
              fill="#d4c3a6"
              stroke="#b4a389"
              strokeWidth="1"
            />
            <path
              d="M18 21v-8a6 6 0 0 1 12 0v8"
              fill="none"
              stroke="#b4a389"
              strokeWidth="2"
            />
            <path d="M22 28h8m-8 3h5" stroke="#af9b7c" strokeWidth="1.5" />
          </>
        )}
        {type === "pen" && (
          <>
            <path d="M15 35 30 9l5 3-15 26-6 3z" fill="#7e9a91" />
            <path d="m29 10 3-5 5 3-3 5" fill="#bbcfc7" />
            <path d="m18 35 14-23" stroke="#d2e1da" strokeWidth="1.5" />
            <path d="m14 41 2-7 4 3z" fill="#445d54" />
          </>
        )}
        {type === "speaker" && (
          <>
            <rect x="10" y="15" width="30" height="23" rx="7" fill="#819ca8" />
            <rect x="12" y="17" width="26" height="18" rx="5" fill="#a8bec8" />
            {[18, 23, 28, 33].map((x) => (
              <path
                key={x}
                d={`M${x} 21v10`}
                stroke="#6e8c9b"
                strokeWidth="1"
                strokeDasharray="1 2"
              />
            ))}
            <path
              d="M23 12h5"
              stroke="#819ca8"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </>
        )}
        {type === "box" && (
          <>
            <path d="m11 17 14-7 14 7-14 8z" fill="#dfbfc5" stroke="#b99098" />
            <path d="m11 17 14 8v16l-14-8z" fill="#d3a9b1" />
            <path d="m25 25 14-8v16l-14 8z" fill="#c799a3" />
            <path
              d="m18 13 14 8v8"
              fill="none"
              stroke="#f8e6e9"
              strokeWidth="3"
            />
          </>
        )}
      </svg>
    </span>
  );
}
function Barcode({ value, height = 45 }) {
  const ref = useRef();
  useEffect(() => {
    try {
      JsBarcode(ref.current, value, {
        format: "CODE128",
        height,
        width: 1.5,
        margin: 8,
        fontSize: 12,
        font: "monospace",
        background: "#ffffff",
        lineColor: "#17243c",
      });
    } catch {}
  }, [value, height]);
  return <svg ref={ref} className="barcode" aria-label={`条码 ${value}`} />;
}
function Modal({ title, subtitle, children, onClose, wide = false, className = "", headerActions }) {
  const titleId = useId();
  const ref = useRef();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const old = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focusing the dialog keeps mobile keyboards closed until a field is tapped.
    const first = mobileDevice ? ref.current :
      ref.current.querySelector("[data-autofocus]") ||
      [...ref.current.querySelectorAll("input:not(:disabled)")].find((el) => el.offsetParent !== null) ||
      ref.current.querySelector("button:not(:disabled)");
    first?.focus({ preventScroll: mobileDevice });
    const key = (e) => {
      if ([...document.querySelectorAll('.modal[role="dialog"]')].at(-1) !== ref.current) return;
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const targets = [
          ...ref.current.querySelectorAll(
            "button, input, select, textarea, a[href]",
          ),
        ].filter((el) => !el.matches(":disabled") && el.tabIndex >= 0 && el.offsetParent !== null);
        const first = targets[0],
          last = targets.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    const back = event => {
      if (event.defaultPrevented || document.querySelector('.image-viewer, .camera-scanner-immersive')) return;
      if ([...document.querySelectorAll('.modal[role="dialog"]')].at(-1) !== ref.current) return;
      event.preventDefault();
      closeRef.current();
    };
    if (mobileDevice) window.addEventListener('erp:back-modal', back);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key);
      window.removeEventListener('erp:back-modal', back);
      old?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <section
        ref={ref}
        className={`modal ${wide ? "modal-wide" : ""} ${className}`}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <div className="modal-header-title">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <div className="modal-header-actions">
          {headerActions}
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="关闭弹窗"
          >
            <X size={20} />
          </button>
          </div>
        </div>
        {children}
      </section>
    </div>
  );
}
function ProductCodeModal({ product, warehouseId, sourceId, onClose, notify, manageStockQr }) {
  const [format, setFormat] = useState("barcode");
  const [qr, setQr] = useState(null);
  const codeRef = useRef(null);
  useEffect(() => {
    setQr(null);
    if (format !== "qr") return;
    let alive = true;
    import("./product-code.js").then(({ productQrPayload, qrSymbol }) => {
      if (alive) setQr(qrSymbol(productQrPayload(product, product.warehouse_id ?? warehouseId, sourceId)));
    }).catch(error => {
      if (alive) setQr({ error: error.message || "二维码生成失败，请刷新后重试。" });
    });
    return () => { alive = false; };
  }, [format, product, warehouseId, sourceId]);
  const download = async () => {
    try {
      const svg = codeRef.current?.querySelector("svg");
      if (!svg) throw new Error("标签尚未生成，请重试。");
      await downloadFile(
        new XMLSerializer().serializeToString(svg),
        `${product.barcode}${format === "qr" ? "-qr" : ""}.svg`,
        "image/svg+xml",
      );
      notify(format === "qr" ? "二维码标签已下载" : "条码标签已下载");
    } catch (error) { notify(error.message); }
  };
  return (
    <Modal title="物料条码" subtitle="打印或下载物料标签" onClose={onClose} className="product-code-modal" headerActions={
      <div className="code-format-switch" role="group" aria-label="标签类型">
        <button type="button" aria-pressed={format === "barcode"} onClick={() => setFormat("barcode")}>条形码</button>
        <button type="button" aria-pressed={format === "qr"} onClick={() => setFormat("qr")}>二维码</button>
      </div>
    }>
      <div className="barcode-detail">
        <ProductArt product={product} size="large" />
        <h3>{product.name}</h3>
        <div ref={codeRef} className="product-code-symbol">
          {format === "barcode" ? <Barcode value={product.barcode} height={70} /> : !qr ? (
            <div className="product-qr-loading" role="status"><LoadingIndicator size={64} />正在生成二维码…</div>
          ) : qr.error ? (
            <div className="form-error" role="alert">{qr.error}</div>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="product-qr" width="256" height="256" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={`二维码 ${product.barcode}`} shapeRendering="crispEdges">
              <title>{product.name} · {product.barcode}</title>
              <rect width={qr.size} height={qr.size} fill="#fff" />
              <path d={qr.path} fill="#000" />
            </svg>
          )}
        </div>
        {format === "qr" && <p className="product-code-number">{product.barcode}</p>}
        <p>{format === "qr" ? "包含物料编码、名称、单位和仓库信息" : `CODE 128 · ${product.category}`}</p>
      </div>
      <div className="modal-footer">
        {manageStockQr && <Button onClick={manageStockQr}>出入库二维码</Button>}
        <Button onClick={onClose}>关闭</Button>
        <Button kind="primary" icon={Download} disabled={format === "qr" && (!qr || !!qr.error)} onClick={download}>下载标签</Button>
      </div>
    </Modal>
  );
}
function Empty({
  title = "暂无记录",
  description = "新的记录会出现在这里。",
  action,
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Package size={27} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function PageHeading({ eyebrow, title, description, children }) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
function Panel({
  title,
  icon: Icon,
  extra,
  children,
  className = "",
  subtitle,
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>
            {Icon && <Icon size={16} />} {title}
          </h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}
function App({ admin, onLogout }) {
  const isAdmin = admin.role === "admin";
  const initial = location.hash.slice(1).split("?")[0];
  const [page, setPage] = useState(
    navItems.some((n) => n.id === initial) ? initial : "overview",
  );
  const [data, setData] = useState({
    products: [],
    categories: [],
    warehouses: [],
    orders: [],
    settings: { business_name: "七七商贸", warehouse_name: "主仓库" },
  });
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState(() => {
    const destination = new URLSearchParams(location.search).get('manage');
    if (destination === 'data') return { kind: 'businessTools', initialTab: 'import' };
    if (destination === 'multi-stocktake') return { kind: 'businessTools', initialTab: 'multi-stocktake' };
    if (destination === 'backup' && isAdmin) return { kind: 'settings', section: 'data' };
    return null;
  }),
    [toast, setToast] = useState(null),
    [search, setSearch] = useState("");
  const [notification, setNotification] = useState(false),
    [inventoryFilter, setInventoryFilter] = useState("all");
  const [cameraActive, setCameraActive] = useState(false);
  useEffect(() => {
    const changed = event => setCameraActive(event.detail);
    window.addEventListener('erp:camera-active', changed);
    return () => window.removeEventListener('erp:camera-active', changed);
  }, []);
  const mobileOverlayOpen = !!modal || cameraActive;
  useEffect(() => {
    if (!mobileDevice || !mobileOverlayOpen) return;
    const marker = `77erp-modal-${Date.now()}`;
    history.pushState({ ...history.state, erpModal: marker }, '', location.href);
    const back = () => {
      const event = new Event('erp:back-modal', { cancelable: true });
      if (window.dispatchEvent(event)) setModal(null);
      else history.pushState({ ...history.state, erpModal: marker }, '', location.href);
    };
    window.addEventListener('popstate', back);
    return () => {
      window.removeEventListener('popstate', back);
      if (history.state?.erpModal === marker) history.back();
    };
  }, [mobileOverlayOpen]);
  const [loggingOut, setLoggingOut] = useState(false);
  const logout = async () => {
    setLoggingOut(true);
    try {
      await onLogout();
    } catch (e) {
      notify(e.message);
      setLoggingOut(false);
    }
  };
  const searchRef = useRef();
  const loadGeneration = useRef(0);
  const [switching, setSwitching] = useState(false);
  const loadWorkspace = async (attempt = 0) => {
    const generation = ++loadGeneration.current;
    setRefreshing(true);
    try {
      let d;
      try { d = await api("/data"); }
      catch (e) {
        if (e.status !== 400 || !e.message.startsWith('仓库不存在')) throw e;
        d = await api('/data', { warehouseId: 1 });
      }
      if (generation !== loadGeneration.current) return;
      if (d.user?.id !== admin.id) {
        window.dispatchEvent(new Event('erp:unauthorized'));
        return;
      }
      setWarehouseId(d.warehouse_id);
      setData(d);
      setLoadError("");
    } catch (e) {
      if (generation !== loadGeneration.current) return;
      setLoadError(e.message);
      // A read that fails right after connectivity returns recovers by itself,
      // instead of waiting for the user to press 重新连接.
      if (!e.status && navigator.onLine && attempt < 1)
        setTimeout(() => { if (generation === loadGeneration.current) void loadWorkspace(attempt + 1); }, 800);
    } finally {
      if (generation === loadGeneration.current) { setLoading(false); setRefreshing(false); }
    }
  };
  const reload = () => loadWorkspace(0);
  useEffect(() => {
    reload();
    const onHash = () => {
      const id = location.hash.slice(1).split("?")[0];
      if (navItems.some((n) => n.id === id)) setPage(id);
    };
    window.addEventListener("hashchange", onHash);
    const key = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    const refreshPermissions = () => { if (document.visibilityState === 'visible') reload(); };
    window.addEventListener('focus', refreshPermissions);
    const onVisible = () => { if (document.visibilityState === 'visible') refreshPermissions(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refreshPermissions);
    const timer = !isAdmin ? setInterval(refreshPermissions, 30000) : null;
    return () => { window.removeEventListener('focus', refreshPermissions); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', refreshPermissions); if (timer) clearInterval(timer); };
  }, [isAdmin]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);
  const navigate = (id, filter) => {
    setPage(id);
    location.hash = id;
    setNotification(false);
    if (filter) setInventoryFilter(filter);
    window.scrollTo({ top: 0 });
  };
  const notify = (message, type = "success") => setToast({ message, type });
  const saved = async (message) => {
    setModal(null);
    notify(message);
    await reload();
  };
  const switchWarehouse = async (id) => {
    if (switching || modal && modal.kind !== 'warehousePicker' || id === getWarehouseId()) return;
    const generation = ++loadGeneration.current;
    setSwitching(true);
    try {
      const workspace = await api('/data', { warehouseId: id });
      if (generation !== loadGeneration.current) return;
      if (workspace.user?.id !== admin.id) {
        window.dispatchEvent(new Event('erp:unauthorized'));
        return;
      }
      setWarehouseId(id);
      setData(workspace);
      setSearch(''); setNotification(false); setInventoryFilter('all'); setLoadError('');
    } catch (e) { notify(e.message, 'error'); }
    finally { setSwitching(false); setRefreshing(false); }
  };
  const user = data.user || admin;
  const can = key => hasPermission(user, key);
  const manage = key => canManage(user, key);
  const low = data.products.filter((p) => p.active !== 0 && p.stock <= p.threshold);
  // Order details are fetched by id so trimmed or paged lists stay correct.
  const openOrderDetail = async (order) => {
    const id = typeof order === "number" ? order : order?.id;
    if (!id) return;
    if (typeof order === "object" && order?.items) { setModal({ kind: "detail", order }); return; }
    try {
      const { order: full } = await api(`/orders/${id}`);
      setModal({ kind: "detail", order: full });
    } catch (e) { notify(e.message, "error"); }
  };
  const openOrder = (type, product, template) => {
    if (!can(type === 'in' ? 'purchase' : 'sale')) { notify('没有此操作的权限，请联系管理员。', 'error'); return; }
    setModal({ kind: 'order', type, product, template });
  };
  const reduceStock = (product) => {
    if (!can('stocktake')) { notify('没有此操作的权限，请联系管理员。', 'error'); return; }
    setModal({ kind: 'reduce', product });
  };
  const currentNav = navItems.find((n) => n.id === page);
  return (
    <PermissionContext.Provider value={user}><div className="app-shell">
      {switching && <div className="warehouse-switch-loading" role="status"><LoadingIndicator size={48} />正在切换仓库…</div>}
      {mobileDevice ? <div inert={!!modal} aria-hidden={modal ? true : undefined}><MobileShell user={user} data={data} page={page} navigate={navigate} openModal={setModal} openOrder={openOrder}
        showProduct={product => setModal({ kind: 'productDetail', product })} showOrder={openOrderDetail}
        switchWarehouse={switchWarehouse} loading={loading} switching={switching} loadError={loadError} reload={reload} refreshing={refreshing}
        loggingOut={loggingOut} logout={logout}
        renderScanner={() => <Scanner data={data} openOrder={openOrder} notify={notify} userKey={admin.id || admin.username} isAdmin={manage('business')} onSaved={async message => { notify(message); await reload(); }} manageStockQr={() => setModal({ kind: 'stockQr' })} />}
      /></div> : <>
      <aside className="sidebar" inert={switching}>
        <a
          className="brand"
          href="#overview"
          onClick={() => navigate("overview")}
        >
          <span className="brand-mark">
            <svg viewBox="0 0 40 40">
              <path d="M8 12h11l-7 17m10-17h10l-7 17" />
            </svg>
          </span>
          <div>
            <strong>
              77 <span>ERP</span>
            </strong>
            <small>轻量进销存</small>
          </div>
        </a>
        <button
          className="workspace-selector"
          onClick={() => setModal({ kind: "settings" })}
        >
          <span className="workspace-icon">
            <Warehouse size={18} />
          </span>
          <span>
            <strong>{data.settings.business_name}</strong>
            <small>我的工作空间</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="nav-label">日常管理</div>
        <nav aria-label="主导航">
          {navItems.slice(0, 5).map(({ id, name, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              aria-label={name}
              title={name}
              className={`nav-item ${page === id ? "active" : ""}`}
              onClick={() => navigate(id)}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span>{name}</span>
              {id === "inventory" && low.length > 0 && (
                <b className="nav-count">{low.length}</b>
              )}
              {id === "overview" && page === id && (
                <i className="nav-active-dot" />
              )}
            </a>
          ))}
        </nav>
        <div className="nav-label second-label">效率工具</div>
        <nav aria-label="效率工具">
          {navItems.slice(5, 7).map(({ id, name, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              aria-label={name}
              title={name}
              className={`nav-item ${page === id ? "active" : ""}`}
              onClick={() => navigate(id)}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span>{name}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span className="tip-icon">
              <ScanLine size={19} />
            </span>
            <strong>扫码管理</strong>
            <p>使用手机摄像头识别物料条码。</p>
            <button onClick={() => navigate("scanner")}>
              打开扫码工作台 <ArrowRight size={13} />
            </button>
          </div>
          <button className="nav-item" onClick={() => setModal({ kind: 'businessTools' })}>
            <History size={18} /><span>业务管理</span>
          </button>
          {can('ai') && <button className="nav-item" onClick={() => setModal({ kind: 'ai' })}><Settings size={18} /><span>AI 助手</span></button>}
          {isAdmin && <button className="nav-item" aria-label="系统设置" title="系统设置" onClick={() => setModal({ kind: 'settings' })}>
            <Settings size={18} /><span>系统设置</span>
          </button>}
          <button
            className="user-profile"
            onClick={() => setModal({ kind: "account" })}
          >
            <span className="avatar">{admin.username.slice(0, 1).toUpperCase()}</span>
            <span>
              <strong>{admin.username}</strong>
              <small>{isAdmin ? "管理员" : "员工"}</small>
            </span>
            <Ellipsis size={18} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar" inert={switching}>
          <div className="breadcrumb">
            <span>工作空间</span>
            <ChevronRight size={13} />
            <strong>{currentNav?.name}</strong>
          </div>
          <div className="topbar-right">
            <Select className="warehouse-select" aria-label="当前仓库" value={data.warehouse_id || 1} disabled={switching || !!modal || loading} onChange={e => switchWarehouse(Number(e.target.value))}>
              {(data.warehouses || []).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
            <div className="sync-state">
              <i />
              数据已同步
            </div>
            <form
              className="global-search"
              onSubmit={(e) => {
                e.preventDefault();
                navigate("products");
              }}
            >
              <Search size={16} />
              <input
                ref={searchRef}
                aria-label="搜索物料或条码"
                placeholder="搜索物料、条码…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd>⌘ K</kbd>
            </form>
            <div className="notification-wrap">
              <button
                className={`icon-button notification-button ${notification ? "selected" : ""}`}
                aria-label="库存提醒"
                onClick={() => setNotification(!notification)}
              >
                <Bell size={19} />
                {low.length > 0 && <i />}
              </button>
              {notification && (
                <div className="notification-popover">
                  <div className="popover-title">
                    <strong>库存提醒</strong>
                    <span>{low.length} 条</span>
                  </div>
                  {low.length ? (
                    low.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => navigate("inventory", "warning")}
                      >
                        <span
                          className={`notice-icon ${p.stock === 0 ? "red" : ""}`}
                        >
                          <TriangleAlert size={17} />
                        </span>
                        <span>
                          <strong>{p.name}</strong>
                          <small>
                            剩余 {p.stock} {p.unit} · {stockStatus(p)}
                          </small>
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    ))
                  ) : (
                    <p className="popover-empty">所有物料库存充足</p>
                  )}
                  <div className="popover-footer">
                    按物料设置的安全库存实时提醒
                  </div>
                </div>
              )}
            </div>
            <button
              className="icon-button help-button"
              aria-label="使用帮助"
              onClick={() => setModal({ kind: "help" })}
            >
              <CircleHelp size={19} />
            </button>
            <span className="topbar-divider" />
            <button
              className="avatar avatar-small"
              aria-label={isAdmin ? "商户设置" : "账户设置"}
              onClick={() => setModal({ kind: isAdmin ? "settings" : "account" })}
            >
              {admin.username.slice(0, 1).toUpperCase()}
            </button>
            <button
              className="icon-button logout-button"
              aria-label="退出登录"
              title="退出登录"
              onClick={logout}
              disabled={loggingOut}
              aria-busy={loggingOut}
            >
              {loggingOut ? <LoadingIndicator size={20} /> : <LogOut size={18} />}
            </button>
          </div>
        </header>
        <main key={data.warehouse_id || 1} className="main-content" inert={switching}>
          {loading ? (
            <div className="loading-page" role="status">
              <LoadingIndicator size={64} />
              <p>正在加载数据…</p>
            </div>
          ) : loadError ? (
            <div className="load-error">
              <TriangleAlert size={32} />
              <h2>暂时无法获取数据</h2>
              <p>{loadError}</p>
              <Button icon={RefreshCw} onClick={reload}>
                重新加载
              </Button>
            </div>
          ) : (
            <>
              {page === "overview" && (
                <Dashboard
                  data={data}
                  low={low}
                  navigate={navigate}
                  openOrder={openOrder}
                  showDetail={openOrderDetail}
                />
              )}
              {page === "products" && (
                <Products
                  data={data}
                  isAdmin={manage('products')}
                  onCategoriesChanged={reload}
                  onSaved={saved}
                  search={search}
                  setSearch={setSearch}
                  showProduct={(product) => setModal({ kind: "productDetail", product })}
                  edit={(product) => setModal({ kind: "product", product })}
                  barcode={(product) => setModal({ kind: "barcode", product })}
                />
              )}
              {page === "inventory" && (
                <Inventory
                  data={data}
                  filter={inventoryFilter}
                  setFilter={setInventoryFilter}
                  openOrder={openOrder}
                  openTransfer={() => setModal({ kind: "businessTools", initialTab: "transfer" })}
                  reduceStock={reduceStock}
                  showProduct={(product) => setModal({ kind: "productDetail", product })}
                  showBarcode={(product) =>
                    setModal({ kind: "barcode", product })
                  }
                />
              )}
              {["purchases", "sales", "history"].includes(page) && (
                <Orders
                  page={page}
                  data={data}
                  openOrder={openOrder}
                  showDetail={openOrderDetail}
                  notify={notify}
                />
              )}
              {page === "scanner" && (
                <Scanner data={data} openOrder={openOrder} notify={notify} userKey={admin.id || admin.username} isAdmin={manage('business')} onSaved={async message => { notify(message); await reload(); }} manageStockQr={() => setModal({kind:"stockQr"})} />
              )}
              <footer className="page-footer">
                <span>
                  <span className="footer-brand">77 ERP</span> 进销存管理系统
                </span>
                <span>
                  <ShieldCheck size={13} /> 本地数据存储 <i /> v{appVersion}
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
      </>}
      {mobileDevice && modal?.kind === 'warehousePicker' && <WarehousePicker data={data} switchWarehouse={switchWarehouse} onClose={() => setModal(null)} Modal={Modal} />}
      {mobileDevice && modal?.kind === 'drafts' && <DraftList data={data} userId={user.id} Modal={Modal} onClose={() => setModal(null)} onOpen={draft => setModal({ kind: 'order', type: draft.type, draft })} />}
      {modal?.kind === 'categories' && manage('products') && <CategoryManager categories={data.categories || []} onChanged={reload} onClose={() => setModal(null)} />}
      {can('products') && modal?.kind === "product" && (
        <ProductForm
          product={modal.product}
          categories={data.categories || []}
          units={data.settings.units}
          warehouses={data.warehouses || []}
          warehouseId={data.warehouse_id}
          onClose={() => setModal(null)}
          onSaved={saved}
        />
      )}
      {modal?.kind === "order" && can(modal.type === 'in' ? 'purchase' : 'sale') && (
        mobileDevice ? <MobileOrderForm type={modal.type} initialProduct={modal.product} initialTemplate={modal.template} initialDraft={modal.draft} data={data} userId={user.id}
          key={modal.draft?.id || modal.template?.id || 'new-order'} Modal={Modal} CameraScanner={CameraScanner} onClose={() => setModal(null)} onSaved={saved} /> : <OrderForm
          type={modal.type}
          initialProduct={modal.product}
          initialTemplate={modal.template}
          key={modal.template?.id || "new-order"}
          data={data}
          onClose={() => setModal(null)}
          onSaved={saved}
        />
      )}
      {modal?.kind === "detail" && (
        mobileDevice ? <MobileOrderDetail order={modal.order} Modal={Modal} onClose={() => setModal(null)} onSaved={saved} /> : <OrderDetail isAdmin={isAdmin} order={modal.order} onClose={() => setModal(null)} onSaved={saved} />
      )}
      {modal?.kind === "reduce" && can('stocktake') && (
        <ReduceStockModal
          product={modal.product}
          onClose={() => setModal(null)}
          onSaved={saved}
        />
      )}
      {manage('business') && modal?.kind === "stockQr" && <StockQrManager data={data} initialProduct={modal.product} Modal={Modal} CameraScanner={CameraScanner} onClose={() => setModal(null)} />}
      {modal?.kind === "productDetail" && (mobileDevice ? <MobileProductDetail product={data.products.find(p => p.id === modal.product.id) || modal.product} data={data} Modal={Modal} openOrder={openOrder} openModal={setModal} openOrderDetail={openOrderDetail} onClose={() => setModal(null)} onSaved={saved} /> : <ProductDetail product={modal.product} warehouseName={data.settings.warehouse_name} onViewOrder={openOrderDetail} onClose={() => setModal(null)} />)}
      {modal?.kind === "barcode" && (
        <ProductCodeModal
          product={modal.product}
          warehouseId={data.warehouse_id || 1}
          sourceId={data.instance_id}
          manageStockQr={manage('business') ? () => setModal({kind:"stockQr",product:modal.product}) : undefined}
          onClose={() => setModal(null)}
          notify={notify}
        />
      )}
      {can('ai') && modal?.kind === 'ai' && <Modal title="AI 助手" subtitle="库存与业务，随时问我" className="ai-modal" wide onClose={() => setModal(null)}><AiAssistant userId={user.id} warehouseName={data.settings.warehouse_name} onChanged={reload} /></Modal>}
      {modal?.kind === "account" && <Modal title="账户设置" onClose={() => setModal(null)}><div className="form-body"><p>{admin.username} · {isAdmin ? '管理员' : '员工'}</p><ChangePassword onChanged={onLogout} /></div></Modal>}
      {modal?.kind === 'businessTools' && <Modal title="业务管理" subtitle="管理业务资料、财务、盘点与物料导入" wide className="business-modal" onClose={() => setModal(null)}>
        <div className="form-body"><BusinessTools products={data.products} warehouses={data.warehouses} warehouseId={data.warehouse_id} onSaved={saved} initialTab={modal.initialTab}
          onUse={template => openOrder(template.type, undefined, template)} onRefresh={reload} /></div>
        <div className="modal-footer"><Button onClick={() => setModal(null)}>取消</Button></div>
      </Modal>}
      {isAdmin && modal?.kind === "settings" && (
        <SettingsForm
          onPasswordChanged={onLogout}
          initialSection={modal.section}
          settings={data.settings}
          warehouses={data.warehouses || []}
          onRefresh={reload}
          onClose={() => setModal(null)}
          onSaved={saved}
        />
      )}
      {modal?.kind === "help" && (
        <Modal
          title="使用说明"
          subtitle="物料建档、条码识别和单据确认"
          onClose={() => setModal(null)}
        >
          <div className="help-content">
            {[
              [
                Box,
                "01",
                "建立物料档案",
                "添加名称、参考采购价、参考销售价和安全库存。条码可选填，留空保存时自动生成。",
              ],
              [
                ScanLine,
                "02",
                "扫码，找到物料",
                "在扫码工作台打开手机摄像头，将物料条码放入取景框。也可手动输入条码查询。",
              ],
              [
                PackageCheck,
                "03",
                "确认入库或出库",
                "添加数量并确认单据，库存自动更新，每一笔操作都有记录。",
              ],
            ].map(([Icon, number, title, text]) => (
              <div className="help-step" key={number}>
                <span>
                  <Icon size={22} />
                </span>
                <div>
                  <small>STEP {number}</small>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </div>
            ))}
            <div className="info-box">
              <ShieldCheck size={18} />
              <p>
                当前为单仓库本地版本，无登录权限。演示单据用于体验；正式使用前请备份或使用新的数据库。摄像头需
                HTTPS 或 localhost。
              </p>
            </div>
          </div>
          <div className="modal-footer">
            <Button
              kind="primary"
              onClick={() => {
                setModal(null);
                navigate("products");
              }}
            >
              前往物料管理 <ArrowRight size={15} />
            </Button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className={`toast toast-${toast.type}`} role="status">
          {toast.type === "success" ? (
            <CircleCheck size={19} />
          ) : (
            <TriangleAlert size={19} />
          )}
          <span>{toast.message}</span>
          <button aria-label="关闭通知" onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}
    </div></PermissionContext.Provider>
  );
}

function TrendChart({ orders, days }) {
  const [hover, setHover] = useState(null);
  const chartRef = useRef();
  const [chartWidth, setChartWidth] = useState(720);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setChartWidth(Math.max(220, entry.contentRect.width)),
    );
    observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, []);
  const series = Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - days + i + 1);
    return {
      date: d,
      in: orders
        .filter((o) => o.type === "in" && sameDay(o.created_at, d))
        .reduce((s, o) => s + o.total, 0),
      out: orders
        .filter((o) => o.type === "out" && sameDay(o.created_at, d))
        .reduce((s, o) => s + o.total, 0),
    };
  });
  const max = Math.max(...series.flatMap((d) => [d.in, d.out]), 1000);
  const cap = Math.ceil(max / 1000) * 1000;
  const floor = Math.floor(Math.min(0, ...series.flatMap(d => [d.in, d.out])) / 1000) * 1000;
  const W = chartWidth,
    H = chartWidth < 450 ? 160 : 178,
    L = 40,
    R = 14,
    T = 12,
    B = 29;
  const x = (i) => L + (i * (W - L - R)) / (days - 1),
    y = (v) => T + (1 - (v - floor) / (cap - floor)) * (H - T - B);
  const smooth = (points) => {
    let path = `M${points[0][0]},${points[0][1]}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1],
        p = points[i];
      const mid = (prev[0] + p[0]) / 2;
      path += ` C${mid},${prev[1]} ${mid},${p[1]} ${p[0]},${p[1]}`;
    }
    return path;
  };
  const out = smooth(series.map((d, i) => [x(i), y(d.out)])),
    incoming = smooth(series.map((d, i) => [x(i), y(d.in)]));
  const fractions =
    chartWidth < 450 ? [0, 1 / 3, 2 / 3, 1] : [0, 0.2, 0.4, 0.6, 0.8, 1];
  const labels = Array.from(
    new Set(fractions.map((f) => Math.round((days - 1) * f))),
  );
  return (
    <div className="chart-wrap" ref={chartRef}>
      <svg
        className="trend-chart"
        style={{ height: H }}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`最近 ${days} 天采购与销售金额趋势`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity=".13" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((n) => (
          <g key={n}>
            <line
              x1={L}
              x2={W - R}
              y1={y(floor + ((cap - floor) * n) / 4)}
              y2={y(floor + ((cap - floor) * n) / 4)}
              stroke="#edf0f5"
              strokeDasharray={n === 0 ? "0" : "3 4"}
            />
            <text
              x={L - 12}
              y={y(floor + ((cap - floor) * n) / 4) + 4}
              textAnchor="end"
              fill="#929aaa"
              fontSize="10"
            >
              {floor + ((cap - floor) * n) / 4 >= 1000
                ? `${(floor + ((cap - floor) * n) / 4 / 1000).toFixed(1)}k`
                : floor + ((cap - floor) * n) / 4}
            </text>
          </g>
        ))}
        <path
          d={`${out} L${x(days - 1)},${y(0)} L${x(0)},${y(0)} Z`}
          fill="url(#chart-fill)"
        />
        <path
          d={incoming}
          fill="none"
          stroke="#91b7ed"
          strokeWidth="2"
          strokeDasharray="5 5"
        />
        <path
          d={out}
          fill="none"
          stroke="#3478ee"
          strokeWidth="2.8"
          strokeLinecap="round"
        />
        {labels.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 7}
            fontSize="10"
            fill="#929aaa"
            textAnchor="middle"
          >
            {shortDate(series[i].date)}
          </text>
        ))}
        {series.map((d, i) => (
          <rect
            key={i}
            x={x(i) - (W - L - R) / (days - 1) / 2}
            y={T}
            width={(W - L - R) / (days - 1)}
            height={H - T - B}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
        {hover !== null && series[hover] && (
          <g pointerEvents="none">
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={T}
              y2={y(0)}
              stroke="#adc8ef"
              strokeDasharray="3 3"
            />
            <circle
              cx={x(hover)}
              cy={y(series[hover].out)}
              r="4"
              fill="#2563eb"
              stroke="white"
              strokeWidth="2"
            />
            <circle
              cx={x(hover)}
              cy={y(series[hover].in)}
              r="3.5"
              fill="#91b7ed"
              stroke="white"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>
      {hover !== null && series[hover] && (
        <div
          className="chart-tooltip"
          style={{
            left: `${Math.min(76, Math.max(12, (hover / (days - 1)) * 100))}%`,
          }}
        >
          <strong>{shortDate(series[hover].date)}</strong>
          <span>
            <i className="legend-dot blue" />
            销售 ¥{money(series[hover].out)}
          </span>
          <span>
            <i className="legend-dot pale" />
            采购 ¥{money(series[hover].in)}
          </span>
        </div>
      )}
    </div>
  );
}
function Dashboard({ data, low, navigate, openOrder, showDetail }) {
  const { can, costs } = usePermissions();
  const [days, setDays] = useState(7),
    [orderTab, setOrderTab] = useState("all");
  const reporting = reportOrders(data.orders);
  const todayOrders = reporting.filter((o) =>
    sameDay(o.created_at, new Date()),
  );
  const incoming = todayOrders.filter((o) => o.type === "in"),
    outgoing = todayOrders.filter((o) => o.type === "out");
  const totalStock = data.products.reduce((s, p) => addQuantity(s, p.stock), 0),
    value = data.products.reduce((s, p) => s + (p.inventory_value_cents ?? Math.round(p.stock * p.cost * 100)) / 100, 0);
  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - days + 1);
  periodStart.setHours(0, 0, 0, 0);
  const salesSum = reporting
    .filter((o) => o.type === "out" && new Date(o.created_at) >= periodStart)
    .reduce((s, o) => s + o.total, 0);
  const filteredOrders = data.orders
    .filter((o) => orderTab === "all" || businessType(o) === orderTab)
    .slice(0, 5);
  const metrics = [
    {
      label: "物料总数",
      value: count(data.products.length),
      unit: "种",
      icon: Box,
      tone: "blue",
      footer: (
        <>
          <span className="metric-info">在库物料</span>
          <strong>{count(totalStock)}</strong>
          <span className="metric-info">件</span>
        </>
      ),
    },
    {
      label: "库存总金额",
      value: costs ? money(value) : '—',
      prefix: "¥",
      icon: Warehouse,
      tone: "purple",
      footer: (
        <>
          <span className="metric-info">按采购成本统计</span>
          <span className="metric-tail">{data.settings.warehouse_name}</span>
        </>
      ),
    },
    {
      label: "今日采购",
      value: money(incoming.reduce((s, o) => s + o.total, 0)),
      prefix: "¥",
      icon: ArrowDownLeft,
      tone: "green",
      footer: (
        <>
          <Badge tone="green" dot={false}>
            <ArrowDownLeft size={12} />
            {incoming.length} 笔入库
          </Badge>
          <span className="metric-info">已完成</span>
        </>
      ),
    },
    {
      label: "今日销售",
      value: money(outgoing.reduce((s, o) => s + o.total, 0)),
      prefix: "¥",
      icon: ArrowUpRight,
      tone: "orange",
      footer: (
        <>
          <Badge tone="blue" dot={false}>
            <ArrowUpRight size={12} />
            {outgoing.length} 笔出库
          </Badge>
          <span className="metric-info">已完成</span>
        </>
      ),
    },
  ];
  return (
    <>
      <PageHeading
        title="工作台"
        description="物料、库存及今日入出库数据概览。"
      >
        <span className="date-chip">
          <CalendarDays size={15} />
          {new Date().toLocaleDateString("zh-CN", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
          <span className="date-weekday">
            {new Date().toLocaleDateString("zh-CN", { weekday: "short" })}
          </span>
        </span>
        <Button permission="purchase" kind="primary" icon={Plus} onClick={() => openOrder("in")}>
          新建入库
        </Button>
      </PageHeading>
      <div className="metric-grid">
        {metrics.map((m) => (
          <section className="metric-card" key={m.label}>
            <div className="metric-top">
              <span>{m.label}</span>
              <span className={`metric-icon icon-${m.tone}`}>
                <m.icon size={18} />
              </span>
            </div>
            <div className="metric-value">
              {m.prefix && <span className="currency">{m.prefix}</span>}
              {m.value}
              {m.unit && <span className="metric-unit">{m.unit}</span>}
            </div>
            <div className="metric-footer">{m.footer}</div>
          </section>
        ))}
      </div>
      <div className="dashboard-middle">
        <Panel
          title="采购与销售趋势"
          subtitle="按日期统计采购与销售金额"
          className="trend-panel"
          extra={
            <div className="segmented small">
              <button
                className={days === 7 ? "active" : ""}
                onClick={() => setDays(7)}
              >
                近 7 天
              </button>
              <button
                className={days === 30 ? "active" : ""}
                onClick={() => setDays(30)}
              >
                近 30 天
              </button>
            </div>
          }
        >
          <div className="trend-summary">
            <span className="trend-amount">
              <span>¥</span>
              {money(salesSum)}
              <small>期间销售额</small>
            </span>
            <div className="chart-legend">
              <span>
                <i className="legend-dot blue" />
                销售金额
              </span>
              <span>
                <i className="legend-dot pale" />
                采购金额
              </span>
            </div>
          </div>
          <TrendChart orders={reporting} days={days} />
        </Panel>
        <section className="quick-panel">
          <div className="quick-panel-heading">
            <span className="quick-label">
              <ScanLine size={13} /> 快捷操作
            </span>
          </div>
          <div className="quick-hero">
            <div>
              <h2>手机扫码</h2>
              <p>使用手机摄像头查询物料及办理入出库。</p>
            </div>
            <div className="phone-scan-illustration" aria-hidden="true">
              <div className="phone-scan-frame">
                <Camera size={20} />
                <ScanLine size={36} />
              </div>
              <span className="phone-scan-check">
                <Check size={14} />
              </span>
            </div>
          </div>
          <button
            className="quick-scan-button"
            onClick={() => navigate("scanner")}
          >
            <ScanLine size={18} />
            打开扫码工作台
            <ArrowRight size={16} />
          </button>
          <div className="quick-action-row">
            <button hidden={!can("purchase")} onClick={() => openOrder("in")}>
              <span className="quick-action-icon green">
                <ArrowDownToLine size={17} />
              </span>
              采购入库
              <ChevronRight size={13} />
            </button>
            <i />
            <button hidden={!can("sale")} onClick={() => openOrder("out")}>
              <span className="quick-action-icon blue">
                <ArrowUpFromLine size={17} />
              </span>
              销售出库
              <ChevronRight size={13} />
            </button>
          </div>
        </section>
      </div>
      <div className="dashboard-bottom">
        <Panel
          title="最近单据"
          className="recent-panel"
          extra={
            <button className="text-button" onClick={() => navigate("history")}>
              查看全部
              <ArrowRight size={14} />
            </button>
          }
        >
          <div className="inline-tabs">
            {[
              ["all", "全部单据"],
              ["in", "采购入库"],
              ["out", "销售出库"],
            ].map(([id, name]) => (
              <button
                key={id}
                className={orderTab === id ? "active" : ""}
                onClick={() => setOrderTab(id)}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="table-scroll">
            <table className="data-table recent-table">
              <thead>
                <tr>
                  <th>单据信息</th>
                  <th>往来单位</th>
                  <th className="number-cell">金额</th>
                  <th>状态</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => showDetail(o)}
                    className="clickable-row"
                  >
                    <td>
                      <div className="order-info">
                        <span
                          className={`order-icon ${o.type === "in" ? "green" : "blue"}`}
                        >
                          {o.type === "in" ? (
                            <ArrowDownLeft size={17} />
                          ) : (
                            <ArrowUpRight size={17} />
                          )}
                        </span>
                        <div>
                          <strong className="order-number">{o.number}</strong>
                          <small>
                            {orderLabel(o)}
                            <span>·</span>
                            {dateTime(o.created_at)}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>{o.partner}</td>
                    <td className="number-cell amount-cell">
                      ¥ {money(o.total)}
                    </td>
                    <td>
                      <Badge>已完成</Badge>
                    </td>
                    <td>
                      <button
                        className="table-arrow"
                        aria-label={`查看 ${o.number}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          showDetail(o);
                        }}
                      >
                        <ChevronRight size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filteredOrders.length && <Empty />}
          </div>
        </Panel>
        <Panel
          title="库存预警"
          className="warning-panel"
          extra={<span className="warning-counter">{low.length} 件物料</span>}
        >
          <div className="warning-description">
            <span className="warning-dot" />
            当前库存低于或等于安全库存的物料。
          </div>
          <div className="warning-list">
            {low.length ? (
              low.slice(0, 4).map((p) => (
                <div className="warning-item" key={p.id}>
                  <ProductArt product={p} />
                  <div className="warning-item-info">
                    <strong>{p.name}</strong>
                    <small>
                      安全库存 {p.threshold} {p.unit}
                    </small>
                  </div>
                  <div className="warning-stock">
                    <strong
                      className={p.stock === 0 ? "red-text" : "orange-text"}
                    >
                      {p.stock}
                      <small> {p.unit}</small>
                    </strong>
                    <span>{p.stock === 0 ? "已缺货" : "库存偏低"}</span>
                  </div>
                  <button
                    className="restock-button"
                    hidden={!can("purchase")} onClick={() => openOrder("in", p)}
                    aria-label={`补货 ${p.name}`}
                  >
                    <Plus size={15} />
                  </button>
                </div>
              ))
            ) : (
              <Empty
                title="暂无库存预警"
                description="所有物料都在安全库存以上。"
              />
            )}
          </div>
          <button
            className="warning-all-button"
            onClick={() => navigate("inventory", "warning")}
          >
            查看库存预警
            <ArrowRight size={14} />
          </button>
          <div className="warning-bottom">
            <ShieldCheck size={13} />
            库存变化实时更新
          </div>
        </Panel>
      </div>
    </>
  );
}

function CategoryTree({ categories, products, selected, onSelect }) {
  const [collapsed, setCollapsed] = useState(new Set());
  const render = (parent = null, depth = 0) => categories.filter(c => c.parent_id === parent).map(c => {
    const children = categories.some(child => child.parent_id === c.id);
    const branch = categoryBranch(categories, c.id);
    const total = products.filter(p => branch.has(p.category_id)).length;
    return <li key={c.id}>
      <div className="category-tree-row" style={{ paddingLeft: depth * 14 }}>
        {children ? <button className="category-expand" aria-label={`${collapsed.has(c.id) ? '展开' : '折叠'} ${c.name}`} aria-expanded={!collapsed.has(c.id)} onClick={() => setCollapsed(current => { const next = new Set(current); next.has(c.id) ? next.delete(c.id) : next.add(c.id); return next; })}>{collapsed.has(c.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button> : <span className="category-expand" />}
        <button className={`category-select ${selected === c.id ? 'active' : ''}`} aria-pressed={selected === c.id} onClick={() => onSelect(c.id)}><span>{c.name}</span><small>{total}</small></button>
      </div>
      {children && !collapsed.has(c.id) && <ul>{render(c.id, depth + 1)}</ul>}
    </li>;
  });
  return <nav aria-label="物料分类树" className="category-tree">
    <button className={`category-select ${selected === null ? 'active' : ''}`} aria-pressed={selected === null} onClick={() => onSelect(null)}><span>全部物料</span><small>{products.length}</small></button>
    <ul>{render()}</ul>
    {!categories.length && <p className="muted">暂无分类，请添加分类。</p>}
  </nav>;
}

function CategoryManager({ categories, onClose, onChanged }) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const options = flattenCategories(categories);
  const excluded = categoryBranch(categories, Number(id));
  const choose = value => {
    const c = categories.find(c => c.id === Number(value));
    setId(value); setName(c?.name || ''); setParent(c?.parent_id || ''); setError('');
  };
  const run = async action => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); await onChanged(); choose(''); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <Modal title="管理物料分类" subtitle="建立多级分类；选择上级分类即可添加子分类。" onClose={busy ? () => {} : onClose}>
    <form onSubmit={e => { e.preventDefault(); void run(() => api(id ? `/categories/${id}` : '/categories', { method: id ? 'PUT' : 'POST', body: { name, parent_id: parent ? Number(parent) : null } })); }}>
      <fieldset className="form-body category-form" disabled={busy}>
        <label>编辑分类<Select value={id} onChange={e => choose(e.target.value)}><option value="">新增分类</option>{options.map(c => <option key={c.id} value={c.id}>{c.path}</option>)}</Select></label>
        <label>分类名称 <span>*</span><input required maxLength={100} value={name} placeholder="例如：电线" onChange={e => setName(e.target.value)} /></label>
        <label>上级分类<Select value={parent} onChange={e => setParent(e.target.value)}><option value="">无（一级分类）</option>{options.filter(c => !excluded.has(c.id)).map(c => <option key={c.id} value={c.id}>{c.path}</option>)}</Select></label>
        <small className="muted">选中父分类会包含下级物料。删除前需移走该分类的下级分类及物料。</small>
        {error && <div className="form-error" role="alert">{error}</div>}
      </fieldset>
      <div className="modal-footer">
        {id && <Button type="button" disabled={busy} onClick={() => { if (window.confirm(`确定删除分类「${name}」？`)) void run(() => api(`/categories/${id}/delete`, { method: 'POST', body: {} })); }}>删除分类</Button>}
        <Button type="button" disabled={busy} onClick={onClose}>完成</Button>
        <Button type="submit" kind="primary" busy={busy}>{busy ? '正在保存…' : '保存分类'}</Button>
      </div>
    </form>
  </Modal>;
}

function Products({ data, search, setSearch, edit, showProduct, barcode, onCategoriesChanged, onSaved, isAdmin }) {
  const { can } = usePermissions();
  const [status, setStatus] = useState("active");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const actionLock = useRef(false);
  const changeProduct = async (product, remove = false) => {
    if (actionLock.current) return;
    const active = product.active === 0 ? 1 : 0;
    const message = remove
      ? `确定删除「${product.name}」？删除无法恢复，仅允许删除库存为零且没有单据、盘点和模板关联的物料。仅影响当前仓库。`
      : `确定${active ? "启用" : "停用"}「${product.name}」？${active ? "启用后恢复普通开单选品。" : "停用后普通开单选品默认隐藏，库存和历史记录保留，可从库存页面开单清库存。"}仅影响当前仓库。`;
    if (!window.confirm(message)) return;
    actionLock.current = true;
    setBusy(true); setActionError("");
    try {
      await api(`/products/${product.id}${remove ? "" : "/status"}`, { method: remove ? "DELETE" : "POST", body: remove ? {} : { active } });
      await onSaved(remove ? "物料已删除" : active ? "物料已启用" : "物料已停用");
    } catch (e) { setActionError(e.message); }
    finally { actionLock.current = false; setBusy(false); }
  };
  const lifecycleActions = (p) => isAdmin && <>
    <button className="text-button" disabled={busy} aria-label={`${p.active === 0 ? "启用" : "停用"} ${p.name}`} onClick={() => changeProduct(p)}>{p.active === 0 ? "启用" : "停用"}</button>
    <button className="text-button product-delete" disabled={busy} aria-label={`删除 ${p.name}`} onClick={() => changeProduct(p, true)}>删除</button>
  </>;
  const [category, setCategory] = useState(null),
    [view, setView] = useState("list"),
    [pageNum, setPageNum] = useState(1);
  const [managing, setManaging] = useState(false);
  const categories = data.categories || [];
  const branch = categoryBranch(categories, category);
  useEffect(() => { if (category && !categories.some(c => c.id === category)) setCategory(null); }, [categories, category]);
  const filtered = data.products.filter(
    (p) =>
      (status === "all" || (status === "active" ? p.active !== 0 : p.active === 0)) &&
      (category === null || branch.has(p.category_id)) &&
      (!search ||
        [p.name, p.barcode, p.category, p.specification || "", p.note || ""].some((s) =>
          s.toLowerCase().includes(search.toLowerCase()),
        )),
  );
  useEffect(() => setPageNum(1), [category, search, status]);
  useEffect(() => setPageNum(p => Math.min(p, Math.max(1, Math.ceil(filtered.length / 8)))), [filtered.length]);
  const visible = filtered.slice((pageNum - 1) * 8, pageNum * 8);
  return (
    <>
      <PageHeading
        eyebrow="MATERIALS"
        title="物料管理"
        description="按分类维护物料图片、规格型号、价格及备注。"
      >
        <Button permission="products" kind="primary" icon={Plus} onClick={() => edit(null)}>
          新增物料
        </Button>
      </PageHeading>
      {busy && <p><LoadingStatus>正在更新物料…</LoadingStatus></p>}
      {actionError && <div className="info-box" role="alert">{actionError}</div>}
      <div className="catalog-layout">
        <aside className="panel category-sidebar">
          <h3>物料分类</h3>
          <CategoryTree categories={categories} products={data.products} selected={category} onSelect={setCategory} />
        </aside>
      <section className="panel products-panel">
        <div className="table-toolbar">
          {isAdmin && <Button onClick={() => setManaging(true)}>管理分类</Button>}
          <div className="toolbar-right product-toolbar-actions">
            <div className="filter-tabs product-status-filter" role="group" aria-label="物料使用状态">
              {[["all", "全部状态"], ["active", "已启用"], ["inactive", "已停用"]].map(([value, label]) => (
                <button key={value} type="button" className={status === value ? "active" : ""} aria-pressed={status === value} onClick={() => setStatus(value)}>{label}</button>
              ))}
            </div>
            <div className="table-search">
              <Search size={16} />
              <input
                aria-label="筛选物料"
                placeholder="搜索名称、条码或规格型号"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button aria-label="清除搜索" onClick={() => setSearch("")}>
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="view-toggle">
              <button
                className={view === "list" ? "active" : ""}
                aria-label="列表视图"
                onClick={() => setView("list")}
              >
                <List size={17} />
              </button>
              <button
                className={view === "grid" ? "active" : ""}
                aria-label="网格视图"
                onClick={() => setView("grid")}
              >
                <Grid2X2 size={16} />
              </button>
            </div>
          </div>
        </div>
        {filtered.length ? (
          view === "list" ? (
            <div className="table-scroll">
              <table className="data-table product-table">
                <thead>
                  <tr>
                    <th>物料信息</th>
                    <th>分类</th>
                    <th className="number-cell">参考采购价 / 参考销售价</th>
                    <th className="number-cell">当前库存</th>
                    <th>库存状态</th>
                    <th className="number-cell">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="product-info">
                          <ProductArt product={p} />
                          <div>
                            <strong><ProductName product={p} onView={showProduct} /></strong>
                            {p.active === 0 && <Badge tone="orange">已停用</Badge>}
                            <small>{p.barcode}</small>
                            {p.specification && <small className="product-spec">{p.specification}</small>}
                            {p.note && <small className="product-note" title={p.note}>{p.note}</small>}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="category-tag">{p.category}</span>
                      </td>
                      <td className="number-cell">
                        <div className="price-pair">
                          <strong>¥ {money(p.price)}</strong>
                          <small>采购 ¥ {money(p.cost)}</small>
                        </div>
                      </td>
                      <td className="number-cell">
                        <strong className="stock-number">
                          {count(p.stock)}
                        </strong>
                        <span className="muted"> {p.unit}</span>
                      </td>
                      <td>
                        <Badge
                          tone={
                            p.stock === 0
                              ? "red"
                              : p.stock <= p.threshold
                                ? "orange"
                                : "green"
                          }
                        >
                          {stockStatus(p)}
                        </Badge>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="icon-button"
                            aria-label={`查看 ${p.name} 条码`}
                            onClick={() => barcode(p)}
                          >
                            <ScanLine size={17} />
                          </button>
                          <button
                            className="text-button"
                            hidden={!can("products")} onClick={() => edit(p)}
                          >
                            编辑
                          </button>
                          {lifecycleActions(p)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="product-grid">
              {visible.map((p) => (
                <article key={p.id} className="product-grid-card">
                  <div className="product-grid-top">
                    <ProductArt product={p} size="large" />
                    <Badge
                      tone={
                        p.stock === 0
                          ? "red"
                          : p.stock <= p.threshold
                            ? "orange"
                            : "green"
                      }
                    >
                      {stockStatus(p)}
                    </Badge>
                  </div>
                  <h3><ProductName product={p} onView={showProduct} /> {p.active === 0 && <Badge tone="orange">已停用</Badge>}</h3>
                  <p>{p.barcode}</p>
                  <p>{p.category}</p>
                  {p.specification && <p className="product-spec">{p.specification}</p>}
                  {p.note && <p className="product-note" title={p.note}>{p.note}</p>}
                  <div className="product-grid-stats">
                    <strong>¥ {money(p.price)}</strong>
                    <span>
                      库存 {p.stock} {p.unit}
                    </span>
                  </div>
                  <div className="product-grid-actions">
                    <button onClick={() => barcode(p)}>
                      <ScanLine size={15} />
                      物料条码
                    </button>
                    <button hidden={!can("products")} onClick={() => edit(p)}>
                      编辑
                      <ChevronRight size={13} />
                    </button>
                    {lifecycleActions(p)}
                  </div>
                </article>
              ))}
            </div>
          )
        ) : (
          <Empty
            title="没有找到物料"
            description="请调整搜索条件，或新增物料。"
            action={
              <Button permission="products" icon={Plus} onClick={() => edit(null)}>
                新增物料
              </Button>
            }
          />
        )}
        <Pagination
          total={filtered.length}
          page={pageNum}
          setPage={setPageNum}
        />
      </section>
      </div>
      {managing && <CategoryManager categories={categories} onClose={() => setManaging(false)} onChanged={onCategoriesChanged} />}
      <div className="page-hint">
        <ScanLine size={16} />
        <span>物料条码可自动生成，支持扫码识别及标签下载。</span>
      </div>
    </>
  );
}
function Pagination({ total, page, setPage }) {
  const pages = Math.max(1, Math.ceil(total / 8));
  return (
    <div className="pagination">
      <span>
        共 <strong>{total}</strong> 条记录
        {total > 0 && (
          <>
            ，显示 {(page - 1) * 8 + 1}–{Math.min(page * 8, total)} 条
          </>
        )}
      </span>
      <div>
        <button
          className="pagination-button"
          aria-label="上一页"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        {Array.from({ length: pages }, (_, i) => i + 1)
          .filter((p) => Math.abs(p - page) < 3 || p === 1 || p === pages)
          .map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`pagination-button ${page === p ? "active" : ""}`}
            >
              {p}
            </button>
          ))}
        <button
          className="pagination-button"
          aria-label="下一页"
          disabled={page === pages}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
function Inventory({ data, filter, setFilter, openOrder, openTransfer, reduceStock, showBarcode, showProduct }) {
  const { can, costs } = usePermissions();
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const low = data.products.filter((p) => p.stock <= p.threshold),
    empty = data.products.filter((p) => p.stock === 0);
  const filtered = data.products.filter(
    (p) =>
      (filter === "all" ||
        (filter === "warning" && p.stock <= p.threshold) ||
        (filter === "empty" && p.stock === 0)) &&
      [p.name, p.barcode].some((s) =>
        s.toLowerCase().includes(query.toLowerCase()),
      ),
  );
  useEffect(() => setPage(1), [filter, query]);
  return (
    <>
      <PageHeading
        eyebrow="INVENTORY"
        title="库存管理"
        description="查看现有库存、库存成本及补货预警。"
      >
        <span className="warehouse-chip">
          <Warehouse size={15} />
          {data.settings.warehouse_name}
        </span>
        <Button permission="transfer" icon={Truck} onClick={openTransfer}>
          仓库调拨
        </Button>
        <Button permission="purchase"
          kind="primary"
          icon={ArrowDownToLine}
          onClick={() => openOrder("in")}
        >
          采购入库
        </Button>
      </PageHeading>
      <div className="inventory-stats">
        <div>
          <span className="metric-icon icon-blue">
            <Boxes size={21} />
          </span>
          <span>
            <small>在库总数量</small>
            <strong>
              {count(data.products.reduce((s, p) => addQuantity(s, p.stock), 0))}
              <em> 件</em>
            </strong>
          </span>
        </div>
        <div>
          <span className="metric-icon icon-purple">
            <Warehouse size={21} />
          </span>
          <span>
            <small>库存成本金额</small>
            <strong>
              <em>¥ </em>
              {costs ? money(data.products.reduce((s, p) => s + (p.inventory_value_cents ?? Math.round(p.stock * p.cost * 100)) / 100, 0)) : '—'}
            </strong>
          </span>
        </div>
        <div>
          <span className="metric-icon icon-orange">
            <TriangleAlert size={21} />
          </span>
          <span>
            <small>低库存物料</small>
            <strong>
              {low.length}
              <em> 种</em>
            </strong>
          </span>
        </div>
        <div>
          <span className="metric-icon icon-red">
            <Package size={21} />
          </span>
          <span>
            <small>缺货物料</small>
            <strong>
              {empty.length}
              <em> 种</em>
            </strong>
          </span>
        </div>
      </div>
      <section className="panel">
        <div className="table-toolbar">
          <div className="filter-tabs">
            {[
              ["all", "全部库存", data.products.length],
              ["warning", "库存预警", low.length],
              ["empty", "已缺货", empty.length],
            ].map(([id, label, n]) => (
              <button
                key={id}
                className={filter === id ? "active" : ""}
                onClick={() => setFilter(id)}
              >
                {label}
                <span>{n}</span>
              </button>
            ))}
          </div>
          <div className="table-search">
            <Search size={16} />
            <input
              aria-label="搜索库存物料"
              placeholder="搜索物料或条码"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>物料信息</th>
                <th>分类</th>
                <th className="number-cell">现有库存</th>
                <th className="number-cell">安全库存</th>
                <th>库存状态</th>
                <th className="number-cell">库存成本</th>
                <th className="number-cell">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice((page - 1) * 8, page * 8).map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="product-info">
                      <ProductArt product={p} />
                      <div>
                        <strong><ProductName product={p} onView={showProduct} /></strong>
                        <button
                          className="barcode-link"
                          onClick={() => showBarcode(p)}
                        >
                          {p.barcode}
                        </button>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="category-tag">{p.category}</span>
                  </td>
                  <td className="number-cell">
                    <strong
                      className={
                        p.stock === 0
                          ? "red-text"
                          : p.stock <= p.threshold
                            ? "orange-text"
                            : ""
                      }
                    >
                      {p.stock}
                    </strong>
                    <span className="muted"> {p.unit}</span>
                  </td>
                  <td className="number-cell muted">
                    {p.threshold} {p.unit}
                  </td>
                  <td>
                    <Badge
                      tone={
                        p.stock === 0
                          ? "red"
                          : p.stock <= p.threshold
                            ? "orange"
                            : "green"
                      }
                    >
                      {stockStatus(p)}
                    </Badge>
                  </td>
                  <td className="number-cell">¥ {costs ? money((p.inventory_value_cents ?? Math.round(p.cost * p.stock * 100)) / 100) : '—'}</td>
                  <td className="number-cell">
                    <div className="row-actions">
                      <button
                        className="text-button"
                        hidden={!can("purchase")} onClick={() => openOrder("in", p)}
                      >
                        <Plus size={14} />
                        补货
                      </button>
                      <button
                        className="text-button danger"
                        hidden={!can("stocktake")} onClick={() => reduceStock(p)}
                      >
                        <Minus size={14} />
                        减少
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <Empty
              title="暂无符合条件的物料"
              description="调整筛选条件，查看其他库存。"
            />
          )}
        </div>
        <Pagination total={filtered.length} page={page} setPage={setPage} />
      </section>
      <div className="page-hint">
        <ShieldCheck size={16} />
        库存随单据确认自动更新，安全库存可在物料档案中调整。
      </div>
    </>
  );
}

function downloadFile(text, filename, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportOrders(orders, notify) {
  try {
    const exported = await api('/orders/export');
    const ids = new Set(orders.map(o => o.id));
    orders = exported.filter(o => ids.has(o.id));
  } catch (error) { notify(error.message); return; }
  const cell = (s) =>
    '"' +
    String(s)
      .replaceAll('"', '""')
      .replace(/^[=+\-@]/, "'") +
    '"';
  const rows = [
    [
      "单据编号",
      "类型",
      "往来单位",
      "金额",
      "时间",
      "物料",
      "数量",
      "单价",
      "明细金额",
      "备注",
    ],
    ...orders.flatMap((o) =>
      o.items.map((i) => [
        o.number,
        orderLabel(o),
        o.partner,
        o.total,
        o.created_at,
        i.name,
        i.quantity,
        i.price,
        (orderLineAmount(i) / 100).toFixed(2),
        o.note,
      ]),
    ),
  ];
  try {
    await downloadFile(
      "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n"),
      `77ERP-单据-${todayKey()}.csv`,
      "text/csv;charset=utf-8",
    );
    notify("单据已导出为 CSV");
  } catch (error) { notify(error.message); }
}
function Orders({ page, data, openOrder, showDetail, notify }) {
  const { can } = usePermissions();
  const type = page === "purchases" ? "in" : page === "sales" ? "out" : null;
  const [query, setQuery] = useState(""),
    [days, setDays] = useState("all"),
    [pageNum, setPageNum] = useState(1),
    [tab, setTab] = useState("all");
  useEffect(() => {
    setPageNum(1);
    setQuery("");
    setTab("all");
  }, [page]);
  useEffect(() => setPageNum(1), [query, days, tab]);
  const filtered = data.orders.filter(
    (o) =>
      (!type || businessType(o) === type) &&
      (tab === "all" || businessType(o) === tab) &&
      (days === "all" ||
        new Date(o.created_at) >
          new Date(Date.now() - Number(days) * 86400000)) &&
      [o.number, o.partner, ...o.items.map((i) => i.name)].some((s) =>
        s.toLowerCase().includes(query.toLowerCase()),
      ),
  );
  const titles = {
    purchases: ["PURCHASES", "采购入库", "采购入库"],
    sales: ["SALES", "销售出库", "销售出库"],
    history: ["ACTIVITY", "操作记录", "操作记录"],
  };
  const [eyebrow, title, label] = titles[page];
  return (
    <>
      <PageHeading
        eyebrow={eyebrow}
        title={title}
        description={
          type === "in"
            ? "记录采购物料和成本，确认入库后库存自动增加。"
            : type === "out"
              ? "扫描物料、确认数量，完成销售的同时自动扣减库存。"
              : "查看全部入出库单据，追溯物料、数量和往来单位。"
        }
      >
        <Button
          icon={Download}
          permission="data_io"
          onClick={() => exportOrders(filtered, notify)}
          disabled={!filtered.length}
        >
          导出单据
        </Button>
        {type && (
          <Button permission={type === 'in' ? 'purchase' : 'sale'} kind="primary" icon={Plus} onClick={() => openOrder(type)}>
            新建{label.slice(-2)}
          </Button>
        )}
      </PageHeading>
      <div className="order-summary">
        <div>
          <span>
            筛选内净额（不含作废，扣除退货）
          </span>
          <strong>
            <small>¥ </small>
            {money(reportOrders(filtered).reduce((s, o) => s + o.total, 0))}
          </strong>
        </div>
        <div>
          <span>有效单据</span>
          <strong>
            {filtered.filter(o => o.status !== "void").length}
            <small> 笔</small>
          </strong>
        </div>
        <div>
          <span>物料流转数量</span>
          <strong>
            {count(
              filtered.filter(o => o.status !== "void").reduce(
                (s, o) => addQuantity(s, o.items.reduce((n, i) => addQuantity(n, i.quantity), 0)),
                0,
              ),
            )}
            <small> 件</small>
          </strong>
        </div>
        <div className="order-summary-note">
          <PackageCheck size={26} />
          <span>
            确认单据后更新库存
            <br />
            <small>支持查看物料明细与成交金额</small>
          </span>
        </div>
      </div>
      <section className="panel">
        <div className="table-toolbar">
          <div className="filter-tabs">
            {(type
              ? [[type, `全部${label}单`]]
              : [
                  ["all", "全部操作"],
                  ["in", "采购入库"],
                  ["out", "销售出库"],
                  ["transfer", "仓库调拨"],
                ]
            ).map(([id, name]) => (
              <button
                key={id}
                className={type || tab === id ? "active" : ""}
                onClick={() => setTab(id)}
              >
                {name}
                <span>
                  {type
                    ? filtered.length
                    : data.orders.filter((o) => id === "all" || businessType(o) === id)
                        .length}
                </span>
              </button>
            ))}
          </div>
          <div className="toolbar-right">
            <div className="table-search">
              <Search size={16} />
              <input
                aria-label="搜索单据"
                placeholder="搜索单号、单位或物料"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Select
              className="filter-select"
              aria-label="单据时间范围"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            >
              <option value="all">全部时间</option>
              <option value="7">近 7 天</option>
              <option value="30">近 30 天</option>
            </Select>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table orders-table">
            <thead>
              <tr>
                <th>单据编号</th>
                <th>往来单位</th>
                <th>物料明细</th>
                <th className="number-cell">金额</th>
                <th>创建时间</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.slice((pageNum - 1) * 8, pageNum * 8).map((o) => (
                <tr
                  key={o.id}
                  className="clickable-row"
                  onClick={() => showDetail(o)}
                >
                  <td>
                    <div className="order-info">
                      <span
                        className={`order-icon ${o.type === "in" ? "green" : "blue"}`}
                      >
                        {o.type === "in" ? (
                          <ArrowDownLeft size={17} />
                        ) : (
                          <ArrowUpRight size={17} />
                        )}
                      </span>
                      <div>
                        <strong className="order-number">{o.number}</strong>
                        <small>
                          {orderLabel(o)}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>{o.partner}</td>
                  <td>
                    <div className="order-item-preview">
                      <strong>{o.items[0]?.name}</strong>
                      <small>
                        {o.items.length} 种物料 ·{" "}
                        {o.items.reduce((s, i) => addQuantity(s, i.quantity), 0)} 件
                      </small>
                    </div>
                  </td>
                  <td className="number-cell amount-cell">
                    {o.kind === "transfer" ? (
                      <span className="muted">不涉及金额</span>
                    ) : (
                      `¥ ${money(o.total)}`
                    )}
                  </td>
                  <td className="muted">{dateTime(o.created_at)}</td>
                  <td>
                    <Badge>已完成</Badge>
                  </td>
                  <td>
                    <button
                      className="table-arrow"
                      aria-label={`查看单据 ${o.number}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        showDetail(o);
                      }}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <Empty
              title="暂无符合条件的单据"
              description="调整搜索或日期范围，或开始创建单据。"
              action={
                type && (
                  <Button permission={type === 'in' ? 'purchase' : 'sale'} icon={Plus} onClick={() => openOrder(type)}>
                    新建单据
                  </Button>
                )
              }
            />
          )}
        </div>
        <Pagination
          total={filtered.length}
          page={pageNum}
          setPage={setPageNum}
        />
      </section>
    </>
  );
}

function ProductName({ product, onView }) {
  return <button type="button" className="product-name-link" aria-label={`查看 ${product.name} 物料详情`} onClick={() => onView(product)}>{product.name}</button>;
}

function ProductDetail({ product, warehouseName, onViewOrder, onClose }) {
  const { costs } = usePermissions();
  const [others, setOthers] = useState(null);
  const [otherError, setOtherError] = useState("");
  useEffect(() => {
    let active = true;
    setOthers(null); setOtherError("");
    api(`/products/${product.id}/other-warehouses`)
      .then((result) => { if (active) setOthers(result.warehouses || []); })
      .catch((e) => { if (active) setOtherError(e.message); });
    return () => { active = false; };
  }, [product.id]);
  const fields = [
    ["物料条码", product.barcode],
    ["物料分类", product.category],
    ["计量单位", product.unit],
    ["所属仓库", warehouseName],
    ["参考销售价", `¥ ${money(product.price)}`],
    ...(costs ? [["参考采购价", `¥ ${money(product.cost)}`]] : []),
    ["当前库存", `${count(product.stock)} ${product.unit}`],
    ["安全库存", `${count(product.threshold)} ${product.unit}`],
    ["库存状态", stockStatus(product)],
    ["使用状态", product.active === 0 ? "已停用" : "已启用"],
  ];
  return <Modal title="物料详情" subtitle="查看物料档案与当前库存" onClose={onClose}>
    <div className="form-body product-detail">
      <div className="product-detail-heading">
        <ProductArt product={product} size="large" />
        <h3>{product.name}</h3>
      </div>
      <dl className="product-detail-fields">
        {fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}
        <div className="product-detail-full"><dt>规格型号</dt><dd>{product.specification || "—"}</dd></div>
        <div className="product-detail-full"><dt>备注</dt><dd>{product.note || "—"}</dd></div>
      </dl>
      <ProductHistory key={product.id} product={product} onViewOrder={onViewOrder} />
      <section className="product-other-stock">
        <h4>其他仓库库存</h4>
        {otherError ? <p className="form-error" role="alert">{otherError}</p>
          : others === null ? <p className="product-other-empty"><LoadingIndicator size={20} /> 读取中…</p>
          : others.length === 0 ? <p className="product-other-empty">其他仓库暂无同一物料</p>
          : <ul className="product-other-list">
            {others.map((row) => <li key={row.warehouse_id}>
              <span>{row.warehouse_name}</span>
              <strong>{count(row.stock)} {row.unit || product.unit}</strong>
            </li>)}
          </ul>}
      </section>
    </div>
    <div className="modal-footer"><Button onClick={onClose}>关闭</Button></div>
  </Modal>;
}

function ProductForm({ product, categories, units = ["个"], warehouses, warehouseId, onClose, onSaved }) {
  const [syncTargets, setSyncTargets] = useState([]);
  const [currentCategories, setCurrentCategories] = useState(categories);
  const options = flattenCategories(currentCategories);
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState(null);
  const [form, setForm] = useState(
    product || {
      name: "",
      barcode: "",
      category: options[0]?.path || "",
      category_id: options[0]?.id || "",
      image: "",
      specification: "",
      note: "",
      unit: units[0],
      cost: "",
      price: "",
      threshold: 20,
    },
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const [readingImage, setReadingImage] = useState(false);
  const imageInputRef = useRef(null);
  const submit = async (e) => {
    e.preventDefault();
    if (busy || readingImage || conflict) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(
        product ? `/products/${product.id}` : "/products",
        {
          method: product ? "PUT" : "POST",
          body: {
            ...form,
            cost: Number(form.cost),
            price: Number(form.price),
            threshold: Number(form.threshold),
            sync_warehouse_ids: syncTargets,
          },
        },
      );
      await onSaved(
        product ? "物料信息已更新" : `物料已创建 · 条码 ${result.barcode}`,
      );
    } catch (e) {
      setError(e.message);
      if (e.status === 409 && e.code === 'PRODUCT_VERSION_CONFLICT') {
        setConflict(true);
        setLatest(null);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={product ? "编辑物料" : "新增物料"}
      subtitle="填写物料信息；条码选填，新增时留空自动生成"
      onClose={busy || readingImage ? () => {} : onClose}
    >
      <form onSubmit={submit}>
        <div className="form-body">
          <label>
            物料名称 <span>*</span>
            <input
              required
              maxLength={100}
              placeholder="例如：RVV 护套电线"
              value={form.name}
              onChange={(e) => change("name", e.target.value)}
            />
          </label>
          <label>
            物料条码（选填）
            <div className="input-with-icon">
              <ScanLine size={17} />
              <input
                pattern="[A-Za-z0-9_.\-]{3,64}"
                maxLength={64}
                title="3–64 位字母、数字或 ._-"
                placeholder="扫描或输入条码，可留空"
                value={form.barcode}
                onChange={(e) => change("barcode", e.target.value)}
              />
            </div>
            <small>
              {product
                ? "可扫描或手动输入条码；留空保存将保留当前条码。"
                : "可扫描或手动输入条码；留空保存时自动生成唯一条码。"}
            </small>
          </label>
          <div className="form-grid">
            <label>
              物料分类 <span>*</span>
              <Select
                required
                value={form.category_id || ''}
                onChange={(e) => {
                  const c = options.find(c => c.id === Number(e.target.value));
                  setForm(current => ({ ...current, category_id: c?.id || '', category: c?.path || '' }));
                }}
              >
                <option value="" disabled>请选择分类</option>
                {options.map(c => <option key={c.id} value={c.id}>{'　'.repeat(c.depth)}{c.path}</option>)}
              </Select>
              {!options.length && <small>请先在物料管理的「管理分类」中添加分类。</small>}
            </label>
            <label>
              计量单位 <span>*</span>
              <Select
                required
                value={form.unit}
                onChange={(e) => change("unit", e.target.value)}
              >
                {[...new Set([...units, form.unit])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
              <small>可在「设置 → 基础设置 → 计量单位」中配置。</small>
            </label>
            <label>
              参考采购价（元） <span>*</span>
              <input
                type="number"
                required
                min="0"
                max="99999999"
                step="0.01"
                placeholder="0.00"
                value={form.cost}
                onChange={(e) => change("cost", e.target.value)}
              />
            </label>
            <label>
              参考销售价（元） <span>*</span>
              <input
                type="number"
                required
                min="0"
                max="99999999"
                step="0.01"
                placeholder="0.00"
                value={form.price}
                onChange={(e) => change("price", e.target.value)}
              />
            </label>
          </div>
          <div className="product-image-editor" role="group" aria-label="物料图片">
            <div className="product-image-label">物料图片</div>
            <input ref={imageInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || readingImage} aria-label="上传物料图片"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  setReadingImage(true); setError('');
                  try { change('image', await readProductImage(file)); }
                  catch (e) { setError(e.message); }
                  finally { setReadingImage(false); }
                }} />
            <button type="button" className="product-image-upload" disabled={busy || readingImage} aria-busy={readingImage} onClick={() => imageInputRef.current?.click()}>
              <span className="product-image-upload-icon" aria-hidden="true">{readingImage ? <LoadingIndicator size={22} /> : <ImagePlus size={22} />}</span>
              <span className="product-image-upload-copy">
                <strong>{readingImage ? '正在上传图片…' : form.image ? '更换物料图片' : '上传物料图片'}</strong>
                <span>{readingImage ? '正在压缩并上传，请稍候' : '点击选择图片，支持 JPEG、PNG、WebP'}</span>
              </span>
              {!readingImage && <Plus size={18} aria-hidden="true" />}
            </button>
            <small className="product-image-hint">单张图片不超过 10 MB，上传时自动压缩。</small>
            {form.image && <div className="product-image-preview"><ProductImage src={form.image} alt="物料图片预览" className="product-image-thumbnail" /><Button type="button" disabled={busy || readingImage} onClick={() => change('image', '')}>移除图片</Button></div>}
          </div>
          <label>规格型号
            <input maxLength={500} placeholder="例如：3 芯 / 1.5 mm² / 额定电压 300/500V" value={form.specification || ''} onChange={e => change('specification', e.target.value)} />
          </label>
          <label>物料备注
            <textarea maxLength={2000} rows={3} placeholder="填写物料补充说明" value={form.note || ''} onChange={e => change('note', e.target.value)} />
          </label>
          <label>
            安全库存 <span>*</span>
            <input
              type="number"
              required
              min="0"
              max="99999999"
              step="0.000001"
              value={form.threshold}
              onChange={(e) => change("threshold", e.target.value)}
            />
            <small>库存小于或等于此数量时，自动提醒补货。</small>
          </label>
          <ProductSync warehouses={warehouses} warehouseId={warehouseId} targets={syncTargets} setTargets={setSyncTargets} disabled={busy || readingImage} />
          {!product && (
            <div className="info-box">
              <Package size={17} />
              <p>新物料初始库存为 0，创建后通过「采购入库」增加库存。</p>
            </div>
          )}
          {error && (
            <div className="form-error" role="alert">
              <TriangleAlert size={16} />
              {error}
            </div>
          )}
          {conflict && <>
            <ProductConflict form={form} latest={latest?.product} />
            <Button type="button" disabled={busy || readingImage} onClick={async () => {
              setBusy(true);
              setLatest(null);
              try {
                const data = await api('/data', { warehouseId });
                const current = data.products.find(p => p.id === product.id);
                if (!current) throw new Error('物料已被删除，当前填写内容已保留。');
                setLatest({ product: current, categories: data.categories });
              } catch (e) { setError(e.message); }
              finally { setBusy(false); }
            }} busy={busy}>{busy ? '正在读取…' : '查看最新信息'}</Button>
            {latest && <Button type="button" disabled={busy || readingImage} onClick={() => {
              if (!window.confirm('使用最新信息替换当前填写内容，并清空同步仓库选择？')) return;
              setForm(latest.product);
              setCurrentCategories(latest.categories);
              setSyncTargets([]);
              setConflict(false);
              setLatest(null);
              setError('');
            }}>使用最新信息重新编辑</Button>}
          </>}
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose} disabled={busy || readingImage}>
            取消
          </Button>
          <Button
            type="submit"
            kind="primary"
            icon={Check} busy={busy}
            disabled={busy || readingImage || conflict}
          >
            {busy ? "正在保存…" : "保存物料"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ReduceStockModal({ product, onClose, onSaved }) {
  const { busy, error, run, send } = useBusiness();
  const [quantity, setQuantity] = useState(""),
    [reason, setReason] = useState("");
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const amount = parseQuantity(quantity, true);
      if (!reason.trim()) throw new Error("请填写减少原因。");
      if (amount > product.stock)
        throw new Error(`减少数量不能超过现有库存 ${product.stock} ${product.unit}。`);
      if (
        !window.confirm(
          `确认将「${product.name}」库存从 ${product.stock} 减少 ${amount} ${product.unit}？`,
        )
      )
        return;
      await send("/stock/reduce", {
        product_id: product.id,
        quantity: amount,
        expected_stock: product.stock,
        reason,
      });
      await onSaved(`库存已减少 · ${product.name}`);
    });
  };
  return (
    <Modal
      title="减少库存"
      subtitle="用于报损、损耗或盘亏，直接调整现有库存并记录原因。"
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="form-body">
          <div className="reduce-stock-product">
            <strong>{product.name}</strong>
            <small>
              {product.barcode} · 现有库存 {product.stock} {product.unit}
            </small>
          </div>
          <label>
            减少数量（{product.unit}） <span>*</span>
            <input
              required
              data-autofocus
              type="number"
              min="0.000001"
              step="0.000001"
              placeholder="0"
              value={quantity}
              disabled={busy}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <label>
            减少原因 <span>*</span>
            <input
              required
              maxLength={500}
              placeholder="例如：破损报废、盘点损耗"
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button type="submit" kind="primary" icon={Minus} busy={busy}>
            {busy ? "处理中…" : "确认减少"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function OrderForm({ type, initialProduct, initialTemplate, data, onClose, onSaved }) {
  const { templates } = usePermissions();
  const [template, setTemplate] = useState(initialTemplate || null);
  const [templateName, setTemplateName] = useState(initialTemplate?.name || "");
  const [templateMessage, setTemplateMessage] = useState("");
  const [templateRevision, setTemplateRevision] = useState(0);
  const [partnerId, setPartnerId] = useState(initialTemplate?.partner_id ?? null);
  const templateAction = useBusiness();
  const submitLock = useRef(false);
  const [items, setItems] = useState(
    initialTemplate ? initialTemplate.items : initialProduct
      ? [
          {
            product_id: initialProduct.id,
            quantity: 1,
            price: type === "in" ? initialProduct.cost : initialProduct.price,
          },
        ]
      : [],
  );
  const [partner, setPartner] = useState(initialTemplate?.partner ?? (type === "out" ? "零售客户" : "")),
    [note, setNote] = useState(initialTemplate?.note || ""),
    [barcode, setBarcode] = useState(""),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [camera, setCamera] = useState(false),
    [scanMessage, setScanMessage] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const add = (p) => {
    setItems((prev) => {
      const found = prev.find((i) => i.product_id === p.id);
      return found
        ? prev.map((i) =>
            i.product_id === p.id
              ? { ...i, quantity: addQuantity(Number(i.quantity), 1) }
              : i,
          )
        : [
            ...prev,
            {
              product_id: p.id,
              quantity: 1,
              price: type === "in" ? p.cost : p.price,
            },
          ];
    });
    setQuery("");
    setScanMessage(`已添加 ${p.name}${p.active === 0 ? "（已停用）" : ""}`);
    setError("");
  };
  const scan = (code) => {
    setCamera(false);
    try {
      const p = resolveProductCode(code, { products: data.products, warehouseId: data.warehouse_id || 1, sourceId: data.instance_id });
      if (!p) {
        setError(`未找到条码「${code.trim()}」，请先在物料管理中建档。`);
        return;
      }
      add(p);
      setBarcode("");
    } catch (e) {
      setError(e.message);
    }
  };
  const update = (id, key, value) =>
    setItems((prev) =>
      prev.map((i) => (i.product_id === id ? { ...i, [key]: value } : i)),
    );
  const total =
    items.reduce(
      (s, i) => s + Math.round(Number(i.quantity) * Number(i.price) * 100),
      0,
    ) / 100;
  const submit = async (e) => {
    e.preventDefault();
    if (!items.length) {
      setError("请至少添加一件物料。");
      return;
    }
    if (submitLock.current || templateAction.busy) return;
    submitLock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await templateAction.send('/orders', {
        type,
        ...(partnerId ? { partner_id: partnerId } : {}),
        partner, note,
        items: items.map(i => ({ ...i, quantity: Number(i.quantity), price: Number(i.price) })),
      });
      await onSaved(`${type === "in" ? "入库" : "出库"}成功 · ${r.number}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      submitLock.current = false;
    }
  };
  const saveTemplate = (overwrite) => templateAction.run(async () => {
    setTemplateMessage("");
    const result = await templateAction.send("/templates", {
      ...(overwrite && template ? { id: template.id, version: template.version } : {}),
      name: templateName, type, partner, partner_id: partnerId, note, items,
    });
    setTemplate(result);
    setTemplateName(result.name);
    setTemplateRevision(value => value + 1);
    setTemplateMessage(`模板「${result.name}」已保存，可反复套用`);
  });
  const partners = (data.contacts || []).filter(c => c.active && c.role === (type === "in" ? "supplier" : "customer"));
  const matches = data.products
    .filter(p => includeInactive || p.active !== 0)
    .filter((p) =>
      [p.name, p.barcode].some((s) =>
        s.toLowerCase().includes(query.toLowerCase()),
      ),
    )
    .slice(0, 6);
  return (
    <Modal
      title={type === "in" ? "新建采购入库" : "新建销售出库"}
      subtitle={`确认后将${type === "in" ? "增加" : "扣减"}库存，并生成可追溯的${type === "in" ? "入库" : "出库"}单据`}
      onClose={busy || templateAction.busy ? () => {} : onClose}
      wide
    >
      <form onSubmit={submit}>
        <div className="form-body order-form-body">
          <label className="inactive-product-option"><input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} />包含停用物料（用于清库存等操作）</label>

          <Templates collapsible type={type} activeId={template?.id} refreshKey={templateRevision} disabled={busy || templateAction.busy} onUse={d => {
            if ((items.length || note) && !window.confirm("套用模板将替换当前编辑内容，是否继续？")) return false;
            setTemplate(d); setTemplateName(d.name); setTemplateMessage(""); setPartner(d.partner); setPartnerId(d.partner_id); setNote(d.note); setItems(d.items);
          }} />
          {template && <span className="order-template-status"><FilePenLine size={15} aria-hidden="true" />已套用「{template.name}」<small>本次修改不会自动更新模板</small></span>}
          {templates && <div className="template-save-panel">
            <label>模板名称<input value={templateName} maxLength={100} placeholder="例如：每周日用品补货" disabled={busy || templateAction.busy} onChange={e => setTemplateName(e.target.value)} /></label>
            <div className="order-template-actions">
              <Button type="button" icon={FilePenLine} busy={templateAction.busy} disabled={busy || !items.length} onClick={() => saveTemplate(false)}>{template ? "另存为模板" : "保存为模板"}</Button>
              {template && <Button type="button" busy={templateAction.busy} disabled={busy || !items.length} onClick={() => saveTemplate(true)}>更新模板</Button>}
            </div>
            {templateMessage && <p className="template-success" role="status">{templateMessage}</p>}
          </div>
          }
          {templateAction.error && <p role="alert" className="form-error">{templateAction.error}</p>}
          <div className="form-grid">
            <ContactPicker contacts={partners} value={partner} selectedId={partnerId} searchable
              label={type === "in" ? "供应商" : "客户 / 往来单位"}
              placeholder={type === "in" ? "选择供应商" : "选择客户"}
              required disabled={busy || templateAction.busy}
              onSelect={contact => { setPartner(contact.name); setPartnerId(contact.id); }} />
            <label>
              入出库仓库
              <input value={data.settings.warehouse_name} disabled />
            </label>
          </div>
          <div className="order-scan-row">
            <Button
              type="button"
              kind="primary"
              icon={Camera}
              onClick={() => setCamera(!camera)}
            >
              {camera ? "关闭摄像头" : "手机扫码"}
            </Button>
            <div className="input-with-icon">
              <ScanLine size={18} />
              <input
                aria-label="扫描物料条码"
                placeholder="手动输入物料条码"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (barcode) scan(barcode);
                  }
                }}
              />
            </div>
            <Button
              type="button"
              icon={Plus}
              disabled={!barcode.trim()}
              onClick={() => scan(barcode)}
            >
              添加
            </Button>
          </div>
          {camera && <CameraScanner onResult={scan} onClose={() => setCamera(false)} />}
          <div className="product-picker">
            <div className="table-search">
              <Search size={16} />
              <input
                aria-label="查找并添加物料"
                placeholder="或搜索物料名称，点击添加"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  type="button"
                  aria-label="清除"
                  onClick={() => setQuery("")}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {query && (
              <div className="picker-results">
                {matches.length ? (
                  matches.map((p) => (
                    <button key={p.id} type="button" onClick={() => add(p)}>
                      <ProductArt product={p} size="small" preview={false} />
                      <span>
                        <strong>{p.name}{p.active === 0 ? "（已停用）" : ""}</strong>
                        <small>
                          {p.barcode} · 库存 {p.stock} {p.unit}
                        </small>
                      </span>
                      <Plus size={16} />
                    </button>
                  ))
                ) : (
                  <p>未找到物料，请先建立物料档案。</p>
                )}
              </div>
            )}
          </div>
          {scanMessage && (
            <div className="scan-feedback">
              <CircleCheck size={14} />
              {scanMessage}
            </div>
          )}
          <div className="order-items-title">
            <strong>
              物料明细 <span>{items.length}</span>
            </strong>
            <small>再次扫描同一物料，数量自动加 1</small>
          </div>
          <div className="table-scroll form-table-wrap">
            <table className="data-table form-table">
              <thead>
                <tr>
                  <th>物料</th>
                  <th style={{ width: 100 }}>数量</th>
                  <th style={{ width: 110 }}>单价（元）</th>
                  <th className="number-cell">小计</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const p = data.products.find((p) => p.id === i.product_id);
                  return (
                    <tr key={i.product_id}>
                      <td>
                        <div className="product-info">
                          <ProductArt product={p} size="small" />
                          <div>
                            <strong>{p.name}{p.active === 0 ? "（已停用）" : ""}</strong>
                            <small>
                              库存 {p.stock} {p.unit}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <input
                          aria-label={`${p.name} 数量`}
                          type="number"
                          min="0.000001"
                          max="99999999"
                          step="0.000001"
                          required
                          value={i.quantity}
                          onChange={(e) =>
                            update(i.product_id, "quantity", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`${p.name} 单价`}
                          type="number"
                          min="0"
                          max="99999999"
                          step="0.01"
                          required
                          value={i.price}
                          onChange={(e) =>
                            update(i.product_id, "price", e.target.value)
                          }
                        />
                      </td>
                      <td className="number-cell">
                        ¥ {money(Number(i.quantity) * Number(i.price))}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`移除 ${p.name}`}
                          onClick={() =>
                            setItems(
                              items.filter(
                                (x) => x.product_id !== i.product_id,
                              ),
                            )
                          }
                        >
                          <X size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!items.length && (
              <div className="order-form-empty">
                <ScanLine size={25} />
                <span>扫码或搜索，添加第一件物料</span>
              </div>
            )}
          </div>
          <label className="note-label">
            备注
            <textarea
              maxLength={500}
              rows={2}
              placeholder="选填，记录本次入出库的补充信息"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {error && (
            <div className="form-error" role="alert">
              <TriangleAlert size={16} />
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer order-form-footer">
          <div>
            <small>合计金额</small>
            <strong>
              <span>¥ </span>
              {money(total)}
            </strong>
          </div>
          <div>
            <Button type="button" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button
              type="submit"
              kind="primary"
              icon={Check} busy={busy}
              disabled={busy || templateAction.busy || !items.length}
            >
              {busy ? "正在提交…" : `确认${type === "in" ? "入库" : "出库"}`}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
function OrderDetail({ order, onClose, onSaved, isAdmin }) {
  const { can, costs } = usePermissions();
  // Transfers carry no money: they are corrected from the transfer list, and
  // the line value shown is the moved moving-average cost.
  const transfer = order.kind === "transfer";
  const costTotal = order.items.reduce((sum, i) => sum + (i.cost_cents || 0), 0) / 100;
  return (
    <Modal
      title={`${orderLabel(order)}单详情`}
      subtitle={order.number}
      onClose={onClose}
      wide
    >
      <div className="form-body">
        <div className="detail-status">
          <Badge>{order.status === "void" ? "已作废" : "已完成"}</Badge>
          <span>
            <CheckCheck size={15} />
            库存已同步更新
          </span>
        </div>
        <div className="detail-meta">
          <div>
            <small>{transfer ? (order.type === "in" ? "来自仓库" : "发往仓库") : "往来单位"}</small>
            <strong>{order.partner}</strong>
          </div>
          <div>
            <small>创建时间</small>
            <strong>
              {new Date(order.created_at).toLocaleString("zh-CN", {
                hour12: false,
              })}
            </strong>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table detail-table">
            <thead>
              <tr>
                <th>物料名称</th>
                <th>条码</th>
                <th className="number-cell">数量</th>
                <th className="number-cell">{transfer ? "成本单价" : "单价"}</th>
                <th className="number-cell">{transfer ? "成本小计" : "小计"}</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td className="mono muted">{i.barcode}</td>
                  <td className="number-cell">{i.quantity}</td>
                  {transfer ? (
                    <>
                      <td className="number-cell">{costs && i.cost_cents != null ? `¥ ${money(i.cost_cents / 100 / i.quantity)}` : "—"}</td>
                      <td className="number-cell">{costs && i.cost_cents != null ? `¥ ${money(i.cost_cents / 100)}` : "—"}</td>
                    </>
                  ) : (
                    <>
                      <td className="number-cell">¥ {money(i.price)}</td>
                      <td className="number-cell">
                        ¥ {money(orderLineAmount(i) / 100)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="detail-note">
          <small>备注</small>
          <p>{order.note || "无备注"}</p>
        </div>
        <p className="muted">开单人：{order.created_by_name || '历史记录，操作人未知'}</p>
        {transfer && (
          <div className="info-box">
            仓库间调拨不涉及金额，两个仓库的库存已同步调整。请在有调出记录的仓库，通过「业务管理 → 仓库调拨」撤销。
          </div>
        )}
        {!transfer && can('finance') && <Payments order={order} />}
        {!transfer && can('corrections') && <OrderActions order={order} onSaved={onSaved} />}
      </div>
      <div className="modal-footer order-form-footer">
        <div>
          <small>{transfer ? "调拨成本" : "合计金额"}</small>
          <strong>
            {transfer ? (costs ? `¥ ${money(costTotal)}` : "—") : <><span>¥ </span>{money(order.total)}</>}
          </strong>
        </div>
        <Button onClick={onClose}>关闭详情</Button>
      </div>
    </Modal>
  );
}

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
  const product = data.products.find((p) => p.id === selected?.id) || selected;
  const input = useRef();
  useEffect(() => {
    if (manual) input.current?.focus();
  }, [manual]);
  const scan = (code) => {
    if (stockBusy) return;
    setCamera(false);
    const operation = stockQrLabel(code);
    if (operation) { setSelected(null); setError(""); setStockLabel(operation); setBarcode(""); return; }
    let p = null;
    try {
      p = resolveProductCode(code, { products: data.products, warehouseId: data.warehouse_id || 1, sourceId: data.instance_id });
    } catch (e) {
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
                      product.stock === 0
                        ? "red"
                        : product.stock <= product.threshold
                          ? "orange"
                          : "green"
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
function SettingsForm({ settings, warehouses, onClose, onSaved, onRefresh, onPasswordChanged, initialSection = "general" }) {
  const lock = useRef(false);
  const [notificationDirty, setNotificationDirty] = useState(false);
  const closeSettings = () => { if (!notificationDirty || window.confirm('通知设置尚未保存，确定放弃修改并关闭？')) onClose(); };
  const contentRef = useRef(null);
  const [section, setSection] = useState(initialSection);
  const [form, setForm] = useState(() => ({ ...settings, units: settings.units || ["个"] })),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => setForm(current => ({ ...current, warehouse_name: settings.warehouse_name })), [settings.warehouse_name]);
  const submit = async (e) => {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await api("/settings", { method: "PUT", body: form });
      await onSaved("工作空间设置已保存");
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const reset = async () => {
    if (lock.current || !window.confirm("确定重置业务数据？所有物料、库存、入出库单据、往来单位、模板及收付款/盘点记录（包括正式数据）将永久删除，无法恢复。管理员账户、登录信息、服务器配置及已保存的商户和仓库名称会保留。")) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await api("/settings/reset", { method: "POST", body: { confirmation: "RESET_BUSINESS_DATA" } });
      await onSaved("业务数据已清空，账户和配置已保留");
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      title="工作空间设置"
      subtitle="管理工作空间、账号与业务备份"
      className="settings-modal"
      onClose={busy ? () => {} : closeSettings}
    >
      <form onSubmit={(e) => { if (section === "general") void submit(e); else e.preventDefault(); }}>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="设置分类">
            {[["general", "基础设置", Settings, "名称、仓库与计量单位"], ["ai", "AI 助手", Settings, "模型连接与操作范围"], ["imagebed", "图床配置", Camera, "物料图片上传与认证"], ["notifications", "通知设置", Bell, "Webhook 与通知类型"], ["data", "备份与恢复", Warehouse, "业务备份、恢复与重置"], ["users", "用户管理", ShieldCheck, "账号、角色与密码"]].map(([id, title, Icon, caption]) => (
              <button key={id} type="button" disabled={busy} aria-pressed={section === id} onClick={() => { setSection(id); contentRef.current?.scrollTo(0, 0); }}>
                <Icon size={19} /><div><strong>{title}</strong><small>{caption}</small></div>
              </button>
            ))}
          </nav>
          <div className="form-body settings-content" ref={contentRef}>
          <div hidden={section !== "general"} className="settings-section">
          <div className="settings-section-heading"><h3>基础设置</h3><p>设置业务中显示的商户和仓库名称。</p></div>
          <div className="form-grid">
          <label>
            商户名称 <span>*</span>
            <input
              required
              maxLength={60}
              value={form.business_name}
              onChange={(e) =>
                setForm({ ...form, business_name: e.target.value })
              }
            />
          </label>
          <label>
            仓库名称 <span>*</span>
            <input
              required
              maxLength={60}
              value={form.warehouse_name}
              onChange={(e) =>
                setForm({ ...form, warehouse_name: e.target.value })
              }
            />
          </label>
          </div>
          <section className="unit-manager" aria-label="计量单位管理">
            <div className="settings-section-heading"><h3>计量单位</h3><p>各仓库共用，第一项作为新增物料的默认单位。修改列表不会改变已有物料的单位。</p></div>
            <div className="unit-list">
              {form.units.map((unit, index) => (
                <div className="unit-row" key={index}>
                  <label>
                    单位 {index + 1}{index === 0 ? "（默认）" : ""}
                    <input required maxLength={100} value={unit} disabled={busy} onChange={e => setForm(current => ({ ...current, units: current.units.map((value, i) => i === index ? e.target.value : value) }))} />
                  </label>
                  <Button type="button" icon={Trash2} aria-label={`删除单位 ${index + 1}`} disabled={busy || form.units.length === 1} onClick={() => setForm(current => ({ ...current, units: current.units.filter((_, i) => i !== index) }))} />
                </div>
              ))}
            </div>
            <Button type="button" icon={Plus} disabled={busy || form.units.length >= 100} onClick={() => setForm(current => ({ ...current, units: [...current.units, ""] }))}>新增单位</Button>
          </section>
          <WarehouseManager warehouses={warehouses} onRefresh={onRefresh} onBusy={setBusy} />
          <div className="settings-version">
            <span className="brand-mark">
              <svg viewBox="0 0 40 40">
                <path d="M8 12h11l-7 17m10-17h10l-7 17" />
              </svg>
            </span>
            <div>
              <strong>77 ERP</strong>
              <p>v{appVersion} · 多仓库版</p>
            </div>
            <Badge tone="blue">本地版本</Badge>
          </div>
          <div className="info-box"><ShieldCheck size={17} /><p>物料和单据保存在服务端数据库中，支持单商户管理多个仓库。</p></div>
          </div>
          {section === "users" && <div className="settings-section"><UserManager Modal={Modal} /><ChangePassword onChanged={onPasswordChanged} /></div>}
          {section === 'ai' && <div className="settings-section"><AiSettings onBusy={setBusy} /></div>}
          <div hidden={section !== 'imagebed'} className="settings-section"><ImagebedSettings active={section === 'imagebed'} onBusy={setBusy} /></div>
          <div hidden={section !== 'notifications'} className="settings-section"><NotificationSettings warehouses={warehouses} active={section === 'notifications'} onBusy={setBusy} onDirty={setNotificationDirty} /></div>
          <div hidden={section !== "data"} className="settings-section">
          {section === "data" && <Backup onSaved={onSaved} />}
          <section className="settings-danger">
          <h3>重置业务数据</h3>
          <div className="info-box">
            <Trash2 size={17} />
            <p>重置将永久清空所有物料、库存、单据、往来单位、模板及收付款/盘点记录，包括正式数据。保留账户、登录信息、服务器配置及已保存的商户和仓库名称。</p>
          </div>
          <Button type="button" icon={Trash2} onClick={reset} busy={busy}>
            重置业务数据
          </Button>
          </section>
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
        </div>
        </div>
        <div className="modal-footer">
          <span className="settings-footer-note">{section === "general" ? "修改名称或计量单位后，点击保存设置。" : "各项操作在对应区域单独确认。"}</span>
          <Button type="button" onClick={closeSettings} disabled={busy}>
            取消
          </Button>
          {section === "general" && <Button kind="primary" type="submit" icon={Check} busy={busy} disabled={notificationDirty}>
            {busy ? "保存中…" : "保存设置"}
          </Button>}
        </div>
      </form>
    </Modal>
  );
}
createRoot(document.getElementById("root")).render(
  <PwaProvider><AuthGate>{(admin, onLogout) => <App key={admin.id} admin={admin} onLogout={onLogout} />}</AuthGate></PwaProvider>,
);
