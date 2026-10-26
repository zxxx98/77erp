import { localizeError } from '../i18n/errors.js';
import { ExportLanguageSelect } from '../ExportLanguageSelect.jsx';
import { describeStockExpression, inspectionCycleLabel } from '../warehouse-format.js';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher.jsx';
import { t as translate, getFormatLocale, translateText, getLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Button as AntButton, Checkbox as AntCheckbox } from '../ui/controls.jsx';
import { TabBar } from 'antd-mobile';

import { Select } from './../Dropdown.jsx';
import { canViewProduction } from '../../shared/permissions.js';
import { modeItems } from '../app/navigation.js';
import { ModeSwitch } from '../app/ModeSwitch.jsx';
import { useQuery, usePagedQuery, queryPath } from '../queries.js';
import { LoadingIndicator, LoadingStatus } from '../Loading.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Box, ChevronDown, FilePenLine, History, LayoutDashboard, LogOut, Megaphone, Plus, RefreshCw, ScanLine, Settings, ShieldCheck, Warehouse } from 'lucide-react';
import { usePermissions } from '../permissions.jsx';
import { flattenCategories } from '../catalog.js';
import { api } from '../api.js';
import { orderLabel } from '../order-utils.js';
import { OfflineNotice, PwaActions, usePwa } from '../pwa/Pwa.jsx';
import { draftScope, listDrafts, removeDraft } from '../pwa/drafts.js';
import { download } from '../data-files.js';
import { ProductImage } from '../ProductImage.jsx';
import { CustomerPartNumbersDetail } from '../CustomerPartNumbers.jsx';
import { ProductHistory } from '../ProductHistory.jsx';
import { evaluateStockExpression } from '../../shared/stock-compare.js';
import { MobileButton as Button, MobileIcon, Notice, Chips, SearchField, ProductRow, Empty, money, price, count, dateTime, DetailRow, StockBadge } from './ui.jsx';
import { InspectionPanel } from '../InspectionPanel.jsx';

import { ProductBatchDialog } from '../pages/Products.jsx';
import { OrderApprovalWorkspace } from '../features/OrderApprovalWorkspace.jsx';

