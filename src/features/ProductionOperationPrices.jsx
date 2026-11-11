import { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, QueryStatus } from '../components/common.jsx';
import { useQuery } from '../queries.js';
import { usePermissions } from '../permissions.jsx';
import { t, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import './production-operation-prices.css';

const count = value => Number(value).toLocaleString(getFormatLocale(), { maximumFractionDigits: 4 });

export function ProductionOperationPrices({ order, warehouseId, busy, onRefresh }) {
  useLocale();
  const { can } = usePermissions();
  const data = useMemo(() => ({ warehouse_id: warehouseId, version: order.version }), [warehouseId, order.version]);
  const query = useQuery(can('bom') ? `/production-orders/${order.id}/operation-prices` : null, data);
  if (!can('bom')) return null;
  return <section className="panel bom-section production-operation-prices">
    <div className="bom-section-heading">
      <h2>{t('production.operationPricesTab')}</h2>
      {order.status !== 'void' && !!order.operation_routes?.length && <Button icon={RefreshCw} disabled={busy || query.loading || !!query.error} onClick={onRefresh}>{t('production.refreshOperationPrices')}</Button>}
    </div>
    <p className="bom-hint">{t('production.operationPricesSnapshotHint')}</p>
    <QueryStatus query={query} />
    {query.error && <Button onClick={query.retry}>{t('route.reload')}</Button>}
    {query.result && !query.result.routes.length && <p className="bom-empty">{t('production.noOperationPrices')}</p>}
    {query.result?.routes.map(route => <article key={route.id} className="production-price-route">
      <h3>{route.product_name} · {route.route_name}</h3>
      <p className="bom-hint">{t('route.priceTable')} · {route.price_table_name || t('route.defaultPriceTable')}{route.path && !route.path.startsWith('@post:') && ` · ${route.path}`}</p>
      <div className="production-price-table-wrap"><table className="production-price-table" aria-label={`${route.product_name} · ${route.route_name}`}>
        <thead><tr><th scope="col">{t('route.operations')}</th><th scope="col">{t('payroll.unitPrice')}</th><th scope="col">{t('route.multiplier')}</th></tr></thead>
        <tbody>{route.operations.map(node => <tr key={node.id}>
          <th scope="row">{node.name}</th>
          <td>{node.unit_price == null ? t('payroll.unpriced') : `${node.currency} ${count(node.unit_price)} / ${route.unit}`}</td>
          <td>× {count(node.multiplier)}</td>
        </tr>)}</tbody>
      </table></div>
    </article>)}
  </section>;
}
