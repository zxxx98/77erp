import { useState } from 'react';
import { Button, PageHeading, QueryStatus, Badge } from '../components/common.jsx';
import { Input } from '../ui/controls.jsx';
import { Dropdown } from '../Dropdown.jsx';
import { useQuery, queryPath } from '../queries.js';
import { t, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { PayrollDailyChart } from '../features/PayrollDailyChart.jsx';
import { PayrollWorkerChart } from '../features/PayrollWorkerChart.jsx';
import { usePermissions } from '../permissions.jsx';
import { canViewProduction } from '../../shared/permissions.js';
import { productionStatusLabels } from '../i18n/production-display.js';
import './payroll.css';

const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
function monthRange() {
  const now = new Date(), start = new Date(now.getFullYear(), now.getMonth(), 1);
  return [localDate(start), localDate(new Date(start.getFullYear(), start.getMonth() + 1, 0))];
}
function boundary(value, nextDay = false) {
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime()) || localDate(date) !== value) return null;
  if (nextDay) date.setDate(date.getDate() + 1);
  return date.toISOString();
}
const number = value => new Intl.NumberFormat(getFormatLocale(), { maximumFractionDigits: 8 }).format(value);
const amount = (cents, currency) => cents == null ? t('payroll.unpriced') : `${currency} ${new Intl.NumberFormat(getFormatLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)}`;
const statusTone = status => status === 'completed' ? 'green' : status === 'void' ? 'gray' : status === 'draft' ? 'blue' : 'orange';

function ReportCards({ reports, total, hasMore, offset, setOffset, loading, user, orderProductName }) {
  return <>
    <div className="payroll-reports">{reports.map(row => <article className={`payroll-report${row.status === 'void' ? ' is-void' : ''}`} key={row.id}>
      <div className="payroll-report-heading"><strong>{row.operation_name}{(!orderProductName || row.product_name !== orderProductName) && ` · ${row.product_name}`}</strong><Badge tone={row.status === 'void' ? 'gray' : 'green'}>{t(row.status === 'void' ? 'payroll.void' : 'payroll.active')}</Badge></div>
      <p>{!orderProductName && <>{canViewProduction(user) ? <a className="payroll-order-link" href={`#production?order=${row.production_id}`} aria-label={t('payroll.openOrder', { number: row.production_number })}>{row.production_number}</a> : <span title={t('payroll.orderPermission')}>{row.production_number}</span>} · </>}{row.route_name}{row.post_processing_operation ? ` · ${t('production.postProcessing')}` : row.additional_operation ? ` · ${t('production.additionalOperations')}` : row.path ? ` · ${t('payroll.path')} ${row.path}` : ''} · #{row.id}</p>
      <div className="payroll-formula"><span>{row.quantity_fraction || number(row.quantity)} {row.unit} × {number(row.multiplier)} × {row.unit_price == null ? t('payroll.unpriced') : `${row.currency} ${number(row.unit_price)}`}</span><strong>{amount(row.amount_cents, row.currency)}</strong></div>
      <p>{new Date(row.created_at).toLocaleString(getFormatLocale())} · {t('payroll.worker')}: {row.worker_name} · {t('payroll.registrar')}: {row.registered_by_name}</p>
      {row.note && <p>{row.note}</p>}{row.status === 'void' && <p>{t('payroll.voidReason')}: {row.void_reason}</p>}
    </article>)}</div>
    <div className="payroll-actions payroll-pagination">
      <Button disabled={!offset || loading} onClick={() => setOffset(value => Math.max(0, value - 30))}>{t('route.previous')}</Button>
      <span>{t('route.total', { total })} · {Math.floor(offset / 30) + 1}</span>
      <Button disabled={!hasMore || loading} onClick={() => setOffset(value => value + 30)}>{t('route.next')}</Button>
    </div>
  </>;
}