export function MobileShell({ mode, switchMode, user, data, page, navigate, openModal, openOrder, showProduct, showOrder, switchWarehouse, loading, switching, loadError, reload, onSaved, refreshing, loggingOut, logout, renderScanner, renderAnnouncements, renderQuality, renderBom, renderProduction, announcementCount, updateNotice }) {
  useLocale();
  const { can } = usePermissions();
  const tabs = modeItems(mode, key => key === 'production_view' ? canViewProduction(user) : can(key)).filter(item => item.mobile);
  const { online } = usePwa();
  const [updated, setUpdated] = useState(null);
  const dataRef = useRef(data);
  useEffect(() => { if (dataRef.current !== data) { setUpdated(new Date()); dataRef.current = data; } }, [data]);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let baseline = viewport.height;
    const adapt = () => {
      const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
      if (!editing && viewport.scale === 1) baseline = viewport.height;
      const keyboard = editing && viewport.scale === 1 && baseline - viewport.height > 150;
      document.documentElement.classList.toggle('mw-keyboard', keyboard);
      document.documentElement.style.setProperty('--mw-viewport-height', `${viewport.height}px`);
      document.documentElement.style.setProperty('--mw-viewport-top', `${viewport.offsetTop}px`);
    };
    const rotate = () => { baseline = viewport.height; adapt(); };
    viewport.addEventListener('resize', adapt);
    viewport.addEventListener('scroll', adapt);
    window.addEventListener('orientationchange', rotate);
    document.addEventListener('focusin', adapt);
    document.addEventListener('focusout', adapt);
    adapt();
    return () => {
      viewport.removeEventListener('resize', adapt); viewport.removeEventListener('scroll', adapt);
      window.removeEventListener('orientationchange', rotate);
      document.removeEventListener('focusin', adapt); document.removeEventListener('focusout', adapt);
      document.documentElement.classList.remove('mw-keyboard');
    };
  }, []);
  const ready = !!data.warehouse_id;
  return <div className="mw-shell">
    <div className="mw-topbar">
      <header className="mw-header" inert={switching}>
        <div className="mw-header-main">
          {page === 'scanner' ? <><MobileIcon icon={ArrowLeft} label={translate("warehouse.return.to.workbench")} onClick={() => navigate('overview')} /><strong className="mw-modal-title">{translate("warehouse.scanning.workbench")}</strong></> : <>
            <strong className="mw-wordmark">77 <span>ERP</span></strong>
            {can('basic_view') && <AntButton type="text" htmlType="button" className="mw-icon announcement-entry" aria-label={translate("warehouse.announcement.center")} onClick={() => navigate('announcements')} disabled={!ready}><Megaphone size={22} />{announcementCount > 0 && <span className="announcement-entry-count" aria-label={translate("warehouse.unread.announcements", { v0: announcementCount })}>{announcementCount > 99 ? '99+' : announcementCount}</span>}</AntButton>}
            {can('basic_view') && <MobileIcon icon={ScanLine} label={translate("warehouse.open.the.qr.code.scanning.workbench")} onClick={() => navigate('scanner')} disabled={!ready} />}
          </>}
          <LanguageSwitcher iconOnly />
        </div>
        {page !== 'scanner' && <AntButton type="text" htmlType="button" className="mw-warehouse" disabled={!ready || loading || switching} aria-label={translate("warehouse.switch.warehouse")} title={data.settings.warehouse_name} onClick={() => openModal({ kind: 'warehousePicker' })}>
          <Warehouse size={17} aria-hidden="true" /><span className="mw-warehouse-name">{data.settings.warehouse_name}</span><ChevronDown size={16} aria-hidden="true" />
        </AntButton>}
      </header>
      <div className="mw-mode-bar"><ModeSwitch mode={mode} onChange={switchMode} disabled={switching || !ready} /></div>
    </div>
    <OfflineNotice />
    <main className="mw-content" inert={switching}>
      {updateNotice}
      {loading && !ready ? <div className="mw-empty" role="status"><LoadingIndicator size={64} /><p>{translate("warehouse.reading.inventory")}</p></div> : <>
        {loadError && <div className="mw-stack"><Notice>{loadError}{ready ? translate("warehouse.the.last.read.data.is.currently.displayed") : ''}</Notice><Button icon={RefreshCw} busy={refreshing} onClick={reload}>{translate("warehouse.resync")}</Button></div>}
        {!ready && !loadError && <Empty title={translate("warehouse.waiting.to.connect.to.workspace")} />}
        {ready && <>
          {page === 'overview' && <Dashboard data={data} openOrder={openOrder} onScan={() => navigate('scanner')} showProduct={showProduct} showOrder={showOrder} history={() => navigate('history')} />}
          {['products', 'inventory'].includes(page) && <Products key={`${data.warehouse_id}:${page}`} data={data} inventory={page === 'inventory'} showProduct={showProduct} openModal={openModal} onSaved={onSaved || reload} />}
          {['history', 'purchases', 'sales'].includes(page) && <Orders key={`${data.warehouse_id}:${page}`} data={data} initial={page === 'purchases' ? 'in' : page === 'sales' ? 'out' : 'all'} openOrder={openOrder} showOrder={showOrder} onChanged={reload} />}
          {page === 'more' && <More mode={mode} user={user} data={data} navigate={navigate} openModal={openModal} loggingOut={loggingOut} logout={logout} />}
          {page === 'quality' && renderQuality()}
          {page === 'bom' && renderBom()}
          {page === 'production' && renderProduction()}
          {page === 'scanner' && renderScanner()}
          {page === 'announcements' && renderAnnouncements()}
          <div className="mw-refresh"><span className="mw-muted">{updated ? translate("warehouse.read.at", { v0: updated.toLocaleTimeString(getFormatLocale(), { hour12: false }) }) : translate("warehouse.data.is.saved.on.the.server")}</span><AntButton type="default" htmlType="button" onClick={reload} disabled={refreshing || !online} aria-busy={refreshing}>{refreshing ? <LoadingIndicator size={20} /> : <RefreshCw size={15} />}{translate("warehouse.refresh.data")}</AntButton></div>
        </>}
      </>}
    </main>
    {page !== 'scanner' && <nav className="mw-tabs" aria-label={translate("warehouse.mobile.terminal.main.navigation")} inert={switching}>
      <TabBar safeArea activeKey={['purchases', 'sales'].includes(page) ? 'history' : page} onChange={navigate}>
        {tabs.map(({ id, mobile: label, icon: Icon }) => <TabBar.Item key={id} title={active => <button type="button" aria-current={active ? 'page' : undefined} aria-label={label}><Icon size={23} /><span>{label}</span></button>} />)}
      </TabBar>
    </nav>}
  </div>;
}

