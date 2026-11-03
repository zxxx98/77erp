import { useEffect, useId, useRef, useState } from 'react';
import { Select } from '../Dropdown.jsx';
import { t, getFormatLocale } from '../i18n/index.js';

const dayNumber = date => Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000);
const dayLabel = value => new Date(value * 86400000).toISOString().slice(0, 10);
const money = cents => new Intl.NumberFormat(getFormatLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
function barPath(x, y, width, height, radius = 5) {
  const r = Math.min(radius, width / 2, height / 2);
  if (r <= 0 || height <= 2) return `M${x},${y}h${width}v${height}h${-width}Z`;
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

export function PayrollDailyChart({ daily, currencies, startDate, endDate }) {
  const uid = useId();
  const scrollRef = useRef(null);
  const [chartWidth, setChartWidth] = useState(760);
  const [choice, setChoice] = useState(''), [selected, setSelected] = useState(null);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const update = width => { if (width > 0) setChartWidth(Math.max(260, Math.floor(width))); };
    update(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => update(entry?.contentRect?.width || node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const currency = currencies.some(row => row.currency === choice) ? choice : currencies[0]?.currency;
  const rows = daily.filter(row => row.currency === currency);
  const first = dayNumber(startDate), last = dayNumber(endDate), count = last - first + 1;
  const isCompact = chartWidth < 460;
  const scrollable = count > 35;
  const width = scrollable ? Math.min(2400, Math.max(chartWidth, count * (isCompact ? 16 : 22))) : chartWidth;
  const height = isCompact ? 184 : 208;
  const left = isCompact ? 48 : 64, right = width - 16, top = 28, bottom = height - 28, plotWidth = right - left;
  const totalCents = rows.reduce((sum, row) => sum + row.amount_cents, 0);
  const peakCents = rows.reduce((max, row) => Math.max(max, row.amount_cents), 0);
  const avgCents = rows.length ? Math.round(totalCents / rows.length) : 0;
  const maximum = Math.max(peakCents, 100);
  const step = 10 ** Math.floor(Math.log10(maximum / 4));
  const ceiling = Math.ceil(maximum / (4 * step)) * 4 * step;
  const x = day => left + (day - first + 0.5) / count * plotWidth;
  const y = cents => bottom - cents / ceiling * (bottom - top);
  const slotWidth = plotWidth / count;
  const barWidth = Math.max(3, Math.min(18, slotWidth * 0.58));
  const maxTicks = isCompact ? 5 : 7;
  const ticks = [...new Set(Array.from({ length: Math.min(maxTicks, count) }, (_, i) => first + Math.round(i * (count - 1) / Math.max(1, Math.min(maxTicks, count) - 1))))];
  const days = Array.from({ length: count }, (_, i) => first + i);
  const byDate = new Map(rows.map(row => [row.date, row]));
  const active = rows.find(row => row.date === selected) || rows.at(-1);
  const description = row => `${row.date} · ${currency} ${money(row.amount_cents)} · ${t('payroll.chartReports', { count: row.report_count })}`;
  const barGradId = `${uid}-bar`, activeGradId = `${uid}-bar-active`;
  return <section className="panel payroll-section payroll-daily">
    <div className="payroll-chart-heading">
      <div className="payroll-chart-title-group">
        <div className="payroll-chart-title-row">
          <h2>{t('payroll.daily')}</h2>
          {rows.length > 0 && <div className="payroll-chart-kpis">
            <span className="payroll-chart-kpi is-accent">{t('payroll.chartActiveDays', { active: rows.length, total: count })}</span>
            <span className="payroll-chart-kpi">{t('payroll.chartPeak')} <strong>{currency} {money(peakCents)}</strong></span>
            {rows.length > 1 && <span className="payroll-chart-kpi">{t('payroll.chartAverage')} <strong>{currency} {money(avgCents)}</strong></span>}
          </div>}
        </div>
        <p className="payroll-hint">{t('payroll.chartHint')}</p>
      </div>
      {currencies.length > 1 ? <Select aria-label={t('payroll.chartCurrency')} value={currency} onChange={value => { setChoice(value); setSelected(null); }}>{currencies.map(row => <option key={row.currency} value={row.currency}>{row.currency}</option>)}</Select> : currency && <span className="payroll-chart-currency-badge">{currency}</span>}
    </div>
    {!rows.length ? <p className="payroll-empty">{t('payroll.chartEmpty')}</p> : <>
      <div className="payroll-chart-scroll" ref={scrollRef} role="region" aria-label={t('payroll.daily')} tabIndex={0}>
        <svg viewBox={`0 0 ${width} ${height}`} style={{ minWidth: scrollable ? width : undefined }} role="group" aria-label={`${t('payroll.daily')} · ${currency}`}>
          <defs>
            <linearGradient id={barGradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60a5fa" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
            <linearGradient id={activeGradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" />
              <stop offset="100%" stopColor="#1d4ed8" />
            </linearGradient>
          </defs>
          {Array.from({ length: 5 }, (_, i) => ceiling * i / 4).map(value => <g key={value} aria-hidden="true">
            <line x1={left} x2={right} y1={y(value)} y2={y(value)} className={value === 0 ? 'payroll-chart-baseline' : 'payroll-chart-grid'} />
            <text x={left - 8} y={y(value) + 4} textAnchor="end">{new Intl.NumberFormat(getFormatLocale(), { maximumFractionDigits: 2, notation: value >= 100000000 ? 'compact' : 'standard' }).format(value / 100)}</text>
          </g>)}
          {rows.length > 1 && <g aria-hidden="true">
            <line x1={left} x2={right} y1={y(avgCents)} y2={y(avgCents)} className="payroll-chart-avg-line" />
            <text x={right - 4} y={Math.max(12, y(avgCents) - 5)} textAnchor="end" className="payroll-chart-avg-label">{t('payroll.chartAverage')} {money(avgCents)}</text>
          </g>}
          {days.map(day => {
            const date = dayLabel(day);
            if (byDate.has(date)) return null;
            return <rect key={date} x={x(day) - barWidth / 2} y={bottom - 2} width={barWidth} height={2} rx={1} className="payroll-chart-zero" aria-hidden="true" />;
          })}
          {rows.map(row => {
            const day = dayNumber(row.date), cx = x(day), isSelected = active?.date === row.date;
            const barTop = Math.min(bottom - 4, y(row.amount_cents)), barHeight = Math.max(4, bottom - barTop);
            const pillText = money(row.amount_cents), pillWidth = Math.max(48, pillText.length * 7 + 16);
            const pillX = Math.min(right - pillWidth / 2, Math.max(left + pillWidth / 2, cx)), pillY = Math.max(15, barTop - 7);
            return <g key={row.date}>
              {isSelected && <rect x={cx - slotWidth / 2} y={top - 6} width={slotWidth} height={bottom - top + 6} rx={4} className="payroll-chart-band" aria-hidden="true" />}
              <rect x={cx - slotWidth / 2} y={top - 6} width={slotWidth} height={bottom - top + 6} className="payroll-chart-hit" aria-hidden="true" onMouseEnter={() => setSelected(row.date)} onClick={() => setSelected(row.date)} />
              <path d={barPath(cx - barWidth / 2, barTop, barWidth, barHeight, 5)} fill={`url(#${isSelected ? activeGradId : barGradId})`}
                className={`payroll-chart-bar${isSelected ? ' is-selected' : ''}`} role="button" tabIndex={0} aria-label={description(row)} aria-pressed={isSelected}
                onMouseEnter={() => setSelected(row.date)} onFocus={() => setSelected(row.date)} onClick={() => setSelected(row.date)} onKeyDown={event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); setSelected(row.date); } }}><title>{description(row)}</title></path>
              {isSelected && <g transform={`translate(${pillX}, ${pillY})`} className="payroll-chart-pill" aria-hidden="true">
                <rect x={-pillWidth / 2} y={-14} width={pillWidth} height={18} rx={9} />
                <text x={0} y={-2} textAnchor="middle">{pillText}</text>
              </g>}
            </g>;
          })}
          {ticks.map(day => <text key={day} x={x(day)} y={height - 6} textAnchor="middle" aria-hidden="true">{startDate.slice(0, 4) === endDate.slice(0, 4) ? dayLabel(day).slice(5) : dayLabel(day)}</text>)}
        </svg>
      </div>
      <div className="payroll-chart-footer">
        <div className="payroll-chart-selection-wrap">
          <span className="payroll-chart-dot" aria-hidden="true" />
          <p className="payroll-chart-selection" role="status">{active && description(active)}</p>
        </div>
        <span className="payroll-chart-period-total">{t('payroll.totals')} · {currency} {money(totalCents)}</span>
      </div>
    </>}
  </section>;
}
