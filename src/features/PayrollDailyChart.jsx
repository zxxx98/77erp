import { useState } from 'react';
import { Select } from '../Dropdown.jsx';
import { t, getFormatLocale } from '../i18n/index.js';

const dayNumber = date => Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000);
const dayLabel = value => new Date(value * 86400000).toISOString().slice(0, 10);
const money = cents => new Intl.NumberFormat(getFormatLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);

export function PayrollDailyChart({ daily, currencies, startDate, endDate }) {
  const [choice, setChoice] = useState(''), [selected, setSelected] = useState(null);
  const currency = currencies.some(row => row.currency === choice) ? choice : currencies[0]?.currency;
  const rows = daily.filter(row => row.currency === currency);
  const first = dayNumber(startDate), last = dayNumber(endDate), count = last - first + 1;
  const width = Math.min(2400, Math.max(640, count * 24)), height = 270;
  const left = 86, right = width - 24, top = 20, bottom = 220, plotWidth = right - left;
  const maximum = rows.reduce((max, row) => Math.max(max, row.amount_cents), 100);
  const step = 10 ** Math.floor(Math.log10(maximum / 4));
  const ceiling = Math.ceil(maximum / (4 * step)) * 4 * step;
  const x = day => left + (day - first + 0.5) / count * plotWidth;
  const y = cents => bottom - cents / ceiling * (bottom - top);
  const barWidth = Math.max(1, Math.min(28, plotWidth / count * 0.65));
  const ticks = [...new Set(Array.from({ length: Math.min(7, count) }, (_, i) => first + Math.round(i * (count - 1) / Math.max(1, Math.min(7, count) - 1))))];
  const active = rows.find(row => row.date === selected) || rows.at(-1);
  const description = row => `${row.date} · ${currency} ${money(row.amount_cents)} · ${t('payroll.chartReports', { count: row.report_count })}`;
  return <section className="panel payroll-section payroll-daily">
    <div className="payroll-chart-heading"><h2>{t('payroll.daily')}</h2>
      {currencies.length > 1 ? <Select aria-label={t('payroll.chartCurrency')} value={currency} onChange={value => { setChoice(value); setSelected(null); }}>{currencies.map(row => <option key={row.currency} value={row.currency}>{row.currency}</option>)}</Select> : currency && <span>{currency}</span>}
    </div>
    <p className="payroll-hint">{t('payroll.chartHint')}</p>
    {!rows.length ? <p className="payroll-empty">{t('payroll.chartEmpty')}</p> : <>
      <div className="payroll-chart-scroll" role="region" aria-label={t('payroll.daily')} tabIndex={0}>
        <svg viewBox={`0 0 ${width} ${height}`} style={{ minWidth: width }} role="group" aria-label={`${t('payroll.daily')} · ${currency}`}>
          {Array.from({ length: 5 }, (_, i) => ceiling * i / 4).map(value => <g key={value} aria-hidden="true">
            <line x1={left} x2={right} y1={y(value)} y2={y(value)} className="payroll-chart-grid" />
            <text x={left - 10} y={y(value) + 4} textAnchor="end">{new Intl.NumberFormat(getFormatLocale(), { maximumFractionDigits: 2, notation: value >= 100000000 ? 'compact' : 'standard' }).format(value / 100)}</text>
          </g>)}
          {ticks.map(day => <text key={day} x={x(day)} y={bottom + 28} textAnchor="middle" aria-hidden="true">{startDate.slice(0, 4) === endDate.slice(0, 4) ? dayLabel(day).slice(5) : dayLabel(day)}</text>)}
          {rows.map(row => <rect key={row.date} x={x(dayNumber(row.date)) - barWidth / 2} y={Math.min(bottom - 2, y(row.amount_cents))} width={barWidth} height={Math.max(2, bottom - y(row.amount_cents))} rx={3}
            className={`payroll-chart-bar${active?.date === row.date ? ' is-selected' : ''}`} role="button" tabIndex={0} aria-label={description(row)} aria-pressed={active?.date === row.date}
            onMouseEnter={() => setSelected(row.date)} onFocus={() => setSelected(row.date)} onClick={() => setSelected(row.date)} onKeyDown={event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); setSelected(row.date); } }}><title>{description(row)}</title></rect>)}
        </svg>
      </div>
      <p className="payroll-chart-selection" role="status">{active && description(active)}</p>
    </>}
  </section>;
}