function Dashboard({ data, openOrder, onScan, showProduct, showOrder, history }) {
  useLocale();
  const { costs } = usePermissions();
  const { result: summary, error } = useQuery('/dashboard', data);
  const low = summary?.products.low_stock_products || [];
  const recent = summary?.recent_orders || [];
  const stats = [
    [translate("warehouse.material.type"), summary ? count(summary.products.total) : '—', Box],
    [translate("warehouse.inventory.cost"), summary && costs ? money((summary.products.inventory_value_cents ?? 0) / 100) : '—', Warehouse],
    [translate("warehouse.today.s.purchase"), summary ? money((summary.today.purchase_cents || 0) / 100) : '—', ArrowDownToLine],
    [translate("warehouse.today.s.sales"), summary ? money((summary.today.sales_cents || 0) / 100) : '—', ArrowUpFromLine],
  ];
  return <div className="mw-stack">
    <div><h1>{translate("warehouse.dashboard")}</h1><p className="mw-muted">{data.settings.business_name} · {data.settings.warehouse_name}</p></div>
    <Notice>{error}</Notice>
    <div className="mw-stats">{stats.map(([label, value, Icon]) => <section className="mw-stat" key={label}><div><span className="mw-muted">{label}</span><Icon size={18} /></div><strong>{value}</strong></section>)}</div>
    <InspectionPanel key={data.warehouse_id} data={data} />
    <section className="mw-card mw-stack"><h2>{translate("warehouse.quick.operation.2")}</h2><Button primary icon={ScanLine} onClick={onScan}>{translate("warehouse.scan.material.barcode")}</Button><div className="mw-columns"><Button permission="purchase" icon={ArrowDownToLine} onClick={() => openOrder('in')}>{translate("warehouse.stock.in")}</Button><Button permission="sale" icon={ArrowUpFromLine} onClick={() => openOrder('out')}>{translate("warehouse.stock.out")}</Button></div></section>
    <section className="mw-card mw-stack"><div className="mw-between"><h2>{translate("warehouse.stock.alert")}</h2><span className="mw-warning">{summary ? translate("warehouse.items.3", { v0: summary.products.low_stock + summary.products.out_of_stock }) : '—'}</span></div>{low.length ? low.map(p => <ProductRow key={p.id} product={p} onOpen={showProduct} />) : <p className="mw-muted">{translate("warehouse.all.materials.are.in.sufficient.stock")}</p>}</section>
    <section className="mw-card mw-stack"><h2>{translate("warehouse.latest.documents")}</h2>{recent.map(o => <OrderSummary key={o.id} order={o} onOpen={showOrder} />)}{summary && !recent.length && <p className="mw-muted">{translate("warehouse.there.is.no.document.yet.create.the.first.receipt.document.to")}</p>}<Button onClick={history}>{translate("warehouse.view.all.documents")}</Button></section>
  </div>;
}

