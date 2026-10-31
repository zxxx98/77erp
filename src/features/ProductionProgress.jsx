import { useMemo, useState } from 'react';
import { Button, Badge } from '../components/common.jsx';
import { Input } from '../ui/controls.jsx';
import { registrationTargets } from '../production-registration.js';
import { useLocale } from '../i18n/react.jsx';
import { t, getFormatLocale } from '../i18n/index.js';
import { addQuantity } from '../../shared/quantity.js';
import { pooledProductionStages } from '../../shared/production-pools.js';

const count = value => Number(value ?? 0).toLocaleString(getFormatLocale(), { maximumFractionDigits: 6 });

// Keep every product reachable in one list; operations expand in place.
export function ProductionProgress({ order, busy, onRegister, onHistory, onOperations }) {
  useLocale();
  const [search, setSearch] = useState('');
  const targets = useMemo(() => registrationTargets(order), [order]);
  const layers = order.stage_workflow ? pooledProductionStages(order) : [{ ...order, path: '', name: order.product_name }];
  const registerable = order.status === 'in_progress' || !order.material_workflow && order.status === 'draft';
  const matches = layers.filter(layer => `${layer.name} ${layer.path} ${targets.filter(target => target.path === layer.path).map(target => target.name).join(' ')}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <section className="panel bom-section production-progress-list">
    <h2>{t('production.productProgress')}</h2>
    {layers.length > 1 && <Input type="search" aria-label={t('production.searchProductionLevels')} placeholder={t('production.searchProgress')} value={search} onChange={event => setSearch(event.target.value)} />}
    {!matches.length && <p className="bom-hint">{t('production.noMatchingProductionLevels')}</p>}
    {matches.map(layer => {
      const rows = targets.filter(target => target.path === layer.path), routed = rows.some(target => target.node);
      const parent = layers.find(item => item.path === layer.parent_path);
      return <article className="production-progress-item" key={layer.path}>
        <div className="production-list-title"><strong>{layer.name}</strong><Badge tone={layer.completed_quantity >= layer.planned_quantity ? 'green' : layer.completed_quantity ? 'blue' : 'gray'}>{t(layer.completed_quantity >= layer.planned_quantity ? 'production.planReached' : layer.completed_quantity ? 'production.registered2' : 'production.notRegistered')}</Badge></div>
        {layer.pool_paths ? <small>{t('production.sharedSemiFinished')} · {t('production.suppliesProduct', { name: [...new Set(order.stages.filter(s => layer.pool_paths.includes(s.path)).map(s => order.stages.find(p => p.path === s.parent_path)?.name).filter(Boolean))].join('、') })}</small>
          : parent && <small>{t('production.suppliesProduct', { name: parent.name })} · {layer.path}</small>}
        <div className="production-progress-item-main"><span>{t('production.completed')} <strong>{count(layer.completed_quantity)}</strong> / {count(layer.planned_quantity)} {layer.unit}</span>
          <div className="bom-actions">
            {!routed && registerable && <Button disabled={busy} onClick={() => onRegister(rows[0].id)} aria-label={t('production.register4', { v0: layer.name })}>{t('production.register')}</Button>}
            <Button disabled={busy} onClick={() => onHistory(layer.path)} aria-label={t('production.viewBatches', { v0: layer.name })}>{t('production.batchRecords')}</Button>
          </div>
        </div>
        {layer.pool_paths && <><p className="bom-hint">{t('production.poolHint')}</p>
          <p className="bom-hint">{t('production.availableInOrder')} <strong>{count(layer.available_quantity)} {layer.unit}</strong> · {t('production.suppliedToParent')} {count(layer.consumed_quantity)} {layer.unit}</p>
          <details className="production-disclosure"><summary>{t('production.poolUsage')}</summary>
            {layer.pool_usages.length ? layer.pool_usages.map(usage => <p key={usage.path}>{usage.name} · {usage.path}: {count(usage.quantity)} {layer.unit}</p>) : <p className="bom-hint">{t('production.poolUnused')}</p>}
          </details></>}
        {!!order.stage_workflow && <details className="production-disclosure">
          <summary>{t('production.viewCumulativeInputVariance')}</summary>
          {layer.path && <p className="bom-hint">{t('production.availableInOrder')} {count(layer.available_quantity)} {layer.unit} · {t('production.suppliedToParent')} {count(layer.consumed_quantity)} {layer.unit}</p>}
          {layer.items.map(item => <div className="stage-cumulative-input" key={item.path}>
            <strong>{item.name}</strong>
            <p>{t('production.cumulativeActual')} {count(item.actual_quantity)} {item.unit} {t('production.cumulativeStandard')} {item.standard_quantity == null ? '—' : count(item.standard_quantity)} {item.unit}</p>
            {item.standard_quantity != null && <p>{t('production.variance')} {count(addQuantity(item.actual_quantity, -item.standard_quantity))} {item.unit}</p>}
          </div>)}
        </details>}
        {routed && <details className="production-disclosure" open={search.trim() ? true : undefined}>
          <summary>{t('production.operationsAndRegistration', { count: rows.length })}</summary>
          <div className="production-inline-operations">{rows.map(target => <div className="production-inline-operation" key={target.id}>
            <div><strong>{target.name}</strong><small>{t('production.completed')} {count(target.node.completed_quantity)} {layer.unit}{target.node.available_quantity != null && ` · ${t('route.available')} ${count(target.node.available_quantity)} ${layer.unit}`}</small></div>
            {registerable && <Button disabled={busy || target.node.available_quantity === 0} onClick={() => onRegister(target.id)} aria-label={t('production.register4', { v0: target.name })}>{t('production.register')}</Button>}
          </div>)}</div>
          <Button disabled={busy} onClick={() => onOperations(layer.path)}>{t('production.operationHistory')}</Button>
        </details>}
      </article>;
    })}
  </section>;
}
