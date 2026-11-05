import { Trash2 } from 'lucide-react';
import { ProductPicker } from './ProductPicker.jsx';
import { Button } from '../components/common.jsx';
import { Input } from '../ui/controls.jsx';
import { t } from '../i18n/index.js';
import { parseQuantity } from '../../shared/quantity.js';

export function postProcessingMaterialPayload(materials) {
  return (materials || []).map(row => {
    let quantity;
    try { quantity = parseQuantity(row.quantity, true); }
    catch { throw new Error(t('route.materialQuantityInvalid', { name: row.name })); }
    if (row.unit_round_up && !Number.isInteger(quantity)) throw new Error(t('route.materialWholeUnit', { name: row.name }));
    return { product_id: row.product_id, quantity };
  });
}

export function PostProcessingMaterialEditor({ data, materials, onChange, onError, disabled }) {
  return <section className="process-fixed-materials" aria-label={t('route.fixedMaterials')}>
    <strong>{t('route.fixedMaterials')}</strong>
    <p className="bom-hint">{t('route.fixedMaterialsHint')}</p>
    <ProductPicker data={data} material disabled={disabled || materials.length >= 100} onSelect={product => {
      if (materials.some(row => row.product_id === product.id)) {
        onError(t('route.materialDuplicate', { name: product.name }));
        return;
      }
      const { id, name, barcode, specification, unit, unit_round_up } = product;
      onChange([...materials, { product_id: id, name, barcode, specification, unit, unit_round_up, quantity: '1' }]);
    }} />
    {materials.length >= 100 && <p className="bom-hint">{t('route.materialLimit')}</p>}
    {materials.map(row => {
      const label = `${t('route.materialPerRun')} ${row.name}`;
      return <div className="process-fixed-material" key={row.product_id}>
        <strong>{row.name}</strong>
        <small>{[row.barcode, row.specification, row.unit].filter(Boolean).join(' · ')}</small>
        <label>{t('route.materialPerRun')} ({row.unit})
          <Input aria-label={label} inputMode={row.unit_round_up ? 'numeric' : 'decimal'} value={row.quantity} disabled={disabled}
            onChange={event => onChange(materials.map(item => item.product_id === row.product_id ? { ...item, quantity: event.target.value } : item))} />
        </label>
        <Button icon={Trash2} aria-label={t('route.materialRemove', { name: row.name })} disabled={disabled}
          onClick={() => onChange(materials.filter(item => item.product_id !== row.product_id))}>{t('route.materialRemove', { name: row.name })}</Button>
      </div>;
    })}
  </section>;
}
