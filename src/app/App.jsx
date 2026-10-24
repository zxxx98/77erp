import { ProductionOnlyShell } from './ProductionOnlyShell.jsx';
import { Form as AntForm } from 'antd';
import { Button as AntButton, Input as AntInput } from '../ui/controls.jsx';

import {
  Box,
  ArrowDownToLine,
  ArrowUpFromLine,
  Warehouse,
  ScanLine,
  History,
  Settings,
  ChevronDown,
  ArrowRight,
  Ellipsis,
  ChevronRight,
  Search,
  Bell,
  Megaphone,
  TriangleAlert,
  CircleHelp,
  LogOut,
  RefreshCw,
  ShieldCheck,
  PackageCheck,
  CircleCheck,
  X,
} from 'lucide-react';
import { navItems as allNavItems, modeHome, routeMode, navigationHash, modeItems } from './navigation.js';
import { ModeSwitch } from './ModeSwitch.jsx';
import './mode-switch.css';
import { mobileDevice } from '../device.js';
import { useState, useEffect, useRef } from 'react';
import { api, setWarehouseId, getWarehouseId } from '../api.js';
import { hasPermission, canManage, isProductionOnly, canViewProduction } from '../../shared/permissions.js';
import { useQuery } from '../queries.js';
import { DataUpdateNotice, useDataUpdates } from '../DataUpdates.jsx';
import { announcementsChanged, useAnnouncementQuery } from '../announcement-query.js';
import '../announcement-entry.css';
import { PermissionContext } from '../permissions.jsx';
import { LoadingIndicator } from '../Loading.jsx';
import {
  MobileShell,
  Scanner,
  Dashboard,
  Announcements,
  Quality,
  Bom,
  Production,
  AnnouncementDetail,
  AnnouncementEditor,
  Products,
  Inventory,
  Orders,
  WarehousePicker,
  DraftList,
  CategoryManager,
  ProductForm,
  MobileOrderForm,
  CameraScanner,
  OrderForm,
  MobileOrderDetail,
  OrderDetail,
  ReduceStockModal,
  StockQrManager,
  MobileProductDetail,
  ProductDetail,
  ProductCodeModal,
  AiAssistant,
  ChangePassword,
  BusinessTools,
  SettingsForm,
} from '../LazyComponents.jsx';
import { Select } from '../Dropdown.jsx';
import { stockStatus } from './format.js';
import { setCurrencySettings } from '../currency.js';
import { Button, Modal } from '../components/common.jsx';
import { version as appVersion } from '../../package.json';

const navItems = allNavItems.filter(item => mobileDevice || item.id !== 'more');

