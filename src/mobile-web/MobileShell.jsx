import { useQuery, usePagedQuery, queryPath } from '../queries.js';
import { LoadingIndicator, LoadingStatus } from '../Loading.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Box, FilePenLine, History, LayoutDashboard, LogOut, Megaphone, Plus, RefreshCw, ScanLine, Settings, ShieldCheck, Warehouse } from 'lucide-react';
import { usePermissions } from '../permissions.jsx';
import { flattenCategories } from '../catalog.js';
import { api } from '../api.js';
import { orderLabel } from '../order-utils.js';
import { OfflineNotice, PwaActions, usePwa } from '../pwa/Pwa.jsx';
import { draftScope, listDrafts, removeDraft } from '../pwa/drafts.js';
import { download } from '../data-files.js';
import { ProductImage } from '../ProductImage.jsx';
import { ProductHistory } from '../ProductHistory.jsx';
import { evaluateStockExpression, describeStockExpression } from '../../shared/stock-compare.js';
import { MobileButton as Button, MobileIcon, Notice, Chips, SearchField, ProductRow, Empty, money, count, dateTime, DetailRow, StockBadge } from './ui.jsx';
import './mobile.css';

const tabs = [['overview', '工作台', LayoutDashboard], ['products', '物料', Box], ['inventory', '库存', Warehouse], ['history', '单据', History], ['more', '更多', Settings]];

