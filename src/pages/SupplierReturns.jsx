import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { t } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Button, Modal, PageHeading, Pagination, QueryStatus } from '../components/common.jsx';
import { Input } from '../ui/controls.jsx';
import { queryPath, useQuery } from '../queries.js';
import { OrderActions } from '../LazyComponents.jsx';
import { supplierReturnStatus } from '../order-utils.js';

function ReturnTable({ data, choosing = false, onSelect }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery(queryPath('/orders', {
    ...(choosing ? { returnable: 1 } : { kind: 'return', type: 'out' }),
    q: query, limit: 8, offset: (page - 1) * 8,
  }), data, query ? 250 : 0);
  const columns = choosing ? ['warehouse.returns.source','warehouse.supplier','warehouse.returns.po','warehouse.delivery.number','warehouse.material.details']
    : ['warehouse.returns.number','warehouse.supplier','warehouse.returns.mode','warehouse.returns.po','warehouse.delivery.number','warehouse.returns.date','warehouse.status'];
  return <>
    <div className="table-toolbar"><Input prefix={<Search size={16} />} allowClear
      aria-label={t('warehouse.returns.search')} placeholder={t('warehouse.returns.search')} value={query}
      onChange={e => { setQuery(e.target.value); setPage(1); }} /></div>
    <QueryStatus query={list} />
    {list.result && <>
      <div className="erp-table-wrap erp-table-mobile-stack"><table className="erp-table data-table orders-table">
        <thead><tr>{columns.map(key => <th key={key}>{t(key)}</th>)}</tr></thead>
        <tbody>{list.result.orders.map(order => {
          const values = choosing ? [order.partner, order.order_number, order.delivery_number, order.item_names.join('、')]
            : [order.partner, t(order.return_mode === 'exchange' ? 'warehouse.returns.exchange' : 'warehouse.returns.return'),
              order.order_number, order.delivery_number, order.return_date || order.created_at.slice(0,10), supplierReturnStatus(order)];
          return <tr key={order.id}>
            <td className="erp-cell-main" data-label={t(columns[0])}><Button onClick={() => onSelect(order)}>{order.number}</Button></td>
            {values.map((value, i) => <td key={columns[i+1]} data-label={t(columns[i+1])}>{value || '—'}</td>)}
          </tr>;
        })}</tbody>
      </table></div>
      {!list.result.total && <p className="muted">{t(choosing ? 'warehouse.returns.noSource' : 'warehouse.returns.empty')}</p>}
      <Pagination total={list.result.total} page={page} setPage={setPage} />
    </>}
  </>;
}

export function SupplierReturns({ data, onNew, showDetail }) {
  useLocale();
  return <>
    <PageHeading title={t('warehouse.returns.title')}>
      <Button permission="corrections" icon={Plus} kind="primary" onClick={onNew}>{t('warehouse.returns.new')}</Button>
    </PageHeading>
    <ReturnTable data={data} onSelect={showDetail} />
  </>;
}

export function SupplierReturnForm({ data, onClose, onSaved }) {
  useLocale();
  const [sourceId, setSourceId] = useState(null);
  const detail = useQuery(sourceId ? `/orders/${sourceId}` : null, data);
  const order = detail.result?.order;
  return <Modal title={t('warehouse.returns.new')} presentation="drawer" drawerSize="wide" wide onClose={onClose}>
    <div className="form-body">
      {!sourceId ? <>
        <h3>{t('warehouse.returns.chooseSource')}</h3>
        <ReturnTable data={data} choosing onSelect={source => setSourceId(source.id)} />
      </> : <>
        <Button onClick={() => setSourceId(null)}>{t('warehouse.returns.changeSource')}</Button>
        <QueryStatus query={detail} />
        {order && <>
          <div className="detail-meta">
            <div><small>{t('warehouse.supplier')}</small><strong>{order.partner}</strong></div>
            <div><small>{t('warehouse.returns.source')}</small><strong>{order.number}</strong></div>
          </div>
          <OrderActions key={order.id} order={order} returnOnly onSaved={onSaved} />
        </>}
      </>}
    </div>
  </Modal>;
}
