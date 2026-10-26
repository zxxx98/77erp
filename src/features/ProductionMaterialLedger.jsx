import { useId, useState } from 'react';
import { useLocale } from '../i18n/react.jsx';
import { t, getFormatLocale } from '../i18n/index.js';
import { bomLossMethodLabels } from '../i18n/production-display.js';
import { bomShortage } from '../../shared/bom.js';
import { money, currencySymbol } from '../app/format.js';
import { MaterialVariance } from './MaterialVariance.jsx';
import './production-material-ledger.css';

const count = value => Number(value ?? 0).toLocaleString(getFormatLocale(), { maximumFractionDigits: 4 });
const cost = cents => `${currencySymbol()}${money(cents / 100)}`;
const columns = [
  ['planned_quantity', 'plannedRequirement'], ['pending_issue_quantity', 'pendingIssue'],
  ['issued_quantity', 'issued'], ['used_quantity', 'used'],
  ['returned_quantity', 'returned'], ['available_quantity', 'issuedBalance'],
];

export function ProductionMaterialLedger({ order, costs, busy }) {
  useLocale();
  const id = useId(), [expanded, setExpanded] = useState(() => new Set());
  const issued = ['in_progress', 'completed'].includes(order.status);
  const toggle = productId => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(productId)) next.delete(productId); else next.add(productId);
    return next;
  });
  return <div className="production-ledger-wrap">
    <table className="production-ledger" aria-label={t('production.materialLedger')}>
      <thead><tr><th scope="col">{t('production.material2')}</th>
        {columns.map(([field, label]) => <th scope="col" key={field}>{t(`production.${label}`)}</th>)}
        <th scope="col"><span className="bom-visually-hidden">{t('production.materialDetails')}</span></th>
      </tr></thead>
      {order.items.map(item => {
        const open = expanded.has(item.product_id), detailsId = `${id}-${item.product_id}`;
        const values = { ...item, used_quantity: order.stage_workflow ? item.direct_consumed_quantity : item.actual_quantity };
        const shortage = !order.completed_at && item.product && (issued || item.product.stock !== undefined)
          ? bomShortage(item.planned_quantity, issued ? item.available_quantity : item.product.stock) : 0;
        return <tbody key={item.product_id}>
          <tr className="production-ledger-row">
            <th scope="row" className="production-ledger-material"><strong>{item.name}</strong><small>{item.barcode}{item.specification && ` · ${item.specification}`}</small>
              {shortage > 0 && <p className="bom-shortage">{t(issued ? 'production.supplementNeeded' : 'production.shortage')} {count(shortage)} {item.unit}</p>}
              {item.product && item.unit !== item.product.unit && <p className="bom-warning">{t('production.currentUnitChangedTo')} {item.product.unit}{t('production.thisOrderRetains')} {item.unit}。</p>}
              {item.product && !item.product.active && <p className="bom-warning">{t('production.materialDisabled')}</p>}
            </th>
            {columns.map(([field, label]) => <td key={field} data-field={field} data-label={t(`production.${label}`)} className={field === 'available_quantity' ? 'production-ledger-balance' : undefined}>
              <span>{count(values[field])} <small>{item.unit}</small></span>
            </td>)}
            <td className="production-ledger-toggle"><button type="button" className="bom-tree-action" disabled={busy} aria-expanded={open} aria-controls={detailsId}
              aria-label={t(open ? 'production.collapseLedgerDetails' : 'production.viewDetails2', { v0: item.name })} onClick={() => toggle(item.product_id)}>{t(open ? 'production.collapse' : 'production.viewDetails')}</button></td>
          </tr>
          <tr id={detailsId} hidden={!open} className="production-ledger-details"><td colSpan={8}>
            {open && <>
              <dl className="production-ledger-metadata">
                <div><dt>{t('production.requestedQuantity')}</dt><dd>{count(item.requested_quantity)} {item.unit}</dd></div>
                {item.closed_request_quantity > 0 && <div><dt>{t('production.closedQuantity')}</dt><dd>{count(item.closed_request_quantity)} {item.unit}</dd></div>}
                {item.base_quantity !== null && <>
                  <div><dt>{t('production.baseNetUsage')}</dt><dd>{item.base_quantity_fraction || count(item.base_quantity)} {item.unit}</dd></div>
                  <div><dt>{t('production.standardLoss')}</dt><dd>{count(item.loss_rate)}% · {bomLossMethodLabels[order.loss_method]}</dd></div>
                </>}
                {!order.completed_at && !issued && item.product?.stock !== undefined && <div><dt>{t('production.bookStock')}</dt><dd>{count(item.product.stock)} {item.unit}</dd></div>}
                {!!order.stage_workflow && <div><dt>{t('production.finalProductUsage')}</dt><dd data-field="final_product_usage">{count(item.actual_quantity)} {item.unit}</dd></div>}
                {costs && <div><dt>{t('production.remainingMaterialCost')}</dt><dd>{cost(item.available_cost_cents)}</dd></div>}
                {costs && order.completed_at && <div><dt>{t('production.materialCost')}</dt><dd>{cost(item.cost_cents)}</dd></div>}
              </dl>
              {item.base_quantity === null && <p className="bom-hint">{t('production.multiLevelRecipeSummarySeeStructureSourcesFor')}</p>}
              {item.note && <p className="production-note">{item.note}</p>}
              {!!order.stage_workflow && <p className="bom-hint">{t('production.ledgerStageUsageHint')}</p>}
              {order.completed_at && <><p className="bom-hint">{t('production.standardUsageUsesTheSavedNetUsageLoss')}</p><MaterialVariance row={item} analysis={item} /></>}
            </>}
          </td></tr>
        </tbody>;
      })}
    </table>
  </div>;
}
