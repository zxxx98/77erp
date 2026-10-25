import { t as pt } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Input as AntInput } from '../ui/controls.jsx';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useQuery, queryPath } from '../queries.js';
import { Button, QueryStatus } from '../components/common.jsx';

export function ChildBomPicker({ item, data, disabled, onChange }) {
  useLocale();
  const [q, setQ] = useState(''), [offset, setOffset] = useState(0), [preview, setPreview] = useState(null);
  const list = useQuery(queryPath('/boms', { product_id: item.product_id, q, offset, limit: 10 }), data, 150);
  const selected = item.child_bom;
  return <div className="bom-child-picker">
    <p className="bom-hint">{pt("production.thisSemiFinishedItemIsNeitherIssuedNor2")}</p>
    {item.child_bom_id && <p className="bom-child-selected">{pt("production.childRecipe2")}<strong>{selected?.name || pt("production.selectedRecipe")} #{item.child_bom_id}</strong>{selected && !selected.enabled && pt("production.disabled3")}</p>}
    <details className="bom-disclosure bom-child-choices" open={!item.child_bom_id}>
      <summary><span>{item.child_bom_id ? pt("production.changeChildRecipe") : pt("production.selectChildRecipeRequired")}</span><ChevronDown className="bom-disclosure-chevron" size={18} aria-hidden="true" /></summary>
      <div className="bom-child-options">
        <AntInput type="search" aria-label={pt("production.searchChildRecipes", { v0: item.product.name })} maxLength={100} placeholder={pt("production.searchRecipeName")} value={q} disabled={disabled}
          onChange={e => { setQ(e.target.value); setOffset(0); }} />
        <QueryStatus query={list} />
        {!!list.result?.boms.length && <div className="bom-child-results">{list.result.boms.map(bom => <div className="bom-search-product" key={bom.id}>
          <div><strong>{bom.name} #{bom.id}</strong><small>{pt("production.baseOutput")} {bom.base_quantity} {bom.base_unit} {pt("production.revision")} {bom.version}{!bom.enabled && pt("production.disabled")}</small></div>
          <Button type="button" disabled={disabled || !bom.enabled || !bom.product_active} aria-label={pt("production.selectChildRecipe", { v0: bom.name, v1: bom.id })}
            onClick={() => { onChange({ child_bom_id: bom.id, child_bom: bom }); setPreview(null); }}>{pt("production.select")}</Button>
        </div>)}</div>}
        {list.result && !list.result.boms.length && <p className="bom-warning">{pt("production.noRecipesAvailableCreateAChildBomFor")}</p>}
        {(offset > 0 || list.result?.has_more) && <div className="bom-actions">
          <Button type="button" disabled={disabled || offset === 0} onClick={() => setOffset(n => n - 10)}>{pt("production.previousChildRecipes")}</Button>
          <Button type="button" disabled={disabled || !list.result?.has_more} onClick={() => setOffset(n => n + 10)}>{pt("production.nextChildRecipes")}</Button>
        </div>}
      </div>
    </details>
    {item.child_bom_id && <ChildBomPreview id={item.child_bom_id} data={data} disabled={disabled} preview={preview} setPreview={setPreview} />}
  </div>;
}

function ChildBomPreview({ id, data, disabled, preview, setPreview }) {
  useLocale();
  const query = useQuery(preview ? `/boms/${id}` : null, data);
  return <><Button type="button" className="bom-child-preview-toggle" disabled={disabled} aria-expanded={!!preview} onClick={() => setPreview(value => !value)}>{preview ? pt("production.collapse") : pt("production.view")}{pt("production.childRecipe")}<ChevronDown className="bom-disclosure-chevron" size={16} aria-hidden="true" /></Button>
    {preview && <div className="bom-child-preview"><QueryStatus query={query} />{query.result && <>
      <strong>{query.result.name} #{query.result.id}</strong>
      {query.result.items.map(row => <p key={row.product_id}>{row.product.name} · {row.quantity_fraction || row.quantity} {row.unit} {pt("production.loss")} {row.loss_rate}% · {row.usage_mode === 'explode' ? pt("production.expandRecipe", { v0: row.child_bom_id }) : pt("production.issueThisMaterial")}</p>)}
    </>}</div>}
  </>;
}