export function Payroll({ data }) {
  useLocale();
  const { user } = usePermissions();
  const [view, setView] = useState('member');
  const [worker, setWorker] = useState(''), [dates, setDates] = useState(() => monthRange()), [offset, setOffset] = useState(0);
  const [orderSearch, setOrderSearch] = useState(''), [orderListOffset, setOrderListOffset] = useState(0);
  const [selectedOrderId, setSelectedOrderId] = useState(''), [orderReportOffset, setOrderReportOffset] = useState(0);

  const members = useQuery(view === 'member' ? '/payroll/members' : null, data);
  const start = boundary(dates[0]), end = boundary(dates[1], true), valid = start && end && start < end;
  const query = useQuery(view === 'member' && worker && valid ? queryPath('/payroll', { worker_id: worker, start_at: start, end_at: end, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone, offset }) : null, data);
  const result = query.result;

  const ordersQuery = useQuery(view === 'order' && !selectedOrderId ? queryPath('/payroll/production-orders', { q: orderSearch.trim(), offset: orderListOffset, limit: 20 }) : null, data, orderSearch.trim() ? 200 : 0);
  const orderPayrollQuery = useQuery(view === 'order' && selectedOrderId ? queryPath('/payroll/production-order', { production_id: selectedOrderId, offset: orderReportOffset }) : null, data);
  const orderResult = orderPayrollQuery.result;

  const chooseDates = values => { setDates(values); setOffset(0); };

  return <div className="payroll-page">
    <PageHeading title={t('payroll.title')} description={t('payroll.description')} />
    <section className="panel payroll-filters">
      <div className="payroll-mode-tabs" role="tablist" aria-label={t('payroll.title')}>
        <button type="button" role="tab" aria-selected={view === 'member'} className={`payroll-mode-tab${view === 'member' ? ' is-active' : ''}`} onClick={() => setView('member')}>{t('payroll.byMember')}</button>
        <button type="button" role="tab" aria-selected={view === 'order'} className={`payroll-mode-tab${view === 'order' ? ' is-active' : ''}`} onClick={() => setView('order')}>{t('payroll.byOrder')}</button>
      </div>
      {view === 'member' ? <>
        <Dropdown label={t('payroll.member')} searchable value={worker} placeholder={t('payroll.chooseMember')} loading={members.loading}
          options={(members.result?.members || []).map(row => ({ value: String(row.id), label: `${row.name || row.username} (${row.employee_no || row.username || `#${row.id}`})${row.active ? '' : ` · ${t('payroll.inactive')}`}` }))}
          onSelect={option => { setWorker(option.value); setOffset(0); }} />
        <label>{t('payroll.start')}<Input type="date" aria-label={t('payroll.start')} value={dates[0]} onChange={event => chooseDates([event.target.value, dates[1]])} /></label>
        <label>{t('payroll.end')}<Input type="date" aria-label={t('payroll.end')} value={dates[1]} onChange={event => chooseDates([dates[0], event.target.value])} /></label>
      </> : <label className="payroll-order-search">{t('payroll.searchOrder')}
        <Input type="search" aria-label={t('payroll.searchOrder')} value={orderSearch} placeholder={t('payroll.searchOrderPlaceholder')}
          onChange={event => {
            setOrderSearch(event.target.value);
            setOrderListOffset(0);
            if (selectedOrderId) { setSelectedOrderId(''); setOrderReportOffset(0); }
          }} />
      </label>}
    </section>

    {view === 'member' && <>
      <QueryStatus query={members} />
      {!valid && <p role="alert" className="form-error">{t('payroll.invalidDates')}</p>}
      {!worker && <p className="payroll-empty">{t('payroll.chooseMember')}</p>}
      <QueryStatus query={query} />
      {result && <>
        <section className="payroll-totals" aria-label={t('payroll.totals')}>
          {result.currencies.map(row => <article className="panel payroll-stat" key={row.currency}><span>{t('payroll.totals')} · {row.currency}</span><strong>{amount(row.amount_cents, row.currency)}</strong></article>)}
          <article className="panel payroll-stat"><span>{t('payroll.activeCount')}</span><strong>{result.summary.active_count}</strong></article>
          <article className="panel payroll-stat"><span>{t('payroll.orderCount')}</span><strong>{result.summary.production_count}</strong></article>
          <article className="panel payroll-stat"><span>{t('payroll.voidCount')}</span><strong>{result.summary.void_count}</strong></article>
        </section>
        <p className="payroll-hint">{t('payroll.rule')}</p>
        {result.summary.unpriced_count > 0 && <p className="payroll-warning" role="status">{t('payroll.unpricedWarning', { count: result.summary.unpriced_count })}</p>}
        {!result.total && <p className="payroll-empty">{t('payroll.empty')}</p>}
        <PayrollDailyChart key={`${worker}:${start}:${end}`} daily={result.daily} currencies={result.currencies} startDate={dates[0]} endDate={dates[1]} />
        {result.total > 0 && <section className="panel payroll-section">
          <h2>{t('payroll.details')}</h2>
          <ReportCards reports={result.reports} total={result.total} hasMore={result.has_more} offset={offset} setOffset={setOffset} loading={query.loading} user={user} />
        </section>}
      </>}
    </>}

    {view === 'order' && !selectedOrderId && <>
      <QueryStatus query={ordersQuery} />
      {ordersQuery.result && <section className="panel payroll-section">
        <div className="payroll-section-heading">
          <h2>{t('payroll.orderList')}</h2>
          <span className="payroll-muted">{t('route.total', { total: ordersQuery.result.total })}</span>
        </div>
        {!ordersQuery.result.orders.length ? <p className="payroll-empty">{t('payroll.noOrders')}</p> : <>
          <div className="payroll-orders">
            {ordersQuery.result.orders.map(row => <article className="payroll-order-card" key={row.id}>
              <div className="payroll-report-heading">
                <strong>{row.number} · {row.product_name}</strong>
                <Badge tone={statusTone(row.status)}>{productionStatusLabels[row.status] || row.status}</Badge>
              </div>
              <p>{row.bom_name}{row.specification ? ` · ${row.specification}` : ''} · {t('payroll.plannedQuantity', { quantity: number(row.planned_quantity), unit: row.unit })}{row.completed_quantity != null ? ` · ${t('payroll.completedQuantity', { quantity: row.completed_quantity_fraction || number(row.completed_quantity), unit: row.unit })}` : ''}</p>
              <div className="payroll-order-card-footer">
                <span>{new Date(row.created_at).toLocaleDateString(getFormatLocale())} · {t('payroll.orderCardStats', { workers: row.worker_count, reports: row.active_report_count })}</span>
                <Button onClick={() => { setSelectedOrderId(String(row.id)); setOrderReportOffset(0); }}>{t('payroll.viewOrderPayroll')}</Button>
              </div>
            </article>)}
          </div>
          <div className="payroll-actions payroll-pagination">
            <Button disabled={!orderListOffset || ordersQuery.loading} onClick={() => setOrderListOffset(value => Math.max(0, value - 20))}>{t('route.previous')}</Button>
            <span>{t('route.total', { total: ordersQuery.result.total })} · {Math.floor(orderListOffset / 20) + 1}</span>
            <Button disabled={!ordersQuery.result.has_more || ordersQuery.loading} onClick={() => setOrderListOffset(value => value + 20)}>{t('route.next')}</Button>
          </div>
        </>}
      </section>}
    </>}

    {view === 'order' && selectedOrderId && <>
      <QueryStatus query={orderPayrollQuery} />
      {orderResult && <>
        <section className="panel payroll-order-banner">
          <div className="payroll-order-banner-main">
            <div className="payroll-report-heading">
              <strong>{canViewProduction(user) ? <a className="payroll-order-link" href={`#production?order=${orderResult.order.id}`} aria-label={t('payroll.openOrder', { number: orderResult.order.number })}>{orderResult.order.number}</a> : <span title={t('payroll.orderPermission')}>{orderResult.order.number}</span>} · {orderResult.order.product_name}</strong>
              <Badge tone={statusTone(orderResult.order.status)}>{productionStatusLabels[orderResult.order.status] || orderResult.order.status}</Badge>
            </div>
            <p>{orderResult.order.bom_name}{orderResult.order.specification ? ` · ${orderResult.order.specification}` : ''} · {t('payroll.plannedQuantity', { quantity: number(orderResult.order.planned_quantity), unit: orderResult.order.unit })}{orderResult.order.completed_quantity != null ? ` · ${t('payroll.completedQuantity', { quantity: orderResult.order.completed_quantity_fraction || number(orderResult.order.completed_quantity), unit: orderResult.order.unit })}` : ''}</p>
          </div>
          <Button onClick={() => { setSelectedOrderId(''); setOrderReportOffset(0); }}>{t('payroll.backToOrders')}</Button>
        </section>
        <section className="payroll-totals" aria-label={t('payroll.totals')}>
          {orderResult.currencies.map(row => <article className="panel payroll-stat" key={row.currency}><span>{t('payroll.totals')} · {row.currency}</span><strong>{amount(row.amount_cents, row.currency)}</strong></article>)}
          <article className="panel payroll-stat"><span>{t('payroll.workerCount')}</span><strong>{orderResult.summary.worker_count}</strong></article>
          <article className="panel payroll-stat"><span>{t('payroll.activeCount')}</span><strong>{orderResult.summary.active_count}</strong></article>
          <article className="panel payroll-stat"><span>{t('payroll.voidCount')}</span><strong>{orderResult.summary.void_count}</strong></article>
        </section>
        <p className="payroll-hint">{t('payroll.rule')}</p>
        {orderResult.summary.unpriced_count > 0 && <p className="payroll-warning" role="status">{t('payroll.unpricedWarning', { count: orderResult.summary.unpriced_count })}</p>}
        {!orderResult.workers.length ? <p className="payroll-empty">{t('payroll.orderEmpty')}</p> : <>
          <PayrollWorkerChart key={selectedOrderId} workers={orderResult.workers} />
          <section className="panel payroll-section">
            <h2>{t('payroll.details')}</h2>
            <ReportCards reports={orderResult.reports} total={orderResult.total} hasMore={orderResult.has_more} offset={orderReportOffset} setOffset={setOrderReportOffset} loading={orderPayrollQuery.loading} user={user} orderProductName={orderResult.order.product_name} />
          </section>
        </>}
      </>}
    </>}
  </div>;
}