export function MobileShell({ user, data, page, navigate, openModal, openOrder, showProduct, showOrder, switchWarehouse, loading, switching, loadError, reload, refreshing, loggingOut, logout, renderScanner, renderAnnouncements, announcementCount }) {
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
    <header className="mw-header" inert={switching}>
      {page === 'scanner' ? <><MobileIcon icon={ArrowLeft} label="返回工作台" onClick={() => navigate('overview')} /><strong className="mw-modal-title">扫码工作台</strong></> : <>
        <strong className="mw-wordmark">77 <span>ERP</span></strong>
        <button type="button" className="mw-warehouse" disabled={!ready || loading || switching} aria-label="切换仓库" onClick={() => openModal({ kind: 'warehousePicker' })}>{data.settings.warehouse_name} ▾</button>
        <button type="button" className="mw-icon announcement-entry" aria-label="公告中心" onClick={() => navigate('announcements')} disabled={!ready}><Megaphone size={22} />{announcementCount > 0 && <span className="announcement-entry-count" aria-label={`${announcementCount} 条未读公告`}>{announcementCount > 99 ? '99+' : announcementCount}</span>}</button>
        <MobileIcon icon={ScanLine} label="打开扫码工作台" onClick={() => navigate('scanner')} disabled={!ready} />
      </>}
    </header>
    <OfflineNotice />
    <main className="mw-content" inert={switching}>
      {loading && !ready ? <div className="mw-empty" role="status"><LoadingIndicator size={64} /><p>正在读取库存…</p></div> : <>
        {loadError && <div className="mw-stack"><Notice>{loadError}{ready ? ' 当前显示上次读取的数据。' : ''}</Notice><Button icon={RefreshCw} busy={refreshing} onClick={reload}>重新同步</Button></div>}
        {!ready && !loadError && <Empty title="等待连接工作空间" />}
        {ready && <>
          {page === 'overview' && <Dashboard data={data} openOrder={openOrder} onScan={() => navigate('scanner')} showProduct={showProduct} showOrder={showOrder} history={() => navigate('history')} />}
          {['products', 'inventory'].includes(page) && <Products key={`${data.warehouse_id}:${page}`} data={data} inventory={page === 'inventory'} showProduct={showProduct} openModal={openModal} />}
          {['history', 'purchases', 'sales'].includes(page) && <Orders key={`${data.warehouse_id}:${page}`} data={data} initial={page === 'purchases' ? 'in' : page === 'sales' ? 'out' : 'all'} openOrder={openOrder} showOrder={showOrder} />}
          {page === 'more' && <More user={user} data={data} openModal={openModal} loggingOut={loggingOut} logout={logout} />}
          {page === 'scanner' && renderScanner()}
          {page === 'announcements' && renderAnnouncements()}
          <div className="mw-refresh"><span className="mw-muted">{updated ? `读取于 ${updated.toLocaleTimeString('zh-CN', { hour12: false })}` : '数据保存在服务器'}</span><button type="button" onClick={reload} disabled={refreshing || !online} aria-busy={refreshing}>{refreshing ? <LoadingIndicator size={20} /> : <RefreshCw size={15} />}刷新数据</button></div>
        </>}
      </>}
    </main>
    {page !== 'scanner' && <nav className="mw-tabs" aria-label="移动端主导航" inert={switching}>
      {tabs.map(([id, label, Icon]) => <button type="button" key={id} aria-current={page === id || id === 'history' && ['purchases', 'sales'].includes(page) ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={23} /><span>{label}</span></button>)}
    </nav>}
  </div>;
}

function Dashboard({ data, openOrder, onScan, showProduct, showOrder, history }) {
  const { costs } = usePermissions();
  const { result: summary, error } = useQuery('/dashboard', data);
  const low = summary?.products.low_stock_products || [];
  const recent = summary?.recent_orders || [];
  const stats = [
    ['物料种类', summary ? count(summary.products.total) : '—', Box],
    ['库存成本', summary && costs ? money((summary.products.inventory_value_cents ?? 0) / 100) : '—', Warehouse],
    ['今日采购', summary ? money((summary.today.purchase_cents || 0) / 100) : '—', ArrowDownToLine],
    ['今日销售', summary ? money((summary.today.sales_cents || 0) / 100) : '—', ArrowUpFromLine],
  ];
  return <div className="mw-stack">
    <div><h1>工作台</h1><p className="mw-muted">{data.settings.business_name} · {data.settings.warehouse_name}</p></div>
    <Notice>{error}</Notice>
    <div className="mw-stats">{stats.map(([label, value, Icon]) => <section className="mw-stat" key={label}><div><span className="mw-muted">{label}</span><Icon size={18} /></div><strong>{value}</strong></section>)}</div>
    <section className="mw-card mw-stack"><h2>快速操作</h2><Button primary icon={ScanLine} onClick={onScan}>扫描物料条码</Button><div className="mw-columns"><Button permission="purchase" icon={ArrowDownToLine} onClick={() => openOrder('in')}>采购入库</Button><Button permission="sale" icon={ArrowUpFromLine} onClick={() => openOrder('out')}>销售出库</Button></div></section>
    <section className="mw-card mw-stack"><div className="mw-between"><h2>库存预警</h2><span className="mw-warning">{summary ? `${summary.products.low_stock + summary.products.out_of_stock} 件物料` : '—'}</span></div>{low.length ? low.map(p => <ProductRow key={p.id} product={p} onOpen={showProduct} />) : <p className="mw-muted">所有物料库存充足。</p>}</section>
    <section className="mw-card mw-stack"><h2>最近单据</h2>{recent.map(o => <OrderSummary key={o.id} order={o} onOpen={showOrder} />)}{summary && !recent.length && <p className="mw-muted">暂无单据，创建第一张入库单开始记录库存。</p>}<Button onClick={history}>查看全部单据</Button></section>
  </div>;
}

function Products({ data, inventory, showProduct, openModal }) {
  const { can, manage } = usePermissions();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [filter, setFilter] = useState(inventory ? 'all' : 'active');
  const categories = flattenCategories(data.categories || []);
  useEffect(() => { if (category !== 'all' && !categories.some(c => String(c.id) === category)) setCategory('all'); }, [data.categories, category]);
  const { result, error, loading, loadMore, retry } = usePagedQuery(queryPath('/products', {
    q: query, category_id: category, status: inventory ? 'active' : filter, stock: inventory ? filter : 'all',
  }), data, 'products', query ? 250 : 0);
  const products = result?.products || [];
  return <div className="mw-stack">
    <div className="mw-between"><div><h1>{inventory ? '库存管理' : '物料管理'}</h1><p className="mw-muted">共 {result ? result.total : '—'} 种物料 · 已加载 {products.length} 种</p></div>{!inventory && can('products') && <MobileIcon icon={Plus} label="新增物料" onClick={() => openModal({ kind: 'product' })} />}</div>
    {!inventory && manage('products') && <Button onClick={() => openModal({ kind: 'categories' })}>管理分类</Button>}
    <SearchField value={query} onChange={setQuery} />
    <Chips label={inventory ? '库存筛选' : '使用状态'} value={filter} onChange={setFilter} options={inventory ? [['all', '全部库存'], ['low', '库存预警'], ['empty', '缺货']] : [['all', '全部状态'], ['active', '已启用'], ['inactive', '已停用']]} />
    <label className="mw-field"><span>物料分类</span><select value={category} onChange={e => setCategory(e.target.value)}><option value="all">全部分类</option>{categories.map(c => <option key={c.id} value={c.id}>{c.path}</option>)}</select></label>
    <Notice>{error}</Notice>{error && <Button onClick={retry}>重新加载</Button>}
    {loading && !products.length && <p className="mw-muted"><LoadingStatus>正在读取物料…</LoadingStatus></p>}
    <div className="mw-product-list" aria-busy={loading}>{products.map(p => <ProductRow key={p.id} product={p} onOpen={showProduct} />)}</div>
    {!loading && !products.length && !error && <Empty title="未找到物料">尝试调整筛选条件，或新增物料档案。</Empty>}
    {result?.has_more && <Button busy={loading} onClick={loadMore}>加载更多物料</Button>}
  </div>;
}

function OrderSummary({ order, onOpen }) {
  return <button type="button" className="mw-order-summary" onClick={() => onOpen(order)}>
    <strong>{orderLabel(order)} · {order.partner}</strong><span className="mw-muted">{order.number}</span><span className="mw-muted">{dateTime(order.created_at)}</span><strong className={order.type === 'in' ? 'mw-blue' : 'mw-green'}>{order.kind === 'transfer' ? '不涉及金额' : money(order.total)}</strong>
  </button>;
}

function Orders({ data, initial, openOrder, showOrder }) {
  const { can } = usePermissions();
  const { online } = usePwa();
  const [query, setQuery] = useState('');
  const [type, setType] = useState(initial);
  const [period, setPeriod] = useState('all');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const { result, error, loading, loadMore, retry } = usePagedQuery(queryPath('/orders', {
    q: query, kind: type === 'transfer' ? 'transfer' : null, business: ['in', 'out'].includes(type) ? type : null,
    from: period === 'all' ? null : new Date(Date.now() - Number(period) * 86400000).toISOString().slice(0, 10),
  }), data, 'orders', query ? 250 : 0);
  const orders = result?.orders || [];
  const exportOrders = async () => {
    if (exporting) return;
    setExporting(true); setExportError('');
    try {
      const rows = await api('/orders/export');
      const cell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
      const csv = '\uFEFF' + [['单据号', '类型', '往来单位', '时间', '金额'], ...rows.map(o => [o.number, orderLabel(o), o.partner, o.created_at, Number(o.total).toFixed(2)])].map(row => row.map(cell).join(',')).join('\r\n');
      await download(csv, '77erp-orders.csv', 'text/csv;charset=utf-8');
    } catch (e) { setExportError(e.message); }
    finally { setExporting(false); }
  };
  return <div className="mw-stack">
    <h1>操作记录</h1><div className="mw-columns"><Button permission="purchase" icon={ArrowDownToLine} onClick={() => openOrder('in')}>新建入库</Button><Button permission="sale" primary icon={ArrowUpFromLine} onClick={() => openOrder('out')}>新建出库</Button></div>
    <SearchField value={query} onChange={setQuery} label="搜索单据号、往来单位或物料" />
    <Chips label="单据类型" value={type} onChange={setType} options={ [['all', '全部单据'], ['in', '采购入库'], ['out', '销售出库'], ['transfer', '仓库调拨']] } />
    <Chips label="单据时间" value={period} onChange={setPeriod} options={ [['all', '全部时间'], ['7', '近 7 天'], ['30', '近 30 天']] } />
    <p className="mw-muted">共 {result ? result.total : '—'} 张单据 · 已加载 {orders.length} 张</p>
    <Notice>{error || exportError}</Notice>{error && <Button onClick={retry}>重新加载</Button>}{loading && <LoadingStatus>正在读取单据…</LoadingStatus>}
    {orders.map(o => <section key={o.id} className="mw-card"><OrderSummary order={o} onOpen={showOrder} /></section>)}
    {!loading && !orders.length && !error && <Empty title="暂无单据">调整筛选条件，或创建第一张单据。</Empty>}
    {result?.has_more && <Button busy={loading} onClick={loadMore}>加载更多单据</Button>}
    {can('data_io') && <Button busy={exporting} disabled={!online} onClick={exportOrders}>导出单据</Button>}
  </div>;
}

function More({ user, data, openModal, loggingOut, logout }) {
  const { manage } = usePermissions();
  return <div className="mw-stack"><h1>工作空间</h1>
    <section className="mw-card"><div className="mw-account"><ShieldCheck size={30} /><div><h2>{user.name || user.username}</h2><p className="mw-muted">账号：{user.username}</p><p className="mw-muted">{user.role === 'admin' ? '管理员账号' : '员工账号'}</p></div></div></section>
    {(user.role === 'admin' || user.permissions?.includes('ai')) && <section className="mw-card"><Button icon={Settings} onClick={() => openModal({ kind: 'ai' })}>AI 助手</Button></section>}
    <section className="mw-card mw-stack"><h2>{data.settings.business_name}</h2><p className="mw-muted">{data.settings.warehouse_name}</p>{user.role === 'admin' && <Button icon={Settings} onClick={() => openModal({ kind: 'settings' })}>商户与仓库设置</Button>}</section>
    <Button onClick={() => openModal({ kind: 'account' })}>修改密码</Button><Button onClick={() => openModal({ kind: 'businessTools' })}>业务管理</Button>
    {manage('business') && <Button onClick={() => openModal({ kind: 'stockQr' })}>出入库二维码</Button>}
    <Button icon={FilePenLine} onClick={() => openModal({ kind: 'drafts' })}>本地草稿</Button>
    <section className="mw-card"><p className="mw-field-label">服务器地址</p><p className="mw-muted mw-break">{location.origin}</p></section>
    <Button danger icon={LogOut} busy={loggingOut} onClick={() => { if (window.confirm('退出登录？本账号的本地草稿将清除，下次打开需要重新登录。')) logout(); }}>退出登录</Button>
    <PwaActions /><p className="mw-muted mw-center">77 ERP · 数据保存在服务器</p>
  </div>;
}

export function WarehousePicker({ data, switchWarehouse, onClose, Modal }) {
  const [query, setQuery] = useState('');
  return <Modal title="切换仓库" onClose={onClose}><div className="form-body mw-stack"><SearchField label="搜索仓库" value={query} onChange={setQuery} />{data.warehouses.filter(w => w.name.toLowerCase().includes(query.toLowerCase())).map(w => <Button key={w.id} primary={w.id === data.warehouse_id} onClick={async () => { onClose(); await switchWarehouse(w.id); }}>{w.name}{w.id === data.warehouse_id ? ' · 当前仓库' : ''}</Button>)}</div></Modal>;
}

export function DraftList({ data, userId, onOpen, onClose, Modal }) {
  const [drafts, setDrafts] = useState(null);
  const [error, setError] = useState('');
  const { can } = usePermissions();
  const scope = draftScope(userId, data.instance_id, data.warehouse_id);
  const load = async () => { try { setDrafts(await listDrafts(scope)); } catch (e) { setError(e.message); } };
  useEffect(() => { load(); }, [userId, data.warehouse_id, data.instance_id]);
  return <Modal title="本地草稿" subtitle={data.settings.warehouse_name} onClose={onClose}><div className="form-body mw-stack"><p className="mw-muted">草稿仅保存在当前浏览器，普通草稿保留 7 天；提交结果待确认的草稿保留到核对完成。</p><Notice>{error}</Notice>
    {!drafts && !error && <p><LoadingStatus>正在读取草稿…</LoadingStatus></p>}{drafts?.length === 0 && <Empty title="暂无草稿">编辑入出库单据时自动保存。</Empty>}
    {drafts?.map(draft => <section key={draft.id} className="mw-card mw-stack"><h2>{draft.type === 'in' ? '采购入库' : '销售出库'}{draft.pending ? ' · 结果待确认' : ''}</h2><p>{draft.partner || '未填写往来单位'}</p><p className="mw-muted">{draft.items.length} 种物料 · {dateTime(draft.updatedAt)}</p><Button primary disabled={!can(draft.type === 'in' ? 'purchase' : 'sale')} onClick={() => onOpen(draft)}>继续{draft.pending ? '核对' : '编辑'}</Button>{!draft.pending && <Button danger onClick={async () => { if (!window.confirm('删除这份本地草稿？')) return; try { await removeDraft(scope, draft.id); await load(); } catch (e) { setError(e.message); } }}>删除草稿</Button>}</section>)}
  </div></Modal>;
}

export function MobileProductDetail({ product, data, Modal, openOrder, openModal, openOrderDetail, onClose, onSaved }) {
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
    if (!window.confirm(remove ? `确定删除「${product.name}」？仅允许删除库存为零且没有业务关联的物料，删除无法恢复。` : `确定${active ? '启用' : '停用'}「${product.name}」？${active ? '启用后恢复普通开单选品。' : '停用后普通开单选品默认隐藏，库存和历史记录保留，可从库存页面开单清库存。'}仅影响当前仓库。`)) return;
    lock.current = true; setBusy(true); setError('');
    try { await api(`/products/${product.id}${remove ? '' : '/status'}`, { method: remove ? 'DELETE' : 'POST', body: remove ? {} : { active } }); await onSaved(remove ? '物料已删除' : active ? '物料已启用' : '物料已停用'); }
    catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(false); }
  };
  return <Modal title="物料详情" onClose={busy ? () => {} : onClose}><div className="form-body mw-stack">
    <Notice>{error}</Notice><section className="mw-card mw-stack"><h2>{product.name}</h2><p className="mw-muted">{product.barcode}</p>{product.image && <ProductImage src={product.image} alt={product.name} className="mw-detail-image" />}<StockBadge product={product} />
      { [['使用状态', product.active === 0 ? '已停用' : '已启用'], ['当前库存', `${count(product.stock)} ${product.unit}`], ['安全库存', `${count(product.threshold)} ${product.unit}`], ['分类', product.category], ['规格型号', product.specification || '未填写'], ['备注', product.note || '未填写']].map(([label, value]) => <DetailRow key={label} label={label}>{value}</DetailRow>)}</section>
    <section className="mw-card mw-stack"><DetailRow label="参考采购价">{costs ? money(product.cost) : '—'}</DetailRow><DetailRow label="参考销售价">{money(product.price)}</DetailRow></section>
    <ProductHistory key={product.id} product={product} onViewOrder={id => openOrderDetail?.(id)} />
    <section className="mw-card mw-stack"><h2>其他仓库库存</h2><Notice>{otherError}</Notice>{others === null && !otherError ? <p className="mw-muted"><LoadingStatus>读取中…</LoadingStatus></p> : others?.length ? others.map(w => <DetailRow key={w.warehouse_id} label={w.warehouse_name}>{count(w.stock)} {w.unit}</DetailRow>) : !otherError && <p className="mw-muted">其他仓库暂无同一物料</p>}
      {mobileExpressionValue !== null && <DetailRow label={mobileExpressionText}><strong className={`stock-diff-${mobileExpressionValue > 0 ? 'positive' : mobileExpressionValue < 0 ? 'negative' : 'zero'}`}>{`${mobileExpressionValue > 0 ? '+' : ''}${count(mobileExpressionValue)} ${product.unit}`}</strong></DetailRow>}</section>
    <Button onClick={() => openModal({ kind: 'barcode', product })}>物料条码</Button>
    {can('products') && <Button disabled={busy} onClick={() => openModal({ kind: 'product', product })}>编辑物料</Button>}
    {manage('business') && <Button disabled={busy} onClick={() => openModal({ kind: 'stockQr', product })}>出入库二维码</Button>}
    {can('stocktake') && <Button disabled={busy || !online} onClick={() => openModal({ kind: 'increase', product })}>增加库存（退料）</Button>}
    {can('stocktake') && <Button disabled={busy || !online || product.stock <= 0} onClick={() => openModal({ kind: 'reduce', product })}>减少库存（报损）</Button>}
    {manage('products') && <><Button busy={busy} disabled={!online} onClick={() => lifecycle(false)}>{product.active === 0 ? '启用物料' : '停用物料'}</Button><Button danger disabled={busy || !online} onClick={() => lifecycle(true)}>删除物料</Button></>}
  </div><div className="modal-footer mw-columns"><Button permission="purchase" disabled={busy} onClick={() => openOrder('in', product)}>采购入库</Button><Button primary permission="sale" disabled={busy || product.stock <= 0} onClick={() => openOrder('out', product)}>销售出库</Button></div></Modal>;
}
