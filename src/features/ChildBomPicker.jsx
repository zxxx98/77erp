import { useState } from 'react';
import { useQuery, queryPath } from '../queries.js';
import { Button, QueryStatus } from '../components/common.jsx';

export function ChildBomPicker({ item, data, disabled, onChange }) {
  const [q, setQ] = useState(''), [offset, setOffset] = useState(0), [preview, setPreview] = useState(null);
  const list = useQuery(queryPath('/boms', { product_id: item.product_id, q, offset, limit: 10 }), data, 150);
  const selected = item.child_bom;
  return <div className="bom-child-picker">
    <p className="bom-hint">本单不领用、不入库此半成品，按指定下级配方备料。</p>
    {item.child_bom_id && <p>下级配方：{selected?.name || '已选配方'} #{item.child_bom_id}{selected && !selected.enabled && '（已停用）'}</p>}
    <details open={!item.child_bom_id}><summary>{item.child_bom_id ? '更换下级配方' : '选择下级配方（必填）'}</summary>
      <input type="search" aria-label={`${item.product.name}搜索下级配方`} maxLength={100} placeholder="搜索配方名称" value={q} disabled={disabled}
        onChange={e => { setQ(e.target.value); setOffset(0); }} />
      <QueryStatus query={list} />
      {list.result?.boms.map(bom => <div className="bom-search-product" key={bom.id}>
        <div><strong>{bom.name} #{bom.id}</strong><small>基准产量 {bom.base_quantity} {bom.base_unit} · 修订 {bom.version}{!bom.enabled && ' · 已停用'}</small></div>
        <Button type="button" disabled={disabled || !bom.enabled || !bom.product_active} aria-label={`选择下级配方 ${bom.name} #${bom.id}`}
          onClick={() => { onChange({ child_bom_id: bom.id, child_bom: bom }); setPreview(null); }}>选择</Button>
      </div>)}
      {list.result && !list.result.boms.length && <p className="bom-warning">没有对应配方，请先为此物料创建下级 BOM，或改为领用本物料。</p>}
      {(offset > 0 || list.result?.has_more) && <div className="bom-actions">
        <Button type="button" disabled={disabled || offset === 0} onClick={() => setOffset(n => n - 10)}>上一页下级配方</Button>
        <Button type="button" disabled={disabled || !list.result?.has_more} onClick={() => setOffset(n => n + 10)}>下一页下级配方</Button>
      </div>}
    </details>
    {item.child_bom_id && <ChildBomPreview id={item.child_bom_id} data={data} disabled={disabled} preview={preview} setPreview={setPreview} />}
  </div>;
}

function ChildBomPreview({ id, data, disabled, preview, setPreview }) {
  const query = useQuery(preview ? `/boms/${id}` : null, data);
  return <><Button type="button" disabled={disabled} aria-expanded={!!preview} onClick={() => setPreview(value => !value)}>{preview ? '收起' : '查看'}下级配方</Button>
    {preview && <div className="bom-child-preview"><QueryStatus query={query} />{query.result && <>
      <strong>{query.result.name} #{query.result.id}</strong>
      {query.result.items.map(row => <p key={row.product_id}>{row.product.name} · {row.quantity_fraction || row.quantity} {row.unit} · 损耗 {row.loss_rate}% · {row.usage_mode === 'explode' ? `展开配方 #${row.child_bom_id}` : '领用本物料'}</p>)}
    </>}</div>}
  </>;
}
