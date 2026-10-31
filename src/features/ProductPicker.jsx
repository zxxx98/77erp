import { useState } from 'react';
import { Camera } from 'lucide-react';
import { t as pt } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { productionMessage } from '../i18n/production-errors.js';
import { Input as AntInput } from '../ui/controls.jsx';
import { useBusiness } from '../business-api.js';
import { useQuery, queryPath } from '../queries.js';
import { lookupProductCode } from '../product-query.js';
import { CameraScanner } from '../LazyComponents.jsx';
import { Button, QueryStatus } from '../components/common.jsx';

export function ProductPicker({ data, material = false, scrap = false, onSelect, disabled }) {
  useLocale();
  const [q, setQ] = useState(''), [offset, setOffset] = useState(0), [camera, setCamera] = useState(false);
  const action = useBusiness();
  const query = useQuery(q.trim() ? queryPath('/products', { q: q.trim(), status: 'active', limit: 20, offset }) : null, data, 200);
  const label = scrap ? pt("production.scrap") : material ? pt("production.material") : pt("production.finishedProduct");
  const selectLabel = scrap ? pt("production.addScrap") : material ? pt("production.addMaterial") : pt("production.selectFinishedProduct");
  const choose = product => { onSelect(product); setQ(''); setOffset(0); };
  const scan = raw => {
    setCamera(false);
    action.run(async () => {
      const product = await lookupProductCode(raw, data);
      if (!product) throw new Error(pt("production.noMaterialFoundForThisCodeCreateIts"));
      if (!product.active) throw new Error(pt("production.thisMaterialIsDisabledSelectAnActiveMaterial"));
      choose(product);
    });
  };
  return <div className="bom-picker">
    <div className="bom-search-row">
      <AntInput type="search" aria-label={pt("production.search", { v0: label })} placeholder={pt("production.searchByNameCodeOrSpecification", { v0: label })} maxLength={100} value={q}
        disabled={disabled || action.busy} onChange={e => { setQ(e.target.value); setOffset(0); action.setError(''); }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (q.trim()) scan(q.trim()); } }} />
      <Button type="button" disabled={disabled || action.busy || !q.trim()} onClick={() => scan(q.trim())}>{pt("production.byBarcode")}{scrap ? pt("production.addScrap") : material ? pt("production.add") : pt("production.select")}</Button>
      <Button type="button" icon={Camera} disabled={disabled || action.busy} onClick={() => setCamera(true)} aria-label={pt("production.scan", { v0: selectLabel })}>{pt("production.scan2")}</Button>
    </div>
    {productionMessage(action.error) && <p className="form-error" role="alert">{productionMessage(action.error)}</p>}
    {q.trim() && <div className="bom-search-results">
      <QueryStatus query={query} />
      {query.result?.products.map(product => <div className="bom-search-product" key={product.id}>
        <div><strong>{product.name}</strong><small>{product.barcode} · {product.specification || pt("production.noSpecification")} · {product.unit}</small></div>
        <Button type="button" disabled={disabled} onClick={() => choose(product)} aria-label={`${selectLabel} ${product.name}`}>{material || scrap ? pt("production.add") : pt("production.select")}</Button>
      </div>)}
      {query.result && !query.result.products.length && <p className="bom-empty">{pt("production.noMatchingActiveMaterials")}</p>}
      {(offset > 0 || query.result?.has_more) && <div className="bom-actions">
        <Button type="button" disabled={!offset || query.loading} onClick={() => setOffset(n => n - 20)}>{pt("production.previousMaterials")}</Button>
        <Button type="button" disabled={!query.result?.has_more || query.loading} onClick={() => setOffset(n => n + 20)}>{pt("production.nextMaterials")}</Button>
      </div>}
    </div>}
    {camera && <CameraScanner title={pt("production.scan", { v0: selectLabel })} onResult={scan} onClose={() => setCamera(false)} onManual={() => setCamera(false)} />}
  </div>;
}

