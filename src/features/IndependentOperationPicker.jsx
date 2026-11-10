import { useState } from 'react';
import { Button, Modal, QueryStatus } from '../components/common.jsx';
import { Input } from '../ui/controls.jsx';
import { Select } from '../Dropdown.jsx';
import { DEFAULT_PRICE_TABLE, processPriceTables } from '../../shared/process-routes.js';
import { useQuery, queryPath } from '../queries.js';
import { t } from '../i18n/index.js';

export function IndependentOperationPicker({ data, routeKind, title, emptyMessage, rows, onSelect, onClose }) {
  const [search, setSearch] = useState(''), [offset, setOffset] = useState(0), [selected, setSelected] = useState(null);
  const [priceTableId, setPriceTableId] = useState(DEFAULT_PRICE_TABLE);
  const tables = selected ? processPriceTables(selected.graph) : [];
  const query = useQuery(queryPath('/process-routes', { route_kind: routeKind, q: search, status: 'enabled', offset, limit: 10 }), data, 150);
  return <Modal title={title} onClose={onClose}>
    <div className="form-body">
      <Input type="search" aria-label={t('route.search')} placeholder={t('route.search')} value={search} onChange={event => { setSearch(event.target.value); setOffset(0); setSelected(null); }} />
      <QueryStatus query={query} />
      {!selected ? <>
        {query.result?.routes.map(route => <Button key={route.id} onClick={() => { setSelected(route); setPriceTableId(DEFAULT_PRICE_TABLE); }}>{route.name}</Button>)}
        {query.result?.routes.length === 0 && <p className="bom-hint">{emptyMessage}</p>}
        <div className="bom-actions"><Button disabled={!offset || query.loading} onClick={() => setOffset(n => n - 10)}>{t('route.previous')}</Button><Button disabled={!query.result?.has_more || query.loading} onClick={() => setOffset(n => n + 10)}>{t('route.next')}</Button></div>
      </> : <>
        <strong>{selected.name}</strong>
        <label>{t('route.priceTable')}<Select aria-label={t('route.priceTable')} value={priceTableId} onChange={setPriceTableId}>
          {tables.map(table => <option key={table.id} value={table.id}>{table.id === DEFAULT_PRICE_TABLE ? t('route.defaultPriceTable') : table.name}</option>)}
        </Select></label>
        {selected.graph.nodes.map(node => <Button key={node.id} disabled={rows.some(row => row.route_id === selected.id && row.node_id === node.id)} onClick={() => {
          onSelect({ route_id: selected.id, route_version: selected.version, node_id: node.id, name: node.name, route_name: selected.name, materials: node.materials,
            price_table_id: priceTableId === DEFAULT_PRICE_TABLE ? null : priceTableId, price_table_name: tables.find(table => table.id === priceTableId)?.name });
          onClose();
        }}>{node.name}</Button>)}
        <Button onClick={() => setSelected(null)}>{t('route.back')}</Button>
      </>}
    </div>
  </Modal>;
}