function StandardApp({ admin, onLogout }) {
  const isAdmin = admin.role === "admin";
  const preferenceKey = `77erp:mode:${admin.id || admin.username}`;
  const [initialNavigation] = useState(() => {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(preferenceKey)) || {}; } catch {}
    const initial = location.hash.slice(1).split('?')[0];
    const mode = routeMode(initial, location.hash, stored.mode === 'production' ? 'production' : 'warehouse');
    const last = stored.pages?.[mode];
    const fallback = navItems.some(item => item.id === last && (!item.mode || item.mode === mode)) ? last : modeHome(mode);
    return { mode, page: navItems.some(item => item.id === initial) ? initial : fallback, pages: stored.pages && typeof stored.pages === 'object' && !Array.isArray(stored.pages) ? stored.pages : {} };
  });
  const [mode, setMode] = useState(initialNavigation.mode);
  const [bomProduct, setBomProduct] = useState(null);
  const [productionBom, setProductionBom] = useState(null);
  const modeRef = useRef(mode);
  const lastPages = useRef(initialNavigation.pages);
  const [page, setPage] = useState(initialNavigation.page);
  const acceptedHash = useRef(location.hash || navigationHash(page, mode));
  useEffect(() => {
    lastPages.current[mode] = page;
    try { localStorage.setItem(preferenceKey, JSON.stringify({ mode, pages: lastPages.current })); } catch {}
  }, [mode, page, preferenceKey]);
  const pageRef = useRef(page);
  pageRef.current = page;
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
    if (!window.dispatchEvent(new Event('erp:before-navigate', { cancelable: true }))) return;
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
      try { d = await api("/workspace"); }
      catch (e) {
        if (e.status !== 400 || !e.message.startsWith('仓库不存在')) throw e;
        d = await api('/workspace', { warehouseId: 1 });
      }
      if (generation !== loadGeneration.current) return;
      if (d.user?.id !== admin.id) {
        window.dispatchEvent(new Event('erp:unauthorized'));
        return;
      }
      if (d.user?.permissions_version !== admin.permissions_version || d.user?.access_mode !== admin.access_mode) window.dispatchEvent(new Event('erp:permissions-changed'));
      setWarehouseId(d.warehouse_id);
      setCurrencySettings(d.settings);
      setData({ ...d, products: [], orders: [] });
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
      if (navItems.some((n) => n.id === id)) {
        if ((id !== pageRef.current || routeMode(id, location.hash, modeRef.current) !== modeRef.current) && !window.dispatchEvent(new Event('erp:before-navigate', { cancelable: true }))) {
          history.replaceState(history.state, '', location.pathname + location.search + acceptedHash.current);
          return;
        }
        const nextMode = routeMode(id, location.hash, modeRef.current);
        modeRef.current = nextMode;
        setMode(nextMode);
        acceptedHash.current = location.hash;
        pageRef.current = id;
        setPage(id);
      }
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
  const updatesAvailable = useDataUpdates(data, admin.id);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);
  const navigate = (id, filter, targetMode) => {
    if ((id !== pageRef.current || targetMode && targetMode !== modeRef.current) && !window.dispatchEvent(new Event('erp:before-navigate', { cancelable: true }))) return;
    const nextMode = targetMode || routeMode(id, '', modeRef.current);
    modeRef.current = nextMode;
    setMode(nextMode);
    pageRef.current = id;
    setPage(id);
    if (id !== 'bom') setBomProduct(null);
    if (id !== 'production') setProductionBom(null);
    acceptedHash.current = navigationHash(id, nextMode);
    if (['purchases', 'sales'].includes(id) && filter?.approval) {
      const params = new URLSearchParams({ approval: filter.approval });
      if (filter.q) params.set('q', filter.q);
      acceptedHash.current += `?${params}`;
    }
    location.hash = acceptedHash.current;
    setNotification(false);
    if (filter && !filter.approval) setInventoryFilter(filter);
    window.scrollTo({ top: 0 });
  };
  const switchMode = nextMode => {
    if (nextMode === mode || modal || cameraActive || switching) return;
    const last = lastPages.current[nextMode];
    const destination = navItems.some(item => item.id === last && (!item.mode || item.mode === nextMode)) ? last : modeHome(nextMode);
    navigate(destination, undefined, nextMode);
  };
  const notify = (message, type = "success") => setToast({ message, type });
  const saved = async (message) => {
    setModal(null);
    notify(message);
    await reload();
  };
  const switchWarehouse = async (id, skipGuard = false) => {
    if (switching || modal && modal.kind !== 'warehousePicker' || id === getWarehouseId()) return;
    if (!skipGuard && !window.dispatchEvent(new Event('erp:before-navigate', { cancelable: true }))) return;
    const generation = ++loadGeneration.current;
    setSwitching(true);
    try {
      const workspace = await api('/workspace', { warehouseId: id });
      if (generation !== loadGeneration.current) return;
      if (workspace.user?.id !== admin.id) {
        window.dispatchEvent(new Event('erp:unauthorized'));
        return;
      }
      setWarehouseId(id);
      setBomProduct(null);
      setProductionBom(null);
      setCurrencySettings(workspace.settings);
      setData({ ...workspace, products: [], orders: [] });
      setSearch(''); setNotification(false); setInventoryFilter('all'); setLoadError('');
      return true;
    } catch (e) { notify(e.message, 'error'); }
    finally { setSwitching(false); setRefreshing(false); }
  };
  const user = data.user || admin;
  const can = key => key === 'production_view' ? canViewProduction(user) : hasPermission(user, key);
  const manage = key => canManage(user, key);
  const summaryQuery = useQuery(mobileDevice || isProductionOnly(user) ? null : '/dashboard', data);
  const announcementQuery = useAnnouncementQuery(isProductionOnly(user) ? null : '/announcements/unread-count', data);
  const announcementCount = announcementQuery.result?.count || 0;
  const announcementSaved = async message => { announcementsChanged(); await saved(message); };
  const low = summaryQuery.result?.products.low_stock_products || [];
  const lowCount = (summaryQuery.result?.products.low_stock || 0) + (summaryQuery.result?.products.out_of_stock || 0);
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
  const visibleNav = modeItems(mode, can);
  const currentNav = navItems.find((n) => n.id === page);
  const updateNotice = updatesAvailable ? <DataUpdateNotice onRefresh={reload} busy={refreshing} disabled={!!modal} /> : null;
  if (isProductionOnly(user)) return <ProductionOnlyShell admin={user} onLogout={onLogout} />;
  return (
    <PermissionContext.Provider value={user}><div className="app-shell">
      {switching && <div className="warehouse-switch-loading" role="status"><LoadingIndicator size={48} />正在切换仓库…</div>}
      {mobileDevice ? <div inert={!!modal} aria-hidden={modal ? true : undefined}><MobileShell mode={mode} switchMode={switchMode} user={user} data={data} page={page} navigate={navigate} openModal={setModal} openOrder={openOrder}
        showProduct={product => setModal({ kind: 'productDetail', product })} showOrder={openOrderDetail}
        switchWarehouse={switchWarehouse} loading={loading} switching={switching} loadError={loadError} reload={reload} onSaved={saved} refreshing={refreshing}
        loggingOut={loggingOut} logout={logout}
        updateNotice={updateNotice}
        announcementCount={announcementCount}
        renderAnnouncements={() => <Announcements data={data} openModal={setModal} />}
        renderQuality={() => can('quality') ? <Quality key={data.warehouse_id} data={data} initialArea="acceptances" onConfigure={() => setModal({ kind: 'settings', section: 'data' })} /> : <div className="info-box">没有品质管理权限，请联系管理员。</div>}
        renderBom={() => can('bom') ? <Bom key={`${data.warehouse_id}:${bomProduct?.id || 'all'}`} data={data} initialProduct={bomProduct} onCreateProduction={can('production') ? bom => { setProductionBom(bom); navigate('production'); } : undefined} /> : <div className="info-box">没有BOM权限，请联系管理员。</div>}
        renderProduction={() => canViewProduction(user) ? <Production key={`${data.warehouse_id}:${user.permissions_version}`} data={data} initialBom={productionBom} onChanged={reload} onNavigate={navigate} onSwitchWarehouse={id => switchWarehouse(id, true)} /> : <div className="info-box">没有生产单权限，请联系管理员。</div>}
        renderScanner={() => <Scanner key={data.warehouse_id} data={data} openOrder={openOrder} notify={notify} userKey={admin.id || admin.username} isAdmin={manage('business')} onSaved={async message => { notify(message); await reload(); }} manageStockQr={() => setModal({ kind: 'stockQr' })} />}
      /></div> : <>
      <aside className="sidebar" inert={switching}>
        <a
          className="brand"
          href={navigationHash(modeHome(mode), mode)}
          onClick={event => { event.preventDefault(); navigate(modeHome(mode)); }}
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
        <ModeSwitch mode={mode} onChange={switchMode} disabled={!!modal || switching} />
        <AntButton type="text" htmlType="button"
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
        </AntButton>
        <div className="nav-label">{mode === 'production' ? '生产管理' : '仓储管理'}</div>
        <nav aria-label="主导航">
          {visibleNav.filter(item => item.group === 'main').map(({ id, name, icon: Icon }) => (
            <a
              key={id}
              href={navigationHash(id, mode)}
              aria-label={name}
              title={name}
              className={`nav-item ${page === id ? "active" : ""}`}
              onClick={event => { event.preventDefault(); navigate(id); }}
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
          {visibleNav.filter(item => item.group === 'tools').map(({ id, name, icon: Icon }) => (
            <a
              key={id}
              href={navigationHash(id, mode)}
              aria-label={name}
              title={name}
              className={`nav-item ${page === id ? "active" : ""}`}
              onClick={event => { event.preventDefault(); navigate(id); }}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span>{name}</span>
              {id === 'announcements' && announcementCount > 0 && <span className="announcement-entry-count" aria-label={`${announcementCount} 条未读公告`}>{announcementCount > 99 ? '99+' : announcementCount}</span>}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {mode === 'warehouse' && <div className="sidebar-tip">
            <span className="tip-icon">
              <ScanLine size={19} />
            </span>
            <strong>扫码管理</strong>
            <p>使用手机摄像头识别物料条码。</p>
            <AntButton type="text" htmlType="button" onClick={() => navigate("scanner")}>
              打开扫码工作台 <ArrowRight size={13} />
            </AntButton>
          </div>}
          <AntButton type="text" htmlType="button" className="nav-item" onClick={() => setModal({ kind: 'businessTools' })}>
            <History size={18} /><span>业务管理</span>
          </AntButton>
          {can('ai') && <AntButton type="text" htmlType="button" className="nav-item" onClick={() => setModal({ kind: 'ai' })}><Settings size={18} /><span>AI 助手</span></AntButton>}
          {isAdmin && <AntButton type="text" htmlType="button" className="nav-item" aria-label="系统设置" title="系统设置" onClick={() => setModal({ kind: 'settings' })}>
            <Settings size={18} /><span>系统设置</span>
          </AntButton>}
          <AntButton type="text" htmlType="button"
            className="user-profile"
            onClick={() => setModal({ kind: "account" })}
          >
            <span className="avatar">{(user.name || user.username).slice(0, 1).toUpperCase()}</span>
            <span>
              <strong>{user.name || user.username}</strong>
              <small>{isAdmin ? "管理员" : "员工"}</small>
            </span>
            <Ellipsis size={18} />
          </AntButton>
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
            <Select className="warehouse-select" aria-label="当前仓库" value={data.warehouse_id || 1} disabled={switching || !!modal || loading} onChange={e => switchWarehouse(Number(e))}>
              {(data.warehouses || []).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
            <div className={`sync-state${updatesAvailable ? ' pending' : ''}`}>
              <i />
              {refreshing ? '正在刷新' : updatesAvailable ? '有数据变更' : '数据已读取'}
            </div>
            <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }}
              className="global-search"
              onFinish={() => {

                navigate("products");
              }}
            >
              <AntInput prefix={<Search size={16} />} suffix={<kbd>⌘ K</kbd>}
                ref={searchRef}
                aria-label="搜索物料或条码"
                placeholder="搜索物料、条码…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </AntForm>
            <div className="notification-wrap">
              <AntButton type="text" htmlType="button"
                className={`icon-button notification-button ${notification ? "selected" : ""}`}
                aria-label="库存提醒"
                onClick={() => setNotification(!notification)}
              >
                <Bell size={19} />
                {low.length > 0 && <i />}
              </AntButton>
              {notification && (
                <div className="notification-popover">
                  <div className="popover-title">
                    <strong>库存提醒</strong>
                    <span>{lowCount} 条</span>
                  </div>
                  {low.length ? (
                    low.map((p) => (
                      <AntButton type="text" htmlType="button"
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
                      </AntButton>
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
            <AntButton type="text" htmlType="button"
              className="icon-button help-button"
              aria-label="使用帮助"
              onClick={() => setModal({ kind: "help" })}
            >
              <CircleHelp size={19} />
            </AntButton>
            <span className="topbar-divider" />
            <AntButton type="text" htmlType="button"
              className="avatar avatar-small"
              aria-label={isAdmin ? "商户设置" : "账户设置"}
              onClick={() => setModal({ kind: isAdmin ? "settings" : "account" })}
            >
              {(user.name || user.username).slice(0, 1).toUpperCase()}
            </AntButton>
            <AntButton type="text" htmlType="button"
              className="icon-button logout-button"
              aria-label="退出登录"
              title="退出登录"
              onClick={logout}
              disabled={loggingOut}
              aria-busy={loggingOut}
            >
              {loggingOut ? <LoadingIndicator size={20} /> : <LogOut size={18} />}
            </AntButton>
          </div>
        </header>
        <main key={data.warehouse_id || 1} className="main-content" inert={switching}>
          {updateNotice}
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
              {page === 'announcements' && <Announcements data={data} openModal={setModal} />}
              {page === 'quality' && can('quality') && <Quality data={data} onConfigure={() => setModal({ kind: 'settings', section: 'data' })} />}
              {page === 'quality' && !can('quality') && <div className="info-box">没有品质管理权限，请联系管理员。</div>}
              {page === 'bom' && (can('bom') ? <Bom key={`${data.warehouse_id}:${bomProduct?.id || 'all'}`} data={data} initialProduct={bomProduct} onCreateProduction={can('production') ? bom => { setProductionBom(bom); navigate('production'); } : undefined} /> : <div className="info-box">没有BOM权限，请联系管理员。</div>)}
              {page === 'production' && (canViewProduction(user) ? <Production key={`${data.warehouse_id}:${user.permissions_version}`} data={data} initialBom={productionBom} onChanged={reload} onNavigate={navigate} onSwitchWarehouse={id => switchWarehouse(id, true)} /> : <div className="info-box">没有生产单权限，请联系管理员。</div>)}
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
                  increaseStock={product => setModal({ kind: "increase", product })}
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
                  onChanged={reload}
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
      {modal?.kind === 'announcementDetail' && <AnnouncementDetail id={modal.id} data={data} onClose={() => setModal(null)} onEdit={item => setModal({ kind: 'announcementEditor', item })} onSaved={announcementSaved} onRead={reload} />}
      {modal?.kind === 'announcementEditor' && user.role === 'admin' && <AnnouncementEditor key={modal.item?.id || 'new'} item={modal.item} onClose={() => setModal(null)} onSaved={announcementSaved} />}
      {modal?.kind === "detail" && (
        mobileDevice ? <MobileOrderDetail order={modal.order} Modal={Modal} onClose={() => setModal(null)} onSaved={saved} /> : <OrderDetail isAdmin={isAdmin} order={modal.order} onClose={() => setModal(null)} onSaved={saved} />
      )}
      {["reduce", "increase"].includes(modal?.kind) && can('stocktake') && (
        <ReduceStockModal
          increase={modal.kind === "increase"}
          product={modal.product}
          onClose={() => setModal(null)}
          onSaved={saved}
        />
      )}
      {manage('business') && modal?.kind === "stockQr" && <StockQrManager data={data} initialProduct={modal.product} Modal={Modal} CameraScanner={CameraScanner} onClose={() => setModal(null)} />}
      {modal?.kind === "productDetail" && (mobileDevice ? <MobileProductDetail product={data.products.find(p => p.id === modal.product.id) || modal.product} data={data} Modal={Modal} openOrder={openOrder} openModal={setModal} openOrderDetail={openOrderDetail} onClose={() => setModal(null)} onSaved={saved} onViewBom={() => { const product = modal.product; setModal(null); navigate('bom'); setBomProduct(product); }} /> : <ProductDetail product={modal.product} data={data} warehouseName={data.settings.warehouse_name} onViewOrder={openOrderDetail} onClose={() => setModal(null)} onViewBom={() => { const product = modal.product; setModal(null); navigate('bom'); setBomProduct(product); }} />)}
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
      {can('ai') && modal?.kind === 'ai' && <Modal title="AI 助手" subtitle="库存与业务，随时问我" className="ai-modal" wide onClose={() => setModal(null)}><AiAssistant key={`${user.id}:${user.permissions_version}:${user.production_group_id}:${user.access_mode}`} mode={mode} userId={user.id} warehouseName={data.settings.warehouse_name} onChanged={reload} /></Modal>}
      {modal?.kind === "account" && <Modal title="账户设置" onClose={() => setModal(null)}><div className="form-body"><p>{user.name || user.username}（{user.username}） · {isAdmin ? '管理员' : '员工'}</p><ChangePassword onChanged={onLogout} /></div></Modal>}
      {modal?.kind === 'businessTools' && <Modal title="业务管理" subtitle="管理业务资料、财务、盘点与物料导入" wide className="business-modal" onClose={() => setModal(null)}>
        <div className="form-body"><BusinessTools data={data} warehouses={data.warehouses} warehouseId={data.warehouse_id} onSaved={saved} initialTab={modal.initialTab}
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
          <AntButton type="text" htmlType="button" aria-label="关闭通知" onClick={() => setToast(null)}>
            <X size={14} />
          </AntButton>
        </div>
      )}
    </div></PermissionContext.Provider>
  );
}

function App(props) { return isProductionOnly(props.admin) ? <ProductionOnlyShell {...props} /> : <StandardApp {...props} />; }
export { App };
