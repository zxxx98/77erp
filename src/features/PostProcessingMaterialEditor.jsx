import { Trash2 } from 'lucide-react';
import { ProductPicker } from './ProductPicker.jsx';
import { Button } from '../components/common.jsx';
import { getFormatLocale, t } from '../i18n/index.js';
import { formatExactQuantity } from '../../shared/exact-quantity.js';
import { defaultPostMaterialPerRun } from '../../shared/post-processing.js';

export function postProcessingMaterialPayload(materials) {
  return (materials || []).map(({ product_id, quantity }) => ({ product_id, quantity }));
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
      const { id, name, barcode, specification, unit } = product;
      onChange([...materials, { product_id: id, name, barcode, specification, unit }]);
    }} />
    {materials.length >= 100 && <p className="bom-hint">{t('route.materialLimit')}</p>}
    {materials.map(row => <div className="process-fixed-material" key={row.product_id}>
      <strong>{row.name}</strong>
      <small>{[row.barcode, row.specification].filter(Boolean).join(' · ')}</small>
      <span>{t('production.fixedMaterialPerRun', { quantity: formatExactQuantity(row.quantity ?? defaultPostMaterialPerRun, getFormatLocale()), unit: row.unit })}</span>
      <Button icon={Trash2} aria-label={t('route.materialRemove', { name: row.name })} disabled={disabled}
        onClick={() => onChange(materials.filter(item => item.product_id !== row.product_id))}>{t('route.materialRemove', { name: row.name })}</Button>
    </div>)}
  </section>;
}
