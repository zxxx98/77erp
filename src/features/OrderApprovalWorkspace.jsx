import { t as translate, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { useEffect, useId, useState } from 'react';
import { Button } from '../ui/controls.jsx';
import { usePermissions } from '../permissions.jsx';
import { queryPath, useQuery } from '../queries.js';
import { ProductionMaterialDocuments } from './ProductionMaterialDocuments.jsx';
import { ProductionReceipts } from './ProductionReceipts.jsx';
import './order-approval-workspace.css';

const readRoute = () => {
  const params = new URLSearchParams(window.location.hash.split('?')[1]);
  return { selected: params.get('approval') || 'records', query: params.get('q') || '' };
};

export function OrderApprovalWorkspace({ data, type, onChanged, children }) {
  useLocale();
  const { can } = usePermissions();
  const id = useId();
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const update = () => setRoute(readRoute());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const inbound = type !== 'out' && can('purchase');
  const outbound = type !== 'in' && can('sale');
  const receipts = useQuery(inbound ? queryPath('/production-receipts', { status: 'pending', limit: 1 }) : null, data);
  const returns = useQuery(inbound ? queryPath('/production-material-documents', { type: 'in', status: 'pending', limit: 1 }) : null, data);
  const issues = useQuery(outbound ? queryPath('/production-material-documents', { type: 'out', status: 'pending', limit: 1 }) : null, data);
  const tabs = [
    { key: 'records', label: type === 'in' ? translate("warehouse.warehousing.records") : type === 'out' ? translate("warehouse.outbound.records") : translate("warehouse.document.record") },
    ...(inbound ? [{ key: 'receipts', label: translate("warehouse.finished.products.awaiting.storage"), query: receipts }, { key: 'returns', label: translate("warehouse.returned.materials.awaiting.storage"), query: returns }] : []),
    ...(outbound ? [{ key: 'issues', label: translate("warehouse.picking.replenishing.materials.to.be.shipped.out.of.the.warehouse"), query: issues }] : []),
  ];
  const selected = tabs.some(tab => tab.key === route.selected) ? route.selected : 'records';
  const refreshCounts = () => { if (inbound) { receipts.retry(); returns.retry(); } if (outbound) issues.retry(); };
  const select = key => {
    const [page, search] = window.location.hash.split('?');
    const params = new URLSearchParams(search);
    params.delete('q');
    if (key === 'records') params.delete('approval'); else params.set('approval', key);
    setRoute({ selected: key, query: '' });
    window.location.hash = `${page}${params.size ? `?${params}` : ''}`;
  };
  const keyboard = (event, index) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    select(tabs[next].key);
    document.getElementById(`${id}-${tabs[next].key}`)?.focus();
  };
  return <div className="order-approval-workspace">
    <div className="order-category-tabs" role="tablist" aria-label={translate("warehouse.document.classification")}>
      {tabs.map((tab, index) => <button type="button" key={tab.key} id={`${id}-${tab.key}`} role="tab" aria-selected={selected === tab.key}
        aria-controls={`${id}-panel`} tabIndex={selected === tab.key ? 0 : -1} onClick={() => select(tab.key)} onKeyDown={event => keyboard(event, index)}>
        {tab.label}{tab.query && <span className="order-category-count">{tab.query.result?.total ?? (tab.query.error ? '—' : '…')}</span>}
      </button>)}
    </div>
    {tabs.some(tab => tab.query?.error) && <div className="order-category-error" role="alert">{translate("warehouse.failed.to.read.to.do.quantity")}<Button type="text" onClick={refreshCounts}>{translate("warehouse.number.of.retries.to.be.done")}</Button></div>}
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${selected}`}>
      {selected === 'records' ? children : selected === 'receipts'
        ? <ProductionReceipts key={`${data.warehouse_id}:receipts:${route.query}`} data={data} initialQuery={route.query} onChanged={onChanged} onRefresh={refreshCounts} />
        : <ProductionMaterialDocuments key={`${data.warehouse_id}:${selected}:${route.query}`} data={data} type={selected === 'returns' ? 'in' : 'out'} initialQuery={route.query} onChanged={onChanged} onRefresh={refreshCounts} />}
    </div>
  </div>;
}