function Products({ data, inventory, showProduct, openModal, onSaved }) {
  useLocale();
  const { can, manage } = usePermissions();
  const { online } = usePwa();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [filter, setFilter] = useState(inventory ? 'all' : 'active');
  const [batchSelecting, setBatchSelecting] = useState(false);
  const [selectedMap, setSelectedMap] = useState(() => new Map());
  const [batchMode, setBatchMode] = useState(null);
  const categories = flattenCategories(data.categories || []);
  useEffect(() => { if (category !== 'all' && !categories.some(c => String(c.id) === category)) setCategory('all'); }, [data.categories, category]);
  useEffect(() => {
    setSelectedMap(new Map());
    setBatchMode(null);
  }, [query, category, filter, data.warehouse_id]);
  const { result, error, loading, loadMore, retry } = usePagedQuery(queryPath('/products', {
    q: query, category_id: category, status: inventory ? 'active' : filter, stock: inventory ? filter : 'all',
  }), data, 'products', query ? 250 : 0);
  const products = result?.products || [];
  useEffect(() => {
    if (!products.length) return;
    setSelectedMap(prev => {
      if (!prev.size) return prev;
      let changed = false;
      const next = new Map(prev);
      for (const p of products) {
        const existing = next.get(p.id);
        if (existing && (existing.name !== p.name || existing.barcode !== p.barcode || existing.active !== p.active)) {
          next.set(p.id, { id: p.id, name: p.name, barcode: p.barcode, active: p.active });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [products]);
  const selectedList = [...selectedMap.values()];
  const activeSelected = selectedList.filter(p => p.active !== 0);
  const selectedLoadedCount = products.filter(p => selectedMap.has(p.id)).length;
  const allLoadedSelected = products.length > 0 && selectedLoadedCount === products.length;
  const someLoadedSelected = selectedLoadedCount > 0 && !allLoadedSelected;
  const toggleSelect = (p) => {
    setSelectedMap(prev => {
      const next = new Map(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.set(p.id, { id: p.id, name: p.name, barcode: p.barcode, active: p.active });
      return next;
    });
  };
  const toggleSelectAllLoaded = () => {
    setSelectedMap(prev => {
      const next = new Map(prev);
      if (allLoadedSelected) {
        for (const p of products) next.delete(p.id);
      } else {
        for (const p of products) next.set(p.id, { id: p.id, name: p.name, barcode: p.barcode, active: p.active });
      }
      return next;
    });
  };
  const handleBatchCompleted = async ({ clearedIds, message }) => {
    if (clearedIds?.length) {
      setSelectedMap(prev => {
        const next = new Map(prev);
        for (const id of clearedIds) next.delete(id);
        return next;
      });
    }
    retry();
    if (onSaved && message) await onSaved(message);
  };
  return <div className="mw-stack">
    <div className="mw-between"><div><h1>{inventory ? translate("warehouse.inventory.management") : translate("warehouse.material.management")}</h1><p className="mw-muted">{translate("warehouse.total.2")}{" "}{result ? result.total : '—'}{" "}{translate("warehouse.material.loaded")}{" "}{products.length}{" "}{translate("warehouse.types")}</p></div>{!inventory && can('products') && <MobileIcon icon={Plus} label={translate("warehouse.add.new.material")} onClick={() => openModal({ kind: 'product' })} />}</div>
    {!inventory && manage('products') && (
      <div className="mw-columns">
        <Button onClick={() => openModal({ kind: 'categories' })}>{translate("warehouse.management.classification")}</Button>
        <Button
          primary={batchSelecting}
          onClick={() => {
            setBatchSelecting(v => !v);
            setSelectedMap(new Map());
            setBatchMode(null);
          }}
        >
          {batchSelecting ? translate("warehouse.exit.batch") : translate("warehouse.batch")}
        </Button>
      </div>
    )}
    <SearchField value={query} onChange={setQuery} label={translate("warehouse.search.by.name.barcode.specification.or.customer.part.number")} />
    <Chips label={inventory ? translate("warehouse.stock.filter") : translate("warehouse.use.status")} value={filter} onChange={setFilter} options={inventory ? [['all', translate("warehouse.all.in.stock")], ['low', translate("warehouse.stock.alert")], ['empty', translate("warehouse.out.of.stock.2")]] : [['all', translate("warehouse.all.status")], ['active', translate("warehouse.enabled")], ['inactive', translate("warehouse.deactivated")]]} />
    <label className="mw-field"><span>{translate("warehouse.material.categories")}</span><Select value={category} onChange={e => setCategory(e)}><option value="all">{translate("warehouse.all.categories")}</option>{categories.map(c => <option key={c.id} value={c.id}>{c.path}</option>)}</Select></label>
    <Notice>{error}</Notice>{error && <Button onClick={retry}>{translate("warehouse.reload")}</Button>}
    {batchSelecting && products.length > 0 && (
      <div className="mw-batch-header">
        <AntCheckbox className="mw-batch-check-all" indeterminate={someLoadedSelected} aria-label={translate("warehouse.select.all.materials.on.this.page")} checked={allLoadedSelected} onChange={toggleSelectAllLoaded}>

          <span>{translate("warehouse.select.all.loaded")}</span>
        </AntCheckbox>
        <span className="mw-muted">{translate("warehouse.selected")}{" "}{selectedList.length}{" "}{translate("warehouse.items.2")}</span>
      </div>
    )}
    {loading && !products.length && <LoadingStatus block>{translate("warehouse.reading.material.2")}</LoadingStatus>}
    <div className="mw-product-list" aria-busy={loading}>{products.map(p => <ProductRow key={p.id} product={p} onOpen={showProduct} selectable={batchSelecting} selected={selectedMap.has(p.id)} onToggle={toggleSelect} />)}</div>
    {!loading && !products.length && !error && <Empty title={translate("warehouse.material.not.found.2")}>{translate("warehouse.try.adjusting.the.filter.conditions.or.adding.a.new.material.file")}</Empty>}
    {result?.has_more && <Button busy={loading} onClick={loadMore}>{translate("warehouse.load.more.materials")}</Button>}
    {batchSelecting && manage('products') && (
      <div className="mw-batch-bar" role="region" aria-label={translate("warehouse.batch.operation.bar")}>
        <div className="mw-batch-summary">
          <strong>{translate("warehouse.selected")}{" "}{selectedList.length}{" "}{translate("warehouse.items.2")}</strong>
          {selectedList.length > 0 && (
            <AntButton type="text" htmlType="button" className="mw-batch-clear" onClick={() => setSelectedMap(new Map())}>{translate("warehouse.clear.selection")}</AntButton>
          )}
        </div>
        <div className="mw-batch-buttons">
          <Button disabled={!online || activeSelected.length === 0} onClick={() => setBatchMode('deactivate')}>{translate("warehouse.deactivate.selected")}</Button>
          <Button danger disabled={!online || selectedList.length === 0} onClick={() => setBatchMode('delete')}>{translate("warehouse.delete.selected")}</Button>
        </div>
      </div>
    )}
    {batchSelecting && manage('products') && batchMode && (
      <ProductBatchDialog
        mode={batchMode}
        selectedProducts={selectedList}
        onClose={() => setBatchMode(null)}
        onCompleted={handleBatchCompleted}
      />
    )}
  </div>;
}

function OrderSummary({ order, onOpen }) {
  useLocale();
  return <AntButton type="text" htmlType="button" className="mw-order-summary" onClick={() => onOpen(order)}>
    <strong>{orderLabel(order)} · {order.partner}</strong><span className="mw-muted">{order.number}</span><span className="mw-muted">{dateTime(order.created_at)}</span><strong className={order.type === 'in' ? 'mw-blue' : 'mw-green'}>{order.kind === 'transfer' ? translate("warehouse.no.financial.amount") : `${order.kind === 'internal' ? translate("warehouse.reference.2") : ''}${money(order.total)}`}</strong>
  </AntButton>;
}

function Orders({ data, initial, openOrder, showOrder, onChanged }) {
  useLocale();
  return <div className="mw-stack">
    <h1>{initial === 'in' ? translate("warehouse.stock.in") : initial === 'out' ? translate("warehouse.stock.out") : translate("warehouse.activity.history")}</h1>
    <div className="mw-columns"><Button permission="purchase" icon={ArrowDownToLine} onClick={() => openOrder('in')}>{translate("warehouse.new.stock.in")}</Button><Button permission="sale" primary icon={ArrowUpFromLine} onClick={() => openOrder('out')}>{translate("warehouse.new.stock.out")}</Button></div>
    <OrderApprovalWorkspace data={data} type={initial} onChanged={onChanged}>
      <OrderRecords data={data} initial={initial} showOrder={showOrder} />
    </OrderApprovalWorkspace>
  </div>;
}

function OrderRecords({ data, initial, showOrder }) {
  useLocale();
  const { can } = usePermissions();
  const { online } = usePwa();
  const [query, setQuery] = useState('');
  const [type, setType] = useState(initial);
  const [period, setPeriod] = useState('all');
  const [exporting, setExporting] = useState(false);
  const [exportLanguage, setExportLanguage] = useState('');
  const [exportError, setExportError] = useState('');
  const { result, error, loading, loadMore, retry } = usePagedQuery(queryPath('/orders', {
    q: query, kind: ['transfer', 'internal'].includes(type) ? type : null, business: ['in', 'out'].includes(type) ? type : null,
    from: period === 'all' ? null : new Date(Date.now() - Number(period) * 86400000).toISOString().slice(0, 10),
  }), data, 'orders', query ? 250 : 0);
  const orders = result?.orders || [];
  const exportOrders = async () => {
    const language = exportLanguage || getLocale();
    const exportText = key => translate(key, { lng: language });
    if (exporting) return;
    setExporting(true); setExportError('');
    try {
      const rows = await api('/orders/export');
      const cell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
      const csv = '\uFEFF' + [[exportText("warehouse.document.no"), exportText("warehouse.type"), exportText("warehouse.business.partner"), exportText("warehouse.time"), exportText("warehouse.amount")], ...rows.map(o => [o.number, orderLabel(o, language), o.partner, o.created_at, Number(o.total).toFixed(2)])].map(row => row.map(cell).join(',')).join('\r\n');
      await download(csv, '77erp-orders.csv', 'text/csv;charset=utf-8');
    } catch (e) { setExportError(e.message); }
    finally { setExporting(false); }
  };
  return <div className="mw-stack">
    <SearchField value={query} onChange={setQuery} label={translate("warehouse.search.document.number.dealing.unit.or.material")} />
    <Chips label={translate("warehouse.document.type")} value={type} onChange={setType} options={ [['all', translate("warehouse.all.documents")], ['in', translate("warehouse.stock.in")], ['out', translate("warehouse.stock.out")], ['transfer', translate("warehouse.warehouse.transfer")], ['internal', translate("warehouse.internal.movement")]] } />
    <Chips label={translate("warehouse.document.time")} value={period} onChange={setPeriod} options={ [['all', translate("warehouse.all.time")], ['7', translate("warehouse.last.7.days")], ['30', translate("warehouse.last.30.days")]] } />
    <p className="mw-muted">{translate("warehouse.total.2")}{" "}{result ? result.total : '—'}{" "}{translate("warehouse.documents.loaded")}{" "}{orders.length}{" "}{translate("warehouse.documents")}</p>
    <Notice>{error || exportError}</Notice>{error && <Button onClick={retry}>{translate("warehouse.reload")}</Button>}{loading && <LoadingStatus>{translate("warehouse.reading.document")}</LoadingStatus>}
    {orders.map(o => <section key={o.id} className="mw-card"><OrderSummary order={o} onOpen={showOrder} /></section>)}
    {!loading && !orders.length && !error && <Empty title={translate("warehouse.no.documents.yet")}>{translate("warehouse.adjust.filter.conditions.or.create.your.first.document")}</Empty>}
    {result?.has_more && <Button busy={loading} onClick={loadMore}>{translate("warehouse.load.more.documents")}</Button>}
    {can('data_io') && <><ExportLanguageSelect value={exportLanguage} onChange={setExportLanguage} disabled={exporting} /><Button busy={exporting} disabled={!online} onClick={exportOrders}>{translate("warehouse.export.documents")}</Button></>}
  </div>;
}

function More({ mode, user, data, navigate, openModal, loggingOut, logout }) {
  useLocale();
  const { manage, can } = usePermissions();
  return <div className="mw-stack"><h1>{translate("warehouse.workspace")}</h1>
    <section className="mw-card"><div className="mw-account"><ShieldCheck size={30} /><div><h2>{user.name || user.username}</h2><p className="mw-muted">{translate("warehouse.account")}{user.username}</p><p className="mw-muted">{user.role === 'admin' ? translate("warehouse.administrator.account") : translate("warehouse.employee.account")}</p></div></div></section>
    {(user.role === 'admin' || user.permissions?.includes('ai')) && <section className="mw-card"><Button icon={Settings} onClick={() => openModal({ kind: 'ai' })}>{translate("warehouse.ai.assistant")}</Button></section>}
    {mode === 'production' && can('quality') && <section className="mw-card"><Button icon={FilePenLine} onClick={() => navigate('quality')}>{translate("warehouse.quality.online.acceptance")}</Button></section>}
    {mode === 'production' && can('bom') && <section className="mw-card"><Button onClick={() => navigate('bom')}>{translate("warehouse.bom.material.preparation.calculation")}</Button></section>}
    {mode === 'production' && canViewProduction(user) && <section className="mw-card"><Button onClick={() => navigate('production')}>{translate("warehouse.production.order.batch.registration")}</Button></section>}
    <section className="mw-card mw-stack"><h2>{data.settings.business_name}</h2><p className="mw-muted">{data.settings.warehouse_name}</p>{user.role === 'admin' && <Button icon={Settings} onClick={() => openModal({ kind: 'settings' })}>{translate("warehouse.merchant.and.warehouse.settings")}</Button>}</section>
    <Button icon={Settings} onClick={() => openModal({ kind: 'preferences' })}>{translate("warehouse.user.habits")}</Button>
    <Button onClick={() => openModal({ kind: 'account' })}>{translate("warehouse.change.password")}</Button><Button onClick={() => openModal({ kind: 'businessTools' })}>{translate("warehouse.business.management")}</Button>
    {manage('business') && <Button onClick={() => openModal({ kind: 'stockQr' })}>{translate("warehouse.inbound.and.outbound.qr.code")}</Button>}
    <Button icon={FilePenLine} onClick={() => openModal({ kind: 'drafts' })}>{translate("warehouse.local.draft")}</Button>
    <section className="mw-card"><p className="mw-field-label">{translate("warehouse.server.address")}</p><p className="mw-muted mw-break">{location.origin}</p></section>
    <Button danger icon={LogOut} busy={loggingOut} onClick={() => { if (window.confirm(translate("warehouse.log.out.the.local.draft.of.this.account.will.be.cleared"))) logout(); }}>{translate("warehouse.log.out")}</Button>
    <PwaActions /><p className="mw-muted mw-center">{translate("warehouse.77.erp.data.is.saved.on.the.server")}</p>
  </div>;
}

export function WarehousePicker({ data, switchWarehouse, onClose, Modal }) {
  useLocale();
  const [query, setQuery] = useState('');
  return <Modal title={translate("warehouse.switch.warehouse")} onClose={onClose}><div className="form-body mw-stack"><SearchField label={translate("warehouse.search.warehouse")} value={query} onChange={setQuery} />{data.warehouses.filter(w => w.name.toLowerCase().includes(query.toLowerCase())).map(w => <Button key={w.id} primary={w.id === data.warehouse_id} onClick={async () => { onClose(); await switchWarehouse(w.id); }}>{w.name}{w.id === data.warehouse_id ? translate("warehouse.current.warehouse") : ''}</Button>)}</div></Modal>;
}

export function DraftList({ data, userId, onOpen, onClose, Modal }) {
  useLocale();
  const [drafts, setDrafts] = useState(null);
  const [error, setError] = useState('');
  const { can } = usePermissions();
  const scope = draftScope(userId, data.instance_id, data.warehouse_id);
  const load = async () => { try { setDrafts(await listDrafts(scope)); } catch (e) { setError(localizeError(e.message)); } };
  useEffect(() => { load(); }, [userId, data.warehouse_id, data.instance_id]);
  return <Modal title={translate("warehouse.local.draft")} subtitle={data.settings.warehouse_name} onClose={onClose}><div className="form-body mw-stack"><p className="mw-muted">{translate("warehouse.drafts.are.only.saved.in.the.current.browser.and.ordinary.drafts")}</p><Notice>{error}</Notice>
    {!drafts && !error && <p><LoadingStatus>{translate("warehouse.reading.draft")}</LoadingStatus></p>}{drafts?.length === 0 && <Empty title={translate("warehouse.no.draft.yet")}>{translate("warehouse.automatically.save.when.editing.inbound.and.outbound.documents")}</Empty>}
    {drafts?.map(draft => <section key={draft.id} className="mw-card mw-stack"><h2>{draft.type === 'in' ? translate("warehouse.stock.in") : translate("warehouse.stock.out")}{draft.pending ? translate("warehouse.results.to.be.confirmed") : ''}</h2><p>{draft.partner || translate("warehouse.correspondence.unit.not.filled.in")}</p><p className="mw-muted">{draft.items.length}{" "}{translate("warehouse.material.2")}{" "}{dateTime(draft.updatedAt)}</p><Button primary disabled={!can(draft.type === 'in' ? 'purchase' : 'sale')} onClick={() => onOpen(draft)}>{translate("warehouse.continue")}{draft.pending ? translate("warehouse.check") : translate("warehouse.edit")}</Button>{!draft.pending && <Button danger onClick={async () => { if (!window.confirm(translate("warehouse.delete.this.local.draft"))) return; try { await removeDraft(scope, draft.id); await load(); } catch (e) { setError(localizeError(e.message)); } }}>{translate("warehouse.delete.draft")}</Button>}</section>)}
  </div></Modal>;
}

export function MobileProductDetail({ product, data, Modal, openOrder, openModal, openOrderDetail, onClose, onSaved, onViewBom }) {
  useLocale();
  const { can, manage, costs } = usePermissions();
  const { online } = usePwa();
  const [others, setOthers] = useState(null);
  const [error, setError] = useState('');
  const [otherError, setOtherError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let alive = true;
    api(`/products/${product.id}/other-warehouses`).then(result => { if (alive) setOthers(result.warehouses); }).catch(e => { if (alive) setOtherError(e.message); });
    return () => { alive = false; };
  }, [product.id]);
  const expression = data?.settings?.stock_expression || null;
  const nameById = Object.fromEntries((data?.warehouses || []).map(w => [w.id, w.name]));
  const stockByWarehouse = { ...(data?.warehouse_id != null ? { [data.warehouse_id]: Number(product.stock) || 0 } : {}) };
  for (const row of others ?? []) stockByWarehouse[row.warehouse_id] = Number(row.stock) || 0;
  const mobileExpressionValue = expression && others !== null ? evaluateStockExpression(expression, stockByWarehouse) : null;
  const mobileExpressionText = expression ? describeStockExpression(expression, nameById) : '';
  const lifecycle = async (remove) => {
    if (lock.current) return;
    const active = product.active === 0 ? 1 : 0;
    if (!window.confirm(remove ? translate("warehouse.are.you.sure.you.want.to.delete.only.materials.with.zero", { v0: product.name }) : translate("warehouse.are.you.sure.only.affects.the.current.warehouse", { v0: active ? translate("warehouse.activate") : translate("warehouse.deactivate"), v1: product.name, v2: active ? translate("warehouse.after.activation.the.normal.ordering.selection.will.be.restored") : translate("warehouse.after.deactivation.the.general.ordering.selection.will.be.hidden.by.default") }))) return;
    lock.current = true; setBusy(true); setError('');
    try { await api(`/products/${product.id}${remove ? '' : '/status'}`, { method: remove ? 'DELETE' : 'POST', body: remove ? {} : { active } }); await onSaved(remove ? translate("warehouse.material.deleted") : active ? translate("warehouse.material.is.enabled") : translate("warehouse.material.has.been.deactivated")); }
    catch (e) { setError(localizeError(e.message)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <Modal title={translate("warehouse.material.details.2")} onClose={busy ? () => {} : onClose}><div className="form-body mw-stack">
    <Notice>{error}</Notice><section className="mw-card mw-stack"><h2>{product.name}</h2><p className="mw-muted">{product.barcode}</p>{product.image && <ProductImage src={product.image} alt={product.name} className="mw-detail-image" />}<StockBadge product={product} />
      { [[translate("warehouse.use.status"), product.active === 0 ? translate("warehouse.deactivated") : translate("warehouse.enabled")], [translate("warehouse.round.quantities.to.whole.units"), product.unit_round_up ? translate("warehouse.yes") : translate("warehouse.no")], [translate("warehouse.fixed.asset"), product.is_fixed_asset ? translate("warehouse.yes") : translate("warehouse.no")], [translate("warehouse.production.type"), translateText(product.production_type) || translate("warehouse.not.set")], [translate("warehouse.current.inventory"), `${count(product.stock)} ${product.unit}`], [translate("warehouse.safety.stock"), `${count(product.threshold)} ${product.unit}`], [translate("warehouse.classification"), product.category], [translate("warehouse.specifications.and.models"), product.specification || translate("warehouse.not.filled.in")], [translate("warehouse.remarks"), product.note || translate("warehouse.not.filled.in")]].map(([label, value]) => <DetailRow key={label} label={label}>{value}</DetailRow>)}</section>
    {product.customer_part_numbers?.length > 0 && <div className="mw-card"><CustomerPartNumbersDetail value={product.customer_part_numbers} /></div>}
    <section className="mw-card mw-stack"><DetailRow label={translate("warehouse.next.verification.date")}>{product.inspection_date || translate("warehouse.not.configured")}</DetailRow><DetailRow label={translate("warehouse.inspection.cycle")}>{inspectionCycleLabel(product)}</DetailRow><DetailRow label={translate("warehouse.last.check")}>{product.last_inspected_on || translate("warehouse.no.records")}</DetailRow></section>
    <section className="mw-card mw-stack"><DetailRow label={translate("warehouse.reference.purchase.price")}>{costs ? price(product.cost) : '—'}</DetailRow><DetailRow label={translate("warehouse.reference.sales.price")}>{price(product.price)}</DetailRow></section>
    <ProductHistory key={product.id} product={product} onViewOrder={id => openOrderDetail?.(id)} />
    <section className="mw-card mw-stack"><h2>{translate("warehouse.other.warehouse.inventory")}</h2><Notice>{otherError}</Notice>{others === null && !otherError ? <p className="mw-muted"><LoadingStatus>{translate("warehouse.reading")}</LoadingStatus></p> : others?.length ? others.map(w => <DetailRow key={w.warehouse_id} label={w.warehouse_name}>{count(w.stock)} {w.unit}</DetailRow>) : !otherError && <p className="mw-muted">{translate("warehouse.the.same.material.is.not.currently.available.in.other.warehouses")}</p>}
      {mobileExpressionValue !== null && <DetailRow label={mobileExpressionText}><strong className={`stock-diff-${mobileExpressionValue > 0 ? 'positive' : mobileExpressionValue < 0 ? 'negative' : 'zero'}`}>{`${mobileExpressionValue > 0 ? '+' : ''}${count(mobileExpressionValue)} ${product.unit}`}</strong></DetailRow>}</section>
    <Button onClick={() => openModal({ kind: 'barcode', product })}>{translate("warehouse.material.barcode")}</Button>
    {can('bom') && onViewBom && <Button onClick={onViewBom}>{translate("warehouse.view.bom")}</Button>}
    {can('products') && <Button disabled={busy} onClick={() => openModal({ kind: 'product', product })}>{translate("warehouse.edit.material")}</Button>}
    {manage('business') && <Button disabled={busy} onClick={() => openModal({ kind: 'stockQr', product })}>{translate("warehouse.inbound.and.outbound.qr.code")}</Button>}
    {can('stocktake') && <Button disabled={busy || !online} onClick={() => openModal({ kind: 'increase', product })}>{translate("warehouse.increase.stock.return")}</Button>}
    {can('stocktake') && <Button disabled={busy || !online || product.stock <= 0} onClick={() => openModal({ kind: 'reduce', product })}>{translate("warehouse.reduce.stock.loss")}</Button>}
    {manage('products') && <><Button busy={busy} disabled={!online} onClick={() => lifecycle(false)}>{product.active === 0 ? translate("warehouse.enable.material") : translate("warehouse.deactivate.material")}</Button><Button danger disabled={busy || !online} onClick={() => lifecycle(true)}>{translate("warehouse.delete.material")}</Button></>}
  </div><div className="modal-footer mw-columns"><Button permission="purchase" disabled={busy} onClick={() => openOrder('in', product)}>{translate("warehouse.stock.in")}</Button><Button primary permission="sale" disabled={busy || product.stock <= 0} onClick={() => openOrder('out', product)}>{translate("warehouse.stock.out")}</Button></div></Modal>;
}
