import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { postProcessingLimit } from '../../shared/post-processing.js';
import { parseQuantity } from '../../shared/quantity.js';
import { exactMultiply, exactQuantity, formatExactQuantity } from '../../shared/exact-quantity.js';
import { Button } from '../components/common.jsx';
import { Input } from '../ui/controls.jsx';
import { FormField } from '../ui/FormField.jsx';
import { t, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { IndependentOperationPicker } from './IndependentOperationPicker.jsx';
import './post-processing-plan.css';

function estimatedRuns(plannedQuantity, coefficient, graph) {
  try { return postProcessingLimit(parseQuantity(plannedQuantity, true), parseQuantity(coefficient, true), true, graph); }
  catch { return null; }
}

export function PostProcessingPlan({ rows, onChange, data, unit, plannedQuantity, disabled, readOnly = false, hint = 'production.postProcessingPlanHint', children }) {
  useLocale();
  const [picker, setPicker] = useState(false);
  return <section className="panel bom-section post-processing-plan">
    <h2>{t('production.postProcessing')}</h2>
    <p className="bom-hint">{t(hint)}</p>
    {children}
    {rows.map((row, index) => {
      const perRun = row.usage_basis === 'material' ? row.materials_per_run || [] : row.materials;
      const graph = { nodes: [{ materials: perRun }], ...(row.usage_basis === 'material' ? { post_processing_materials_per_unit: row.materials } : {}) };
      const estimate = estimatedRuns(plannedQuantity, row.product_coefficient, graph);
      const label = `${t('production.productCoefficient')} ${row.name}`;
      const hasMaterials = (row.materials || []).length > 0;
      return <section key={`${row.route_id}:${row.node_id}`} className="post-processing-binding">
        <div className="post-processing-row">
          <div className="post-processing-name"><strong>{row.name}</strong><small>{row.route_name}</small><small>{t('route.priceTable')} · {row.price_table_name || t('route.defaultPriceTable')}</small></div>
          {row.usage_basis === 'material' ? <span>{t('production.bomPostProcessingAutomatic')}</span> : readOnly ? <span>{t('production.productCoefficient')} {row.product_coefficient} {unit}</span> : <label>{t('production.productCoefficient')}{unit && `（${unit}）`}<FormField required value={row.product_coefficient} label={label}>
            <Input aria-label={label} inputMode="decimal" value={row.product_coefficient} disabled={disabled}
              onChange={event => onChange(rows.map((item, i) => i === index ? { ...item, product_coefficient: event.target.value } : item))} />
          </FormField></label>}
          {!readOnly && <Button icon={Trash2} aria-label={`${t('production.removePostProcessing')} ${row.name}`} disabled={disabled}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}>{t('production.removePostProcessing')}</Button>}
        </div>
        {estimate != null && <p className="bom-hint">{t('production.postProcessingEstimate', { count: estimate.toLocaleString(getFormatLocale()) })}</p>}
        {hasMaterials && <ul className="post-processing-material-list">
          {row.materials.map(material => {
            const values = quantity => ({ quantity: formatExactQuantity(quantity, getFormatLocale()), unit: material.unit });
            return <li key={material.product_id}>
              <strong>{material.name}</strong>
              <p className="bom-hint">
                {row.usage_basis === 'material' && <>{t('production.bomPostMaterialRate', values(exactQuantity(material)))} · </>}
                {t('production.fixedMaterialPerRun', values(perRun?.find(entry => entry.product_id === material.product_id)?.quantity ?? material.quantity))}
                {estimate != null && ` · ${t('production.fixedMaterialPlanned', values(exactMultiply(perRun?.find(entry => entry.product_id === material.product_id)?.quantity ?? material.quantity, estimate)))}`}</p>
            </li>;
          })}
        </ul>}
      </section>;
    })}
    {!readOnly && <Button icon={Plus} disabled={disabled || rows.length >= 50} onClick={() => setPicker(true)}>{t('production.addPostProcessing')}</Button>}
    {picker && <IndependentOperationPicker data={data} routeKind="post_processing" title={t('production.addPostProcessing')} emptyMessage={t('production.noPostProcessing')}
      rows={rows} onSelect={row => onChange([...rows, { ...row, product_coefficient: '' }])} onClose={() => setPicker(false)} />}
  </section>;
}
