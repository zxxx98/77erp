import { exactCompare, exactMultiply, exactQuantity, exactSubtract, formatExactQuantity } from '../../shared/exact-quantity.js';
import { t, getFormatLocale } from '../i18n/index.js';

const count = value => formatExactQuantity(value, getFormatLocale());

export function PostProcessingMaterialPreview({ materials, items, runs }) {
  if (!materials?.length) return null;
  return <section className="registration-fixed-materials" aria-label={t('production.fixedMaterialPreview')}>
    <h3>{t('production.fixedMaterialPreview')}</h3>
    <p className="bom-hint">{t('production.fixedMaterialPreviewHint')}</p>
    <ul>
      {materials.map(row => {
        const item = items.find(item => item.product_id === row.product_id);
        const available = exactQuantity(item, 'available_quantity');
        const needed = Number.isInteger(runs) && runs > 0 ? exactMultiply(row.quantity, runs) : null;
        const shortage = needed != null && exactCompare(needed, available) > 0;
        const product = item?.product;
        const changed = product && (!product.active || product.unit !== row.unit ||
          (product.unit_round_up != null && product.unit_round_up !== row.unit_round_up));
        const values = quantity => ({ quantity: count(quantity), unit: row.unit });
        return <li key={row.product_id}>
          <strong>{row.name}</strong>
          <p className="bom-hint">{t('production.fixedMaterialPerRun', values(row.quantity))} · {t('production.fixedMaterialBalance', values(available))}</p>
          {needed != null && <p>{t('production.fixedMaterialThisRun', values(needed))}</p>}
          {shortage && <p className="bom-shortage">{t('production.fixedMaterialShortage', values(exactSubtract(needed, available)))}</p>}
          {changed && <p className="bom-warning">{t('production.fixedMaterialChanged')}</p>}
        </li>;
      })}
    </ul>
  </section>;
}
