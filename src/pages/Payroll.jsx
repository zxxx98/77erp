import { useState } from 'react';
import { Button, PageHeading, QueryStatus, Badge } from '../components/common.jsx';
import { Input } from '../ui/controls.jsx';
import { Dropdown } from '../Dropdown.jsx';
import { useQuery, queryPath } from '../queries.js';
import { t, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import './payroll.css';

const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
function monthRange(previous = false) {
  const now = new Date(), start = new Date(now.getFullYear(), now.getMonth() - Number(previous), 1);
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

export function Payroll({ data }) {
  useLocale();
  const [worker, setWorker] = useState(''), [dates, setDates] = useState(() => monthRange()), [offset, setOffset] = useState(0);
  const members = useQuery('/payroll/members', data);
  const start = boundary(dates[0]), end = boundary(dates[1], true), valid = start && end && start < end;
  const query = useQuery(worker && valid ? queryPath('/payroll', { worker_id: worker, start_at: start, end_at: end, offset }) : null, data);
  const result = query.result;
  const chooseDates = values => { setDates(values); setOffset(0); };
  return <div className="payroll-page">
    <PageHeading title={t('payroll.title')} description={t('payroll.description')} />
    <section className="panel payroll-filters">
      <Dropdown label={t('payroll.member')} searchable value={worker} placeholder={t('payroll.chooseMember')} loading={members.loading}
        options={(members.result?.members || []).map(row => ({ value: String(row.id), label: `${row.name || row.username} (${row.employee_no || row.username || `#${row.id}`})${row.active ? '' : ` · ${t('payroll.inactive')}`}` }))}
        onSelect={option => { setWorker(option.value); setOffset(0); }} />
      <label>{t('payroll.start')}<Input type="date" aria-label={t('payroll.start')} value={dates[0]} onChange={event => chooseDates([event.target.value, dates[1]])} /></label>
      <label>{t('payroll.end')}<Input type="date" aria-label={t('payroll.end')} value={dates[1]} onChange={event => chooseDates([dates[0], event.target.value])} /></label>
      <div className="payroll-actions"><Button onClick={() => chooseDates(monthRange())}>{t('payroll.thisMonth')}</Button><Button onClick={() => chooseDates(monthRange(true))}>{t('payroll.lastMonth')}</Button><Button disabled={!worker || !valid || query.loading} onClick={query.retry}>{t('payroll.refresh')}</Button></div>
    </section>
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
      {result.operations.length > 0 && <section className="panel payroll-section"><h2>{t('payroll.byOperation')}</h2><div className="payroll-table"><table><thead><tr>
        <th>{t('payroll.operation')}</th><th>{t('payroll.unitPrice')}</th><th>{t('payroll.quantity')}</th><th>{t('payroll.weighted')}</th><th>{t('payroll.activeCount')}</th><th>{t('payroll.wage')}</th>
      </tr></thead><tbody>{result.operations.map(row => <tr key={row.key}>
        <td><strong>{row.operation_name}</strong><small>{row.route_name}</small></td><td>{row.unit_price == null ? t('payroll.unpriced') : `${row.currency} ${number(row.unit_price)}`}</td>
        <td>{number(row.quantity)} {row.unit}</td><td>{number(row.weighted_quantity)} {row.unit}</td><td>{row.report_count}</td><td>{amount(row.amount_cents, row.currency)}</td>
      </tr>)}</tbody></table></div></section>}
      {result.total > 0 && <section className="panel payroll-section"><h2>{t('payroll.details')}</h2><div className="payroll-reports">{result.reports.map(row => <article className={`payroll-report${row.status === 'void' ? ' is-void' : ''}`} key={row.id}>
        <div className="payroll-report-heading"><strong>{row.operation_name} · {row.product_name}</strong><Badge tone={row.status === 'void' ? 'gray' : 'green'}>{t(row.status === 'void' ? 'payroll.void' : 'payroll.active')}</Badge></div>
        <p>{row.production_number} · {row.route_name}{row.path ? ` · ${t('payroll.path')} ${row.path}` : ''} · #{row.id}</p>
        <div className="payroll-formula"><span>{number(row.quantity)} {row.unit} × {number(row.multiplier)} × {row.unit_price == null ? t('payroll.unpriced') : `${row.currency} ${number(row.unit_price)}`}</span><strong>{amount(row.amount_cents, row.currency)}</strong></div>
        <p>{new Date(row.created_at).toLocaleString(getFormatLocale())} · {t('payroll.worker')}: {row.worker_name} · {t('payroll.registrar')}: {row.registered_by_name}</p>
        {row.note && <p>{row.note}</p>}{row.status === 'void' && <p>{t('payroll.voidReason')}: {row.void_reason}</p>}
      </article>)}</div><div className="payroll-actions payroll-pagination"><Button disabled={!offset || query.loading} onClick={() => setOffset(value => Math.max(0, value - 30))}>{t('route.previous')}</Button><span>{t('route.total', { total: result.total })} · {Math.floor(offset / 30) + 1}</span><Button disabled={!result.has_more || query.loading} onClick={() => setOffset(value => value + 30)}>{t('route.next')}</Button></div></section>}
    </>}
  </div>;
}
