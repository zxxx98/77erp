import { useId, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { postProcessingLimit } from '../../shared/post-processing.js';
import { parseQuantity } from '../../shared/quantity.js';
import { exactAdd, exactMultiply, exactQuantity, formatExactQuantity } from '../../shared/exact-quantity.js';
import { Button } from '../components/common.jsx';
import { Input } from '../ui/controls.jsx';
import { FormField } from '../ui/FormField.jsx';
import { t, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { IndependentOperationPicker } from './IndependentOperationPicker.jsx';
import './post-processing-plan.css';

const MAX_OPERATIONS = 50;

function materialsPerRun(row) {
  return (row.usage_basis === 'material' ? row.materials_per_run : row.materials) ?? [];
}

function estimatedRuns(plannedQuantity, row, perRun) {
  const graph = { nodes: [{ materials: perRun }], ...(row.usage_basis === 'material' ? { post_processing_materials_per_unit: row.materials } : {}) };
  try { return postProcessingLimit(parseQuantity(plannedQuantity, true), parseQuantity(row.product_coefficient, true), true, graph); }
  catch { return null; }
}

export function PostProcessingPlannedMaterials({ rows, plannedQuantity }) {
  useLocale();
  const headingId = useId();
  const totals = new Map();
  for (const row of rows) {
    const perRun = materialsPerRun(row);
    if (!perRun.length) continue;
    const runs = estimatedRuns(plannedQuantity, row, perRun);
    if (runs == null) continue;
    for (const material of perRun) {
      const quantity = exactMultiply(material.quantity, runs);
      const total = exactAdd(totals.get(material.product_id)?.total ?? 0, quantity);
      totals.set(material.product_id, { ...material, total });
    }
  }
  if (!totals.size) return null;
  return <section className="post-processing-planned-materials" aria-labelledby={headingId}>
    <h3 id={headingId}>{t('production.postProcessingPlannedMaterials')}</h3>
    <div className="erp-table-wrap erp-table-mobile-stack">
      <table className="erp-table post-processing-material-list">
        <thead>
          <tr>
            <th scope="col">{t('production.material2')}</th>
            <th scope="col" className="erp-col-num">{t('production.plannedUsage')}</th>
          </tr>
        </thead>
        <tbody>
          {[...totals.values()].map(material => <tr key={material.product_id}>
            <td className="erp-cell-main"><strong>{material.name}</strong></td>
            <td className="erp-col-num" data-label={t('production.plannedUsage')}><span>{t('production.fixedMaterialPlanned', { quantity: formatExactQuantity(material.total, getFormatLocale()), unit: material.unit })}</span></td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>;
}

export function PostProcessingPlan({ rows, onChange, data, unit, plannedQuantity, disabled, readOnly = false, hint = 'production.postProcessingPlanHint', children }) {
  useLocale();
  const [picker, setPicker] = useState(false);
  return <section className="panel bom-section post-processing-plan">
    <h2>{t('production.postProcessing')}</h2>
    <p className="bom-hint">{t(hint)}</p>
    {children}
    {rows.length > 0 && <div className="erp-table-wrap erp-table-mobile-stack">
      <table className="erp-table post-processing-plan-table">
        <thead>
          <tr>
            <th scope="col">{t('production.postOpCol')}</th>
            <th scope="col">{t('production.coefficientCol')}</th>
            {!readOnly && <th scope="col" className="erp-col-actions">{t('production.actionsCol')}</th>}
          </tr>
        </thead>
        {rows.map((row, index) => {
          const perRun = materialsPerRun(row);
          const estimate = estimatedRuns(plannedQuantity, row, perRun);
          const label = `${t('production.productCoefficient')} ${row.name}`;
          const hasMaterials = (row.materials || []).length > 0;
          return <tbody key={`${row.route_id}:${row.node_id}`} className="post-processing-binding">
            <tr className="post-processing-row">
              <td className="erp-cell-main">
                <div className="post-processing-name">
                  <strong>{row.name}</strong>
                  <small>{row.route_name} · {t('route.priceTable')} · {row.price_table_name || t('route.defaultPriceTable')}</small>
                </div>
              </td>
              <td data-label={t('production.coefficientCol')}>
                <div className="erp-cell-stack">
                  {row.usage_basis === 'material' ? <span>{t('production.bomPostProcessingAutomatic')}</span> : readOnly ? <span>{t('production.productCoefficient')} {row.product_coefficient} {unit}</span> : <div className="erp-inline-field">
                    <FormField required value={row.product_coefficient} label={label}>
                      <Input aria-label={label} inputMode="decimal" value={row.product_coefficient} disabled={disabled}
                        onChange={event => onChange(rows.map((item, i) => i === index ? { ...item, product_coefficient: event.target.value } : item))} />
                    </FormField>
                  </div>}
                  {estimate != null && <small>{t('production.postProcessingEstimate', { count: estimate.toLocaleString(getFormatLocale()) })}</small>}
                </div>
              </td>
              {!readOnly && <td className="erp-col-actions">
                <Button icon={Trash2} aria-label={`${t('production.removePostProcessing')} ${row.name}`} disabled={disabled}
                  onClick={() => onChange(rows.filter((_, i) => i !== index))}>{t('production.removePostProcessing')}</Button>
              </td>}
            </tr>
            {hasMaterials && <tr className="erp-subrow">
              <td colSpan={readOnly ? 2 : 3}>
                <div className="erp-table-wrap erp-table-mobile-stack">
                  <table className="erp-table post-processing-material-list">
                    <thead>
                      <tr>
                        <th scope="col">{t('production.material2')}</th>
                        <th scope="col" className={!readOnly ? undefined : 'erp-col-num'}>{t('production.fixedMaterialsCol')}</th>
                        {!readOnly && <th scope="col">{t('production.note')}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {row.materials.map(material => {
                        const values = quantity => ({ quantity: formatExactQuantity(quantity, getFormatLocale()), unit: material.unit });
                        if (!readOnly) {
                          const materialLabel = `${t('production.postProcessingMaterialPerRun')} ${material.name}`;
                          const updateMaterial = changes => onChange(rows.map((item, rowIndex) => rowIndex === index ? { ...item, materials: item.materials.map(entry =>
                            entry.product_id === material.product_id ? { ...entry, ...changes } : entry) } : item));
                          return <tr key={material.product_id} className="post-processing-material-editor">
                            <td className="erp-cell-main"><strong>{material.name}</strong></td>
                            <td className="erp-cell-full" data-label={`${t('production.postProcessingMaterialPerRun')} (${material.unit})`}>
                              <div className="erp-inline-field">
                                <FormField required value={material.quantity} label={materialLabel}>
                                  <Input aria-label={materialLabel} inputMode={material.unit_round_up ? 'numeric' : 'decimal'} value={material.quantity ?? ''} disabled={disabled}
                                    onChange={event => updateMaterial({ quantity: event.target.value })} />
                                </FormField>
                              </div>
                            </td>
                            <td className="erp-cell-full post-processing-material-note" data-label={t('production.note')}>
                              <Input aria-label={`${t('production.note')} ${material.name}`} maxLength={500} value={material.note ?? ''} disabled={disabled}
                                onChange={event => updateMaterial({ note: event.target.value })} />
                            </td>
                          </tr>;
                        }
                        const quantity = perRun.find(entry => entry.product_id === material.product_id)?.quantity ?? material.quantity;
                        return <tr key={material.product_id}>
                          <td className="erp-cell-main"><strong>{material.name}</strong></td>
                          <td className="erp-col-num" data-label={t('production.fixedMaterialsCol')}>
                            <span>
                              {row.usage_basis === 'material' && <>{t('production.bomPostMaterialRate', values(exactQuantity(material)))} · </>}
                              {t('production.fixedMaterialPerRun', values(quantity))}
                              {estimate != null && ` · ${t('production.fixedMaterialPlanned', values(exactMultiply(quantity, estimate)))}`}
                            </span>
                          </td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              </td>
            </tr>}
          </tbody>;
        })}
      </table>
    </div>}
    {!readOnly && <Button icon={Plus} disabled={disabled || rows.length >= MAX_OPERATIONS} onClick={() => setPicker(true)}>{t('production.addPostProcessing')}</Button>}
    {picker && <IndependentOperationPicker data={data} routeKind="post_processing" title={t('production.addPostProcessing')} emptyMessage={t('production.noPostProcessing')}
      rows={rows} maxOperations={MAX_OPERATIONS} onSelect={added => onChange([...rows, ...added.map(row => ({ ...row, product_coefficient: '',
        materials: (row.materials ?? []).map(material => ({ ...material, quantity: '' })) }))])} onClose={() => setPicker(false)} />}
  </section>;
}
