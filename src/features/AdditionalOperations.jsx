import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../components/common.jsx';
import { Input } from '../ui/controls.jsx';
import { FormField } from '../ui/FormField.jsx';
import { t } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { ProductPicker } from './ProductPicker.jsx';
import { IndependentOperationPicker } from './IndependentOperationPicker.jsx';

export function AdditionalOperations({ rows, onChange, data, unit, disabled }) {
  useLocale();
  const [picker, setPicker] = useState(false);
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
    <Button type="button" icon={Plus} disabled={disabled || rows.length >= 50} onClick={() => setPicker(true)}>{t('production.addAdditionalOperation')}</Button>
    {picker && <IndependentOperationPicker data={data} routeKind="production" title={t('production.addAdditionalOperation')} emptyMessage={t('production.noAdditionalOperations')}
      rows={rows} onSelect={row => onChange([...rows, { ...row, quantity: '', materials: [] }])} onClose={() => setPicker(false)} />}
  </section>;
}
