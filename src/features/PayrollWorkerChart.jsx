import { useState } from 'react';
import { Modal } from '../components/common.jsx';
import { t, getFormatLocale } from '../i18n/index.js';

const number = value => new Intl.NumberFormat(getFormatLocale(), { maximumFractionDigits: 8 }).format(value);
const amount = (cents, currency) => cents == null ? t('payroll.unpriced') : `${currency ? `${currency} ` : ''}${new Intl.NumberFormat(getFormatLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)}`;

export function PayrollWorkerChart({ workers }) {
  const [selectedKey, setSelectedKey] = useState(null);
  const workerKey = worker => worker.worker_id ?? `name:${worker.worker_name}`;
  const selected = workers.find(worker => workerKey(worker) === selectedKey);
  const groups = new Map();
  for (const worker of workers) {
    const earnings = worker.currencies.length ? worker.currencies : [{ currency: '', amount_cents: worker.unpriced_count ? null : 0 }];
    for (const earning of earnings) {
      if (!groups.has(earning.currency)) groups.set(earning.currency, []);
      groups.get(earning.currency).push({ worker, cents: earning.amount_cents });
    }
  }
  return <section className="panel payroll-section payroll-worker-chart" aria-label={t('payroll.workerBreakdown')}>
    <h2>{t('payroll.workerBreakdown')}</h2>
    {[...groups].sort(([a], [b]) => a && b ? a.localeCompare(b) : a ? -1 : b ? 1 : 0).map(([currency, rows]) => {
      rows.sort((a, b) => (b.cents ?? -1) - (a.cents ?? -1) || a.worker.worker_name.localeCompare(b.worker.worker_name, getFormatLocale()));
      const maximum = Math.max(1, rows[0]?.cents ?? 0);
      return <div className="payroll-worker-chart-group" key={currency} role="group" aria-label={currency || t('payroll.wage')}>
        {currency && <h3>{currency}</h3>}
        <ol className="payroll-worker-bars">
          {rows.map(({ worker, cents }) => <li key={workerKey(worker)}>
            <button type="button" className="payroll-worker-bar" aria-haspopup="dialog"
              aria-label={`${worker.worker_name} · ${amount(cents, currency)}`} onClick={() => setSelectedKey(workerKey(worker))}>
              <span className="payroll-worker-bar-name">{worker.worker_name}</span>
              <span className="payroll-worker-bar-track" aria-hidden="true"><span className="payroll-worker-bar-fill" style={{ width: `${(cents ?? 0) / maximum * 100}%` }} /></span>
              <strong className="payroll-worker-bar-value">{amount(cents, currency)}</strong>
            </button>
          </li>)}
        </ol>
      </div>;
    })}
    {selected && <Modal title={`${selected.worker_name} · ${t('payroll.details')}`} onClose={() => setSelectedKey(null)} wide className="payroll-worker-modal">
      <div className="form-body payroll-worker-detail">
        <div className="payroll-worker-currencies">
          {selected.currencies.length ? selected.currencies.map(row => <strong key={row.currency}>{amount(row.amount_cents, row.currency)}</strong>) : <strong>{amount(selected.unpriced_count ? null : 0, '')}</strong>}
        </div>
        <p className="payroll-muted">{t('payroll.workerReportStats', { active: selected.active_count, void: selected.void_count })}{selected.unpriced_count > 0 ? ` · ${t('payroll.workerUnpriced', { count: selected.unpriced_count })}` : ''}</p>
        <ul className="payroll-worker-detail-list">
          {selected.operations.map(operation => <li key={operation.key}>
            <div><strong>{operation.operation_name}</strong><p>{operation.route_name} · {t('payroll.operationCount', { count: operation.report_count })}</p></div>
            <div className="payroll-worker-detail-formula"><span>{operation.quantity_fraction || number(operation.quantity)} {operation.unit} × {number(operation.multiplier)} × {operation.unit_price == null ? t('payroll.unpriced') : `${operation.currency} ${number(operation.unit_price)}`}</span><strong>{amount(operation.amount_cents, operation.currency)}</strong></div>
          </li>)}
        </ul>
      </div>
    </Modal>}
  </section>;
}
