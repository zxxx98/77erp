import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Modal, QueryStatus } from '../components/common.jsx';
import { Input } from '../ui/controls.jsx';
import { FormField } from '../ui/FormField.jsx';
import { useQuery, queryPath } from '../queries.js';
import { t } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { ProductPicker } from './ProductPicker.jsx';

export function AdditionalOperations({ rows, onChange, data, unit, disabled }) {
  useLocale();
  const [picker, setPicker] = useState(false), [search, setSearch] = useState(''), [offset, setOffset] = useState(0), [selected, setSelected] = useState(null);
  const query = useQuery(queryPath('/process-routes', { q: search, status: 'enabled', offset, limit: 10 }), data, 150);
  return <section className="panel bom-section additional-operations">
    <h2>{t('production.additionalOperations')}</h2>
    <p className="bom-hint">{t('production.additionalOperationsHint')}</p>
    {rows.map((row, index) => <section key={`${row.route_id}:${row.node_id}`} className="additional-operation-plan"><article className="production-material">
      <div className="production-material-name"><strong>{row.name}</strong><small>{row.route_name}</small></div>
      <label>{t('production.additionalQuantity')}（{unit}）<FormField required value={row.quantity} label={`${t('production.additionalQuantity')} ${row.name}`}>
        <Input aria-label={`${t('production.additionalQuantity')} ${row.name}`} inputMode="decimal" value={row.quantity} disabled={disabled}
          onChange={event => onChange(rows.map((item, i) => i === index ? { ...item, quantity: event.target.value } : item))} />
      </FormField></label>
      <Button type="button" icon={Trash2} aria-label={`${t('production.removeAdditionalOperation')} ${row.name}`} disabled={disabled} onClick={() => onChange(rows.filter((_, i) => i !== index))}>{t('production.removeAdditionalOperation')}</Button>
    </article>
      <h3>{t('production.additionalMaterials')}</h3><p className="bom-hint">{t('production.additionalMaterialPlanHint')}</p>
      {(row.materials || []).map(material => <div className="production-material" key={material.product_id}>
        <div className="production-material-name"><strong>{material.name}</strong><small>{material.barcode}</small></div>
        <label>{t('production.additionalPlannedMaterial')}（{material.unit}）<FormField required value={material.quantity} label={`${row.name} ${material.name} ${t('production.additionalPlannedMaterial')}`}>
          <Input aria-label={`${row.name} ${material.name} ${t('production.additionalPlannedMaterial')}`} inputMode="decimal" value={material.quantity} disabled={disabled}
            onChange={event => onChange(rows.map((item, i) => i === index ? { ...item, materials: item.materials.map(source => source.product_id === material.product_id ? { ...source, quantity: event.target.value } : source) } : item))} />
        </FormField></label>
        <Button disabled={disabled} aria-label={`${t('production.removeAdditionalMaterial')} ${material.name}`} onClick={() => onChange(rows.map((item, i) => i === index ? { ...item, materials: item.materials.filter(source => source.product_id !== material.product_id) } : item))}>{t('production.removeAdditionalMaterial')}</Button>
      </div>)}
      <ProductPicker material data={data} disabled={disabled || row.materials?.length >= 100} onSelect={product => {
        if (row.materials?.some(item => item.product_id === product.id)) return;
        onChange(rows.map((item, i) => i === index ? { ...item, materials: [...(item.materials || []), { product_id: product.id, name: product.name, barcode: product.barcode, unit: product.unit, quantity: '' }] } : item));
      }} />
    </section>)}
    <Button type="button" icon={Plus} disabled={disabled || rows.length >= 50} onClick={() => { setSearch(''); setOffset(0); setSelected(null); setPicker(true); }}>{t('production.addAdditionalOperation')}</Button>
    {picker && <Modal title={t('production.addAdditionalOperation')} onClose={() => setPicker(false)}>
      <div className="form-body">
        <Input type="search" aria-label={t('route.search')} placeholder={t('route.search')} value={search} onChange={event => { setSearch(event.target.value); setOffset(0); setSelected(null); }} />
        <QueryStatus query={query} />
        {!selected ? <>
          {query.result?.routes.map(route => <Button key={route.id} onClick={() => setSelected(route)}>{route.name}</Button>)}
          {query.result?.routes.length === 0 && <p className="bom-hint">{t('production.noAdditionalOperations')}</p>}
          <div className="bom-actions"><Button disabled={!offset || query.loading} onClick={() => setOffset(n => n - 10)}>{t('route.previous')}</Button><Button disabled={!query.result?.has_more || query.loading} onClick={() => setOffset(n => n + 10)}>{t('route.next')}</Button></div>
        </> : <>
          <strong>{selected.name}</strong>
          {selected.graph.nodes.map(node => <Button key={node.id} disabled={rows.some(row => row.route_id === selected.id && row.node_id === node.id)} onClick={() => {
            onChange([...rows, { route_id: selected.id, route_version: selected.version, node_id: node.id, quantity: '', name: node.name, route_name: selected.name, materials: [] }]); setPicker(false);
          }}>{node.name}</Button>)}
          <Button onClick={() => setSelected(null)}>{t('route.back')}</Button>
        </>}
      </div>
    </Modal>}
  </section>;
}
