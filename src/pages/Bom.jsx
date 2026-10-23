import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Calculator, Camera, Copy, Download, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useBusiness } from '../business-api.js';
import { useQuery, queryPath } from '../queries.js';
import { lookupProductCode } from '../product-query.js';
import { CameraScanner } from '../LazyComponents.jsx';
import { PageHeading, Button, Badge, QueryStatus } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { downloadFile } from '../app/download.js';
import { bomCSV } from '../bom-csv.js';
import { addQuantity, parseQuantity } from '../../shared/quantity.js';
import { BOM_MAX_ITEMS, parseBomQuantity, validateBom } from '../../shared/bom.js';
import './bom.css';

const count = value => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 6 });
const editable = bom => ({ ...bom, items: bom.items.map(item => ({ ...item, quantity: item.quantity_fraction || item.quantity })) });
const newBom = product => ({ name: product ? `${product.name}用料清单`.slice(0, 100) : '', product: product || null,
  product_id: product?.id || null, base_quantity: 1, base_unit: product?.unit || '', note: '', enabled: 1, items: [] });

function incrementUsage(value) {
  const parsed = parseBomQuantity(value);
  if (!parsed.quantity_fraction) return parseQuantity(addQuantity(parsed.quantity, 1), true);
  const [numerator, denominator] = parsed.quantity_fraction.split('/').map(Number);
  const next = `${numerator + denominator}/${denominator}`;
  parseBomQuantity(next);
  return next;
}

function UsagePreview({ value, unit }) {
  try {
    const parsed = parseBomQuantity(value);
    return parsed.quantity_fraction && <small className="bom-hint">折合约 {count(parsed.quantity)} {unit}，按原分数测算。</small>;
  } catch { return null; }
}

function ProductPicker({ data, material = false, onSelect, disabled }) {
  const [q, setQ] = useState(''), [offset, setOffset] = useState(0), [camera, setCamera] = useState(false);
  const action = useBusiness();
  const query = useQuery(q.trim() ? queryPath('/products', { q: q.trim(), status: 'active', limit: 20, offset }) : null, data, 200);
  const label = material ? '材料' : '成品';
  const choose = product => { onSelect(product); setQ(''); setOffset(0); };
  const scan = raw => {
    setCamera(false);
    action.run(async () => {
      const product = await lookupProductCode(raw, data);
      if (!product) throw new Error('未找到该编码的物料，请先建立物料档案。');
      if (!product.active) throw new Error('该物料已停用，请选择已启用物料。');
      choose(product);
    });
  };
  return <div className="bom-picker">
    <div className="bom-search-row">
      <input type="search" aria-label={`搜索${label}`} placeholder={`搜索${label}名称、编码或规格`} maxLength={100} value={q}
        disabled={disabled || action.busy} onChange={e => { setQ(e.target.value); setOffset(0); action.setError(''); }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (q.trim()) scan(q.trim()); } }} />
      <Button type="button" disabled={disabled || action.busy || !q.trim()} onClick={() => scan(q.trim())}>按条码{material ? '添加' : '选择'}</Button>
      <Button type="button" icon={Camera} disabled={disabled || action.busy} onClick={() => setCamera(true)} aria-label={`扫码${material ? '添加材料' : '选择成品'}`}>扫码</Button>
    </div>
    {action.error && <p className="form-error" role="alert">{action.error}</p>}
    {q.trim() && <div className="bom-search-results">
      <QueryStatus query={query} />
      {query.result?.products.map(product => <div className="bom-search-product" key={product.id}>
        <div><strong>{product.name}</strong><small>{product.barcode} · {product.specification || '无规格'} · {product.unit}</small></div>
        <Button type="button" disabled={disabled} onClick={() => choose(product)} aria-label={`${material ? '添加材料' : '选择成品'} ${product.name}`}>{material ? '添加' : '选择'}</Button>
      </div>)}
      {query.result && !query.result.products.length && <p className="bom-empty">没有匹配的已启用物料。</p>}
      {(offset > 0 || query.result?.has_more) && <div className="bom-actions">
        <Button type="button" disabled={!offset || query.loading} onClick={() => setOffset(n => n - 20)}>上一页物料</Button>
        <Button type="button" disabled={!query.result?.has_more || query.loading} onClick={() => setOffset(n => n + 20)}>下一页物料</Button>
      </div>}
    </div>}
    {camera && <CameraScanner title={`扫码${material ? '添加材料' : '选择成品'}`} onResult={scan} onClose={() => setCamera(false)} onManual={() => setCamera(false)} />}
  </div>;
}

function BomCalculation({ bom, data, onBack, onCreateProduction }) {
  const [quantity, setQuantity] = useState(String(bom.base_quantity)), [snapshot, setSnapshot] = useState(null);
  const action = useBusiness();
  return <>
    <PageHeading title="备料测算" description={`${bom.name} · ${bom.product.name} · ${bom.product.barcode}`}>
      <Button icon={ArrowLeft} disabled={action.busy} onClick={onBack}>返回用料清单</Button>
    </PageHeading>
    <section className="panel bom-section">
      <div className="bom-calculate-form"><label>生产数量（{bom.product.unit}）<input aria-label="生产数量" inputMode="decimal" value={quantity} disabled={action.busy}
        onChange={e => { setQuantity(e.target.value); setSnapshot(null); action.setError(''); }} /></label>
        <Button kind="primary" icon={Calculator} busy={action.busy} onClick={() => action.run(async () => {
          const production_quantity = parseQuantity(quantity, true);
          const result = await api(`/boms/${bom.id}/calculate`, { method: 'POST', warehouseId: data.warehouse_id,
            body: { production_quantity, version: bom.version } });
          setSnapshot(result);
        })}>{snapshot ? '重新测算' : '开始测算'}</Button>
      </div>
      <p className="bom-hint">基准产量 {count(bom.base_quantity)} {bom.base_unit}。按单层清单计算材料需求，超过 6 位小数的部分向上进位。</p>
      {action.error && <p className="form-error" role="alert">{action.error}</p>}
    </section>
    {snapshot && <section className="panel bom-section">
      <div className="bom-section-heading"><div><h2>备料结果</h2><p className="bom-hint">{snapshot.warehouse.name} · 库存读取于 {new Date(snapshot.captured_at).toLocaleString('zh-CN', { hour12: false })}</p></div>
        <Button icon={Download} onClick={() => downloadFile(bomCSV(snapshot), `备料表-${snapshot.product.barcode}-${snapshot.captured_at.slice(0, 10)}.csv`, 'text/csv;charset=utf-8')}>导出备料表</Button>
      </div>
      <p className="bom-result-summary" role="status">共 {snapshot.rows.length} 种材料，{snapshot.rows.filter(row => row.shortage > 0).length} 种缺料。</p>
      {onCreateProduction && <Button onClick={() => onCreateProduction({ ...bom, planned_quantity: snapshot.production_quantity })}>按本次数量新建生产单</Button>}
      <div className="bom-result-table"><table><thead><tr><th>材料</th><th>基准用量</th><th>本次需求</th><th>账面库存</th><th>缺料数量</th><th>备注</th></tr></thead>
        <tbody>{snapshot.rows.map(row => <tr key={row.product_id}>
          <td><strong>{row.name}</strong><small>{row.barcode}{row.specification && ` · ${row.specification}`}</small></td>
          <td data-label="基准用量">{row.quantity_fraction || count(row.quantity)} {row.unit}</td><td data-label="本次需求">{count(row.required)} {row.unit}</td><td data-label="账面库存">{count(row.stock)} {row.unit}</td>
          <td data-label="缺料数量" className={row.shortage > 0 ? 'bom-shortage' : ''}>{count(row.shortage)} {row.unit}</td><td data-label="备注">{row.note || '—'}</td>
        </tr>)}</tbody></table></div>
      <p className="bom-hint">结果与导出保留本次读取的账面库存，未预留或扣减库存。库存变化后请重新测算。</p>
    </section>}
  </>;
}

export function Bom({ data, initialProduct, onCreateProduction }) {
  const [q, setQ] = useState(''), [status, setStatus] = useState('all'), [offset, setOffset] = useState(0);
  const [filterProduct, setFilterProduct] = useState(initialProduct || null), [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState(null), [baseline, setBaseline] = useState(''), [calculation, setCalculation] = useState(null);
  const [message, setMessage] = useState('');
  const action = useBusiness();
  const queryData = useMemo(() => ({ ...data, bomRevision: revision }), [data, revision]);
  const list = useQuery(queryPath('/boms', { q, status, offset, product_id: filterProduct?.id }), queryData, 150);
  const dirty = !!editor && (JSON.stringify(editor) !== baseline || !editor.id && (!!editor.name.trim() || editor.items.length > 0));
  const state = useRef({ dirty, busy: action.busy }); state.current = { dirty, busy: action.busy };
  useEffect(() => {
    const before = event => {
      if (state.current.busy || state.current.dirty && !window.confirm('用料清单尚未保存，确定离开？')) event.preventDefault();
    };
    const unload = event => { if (state.current.dirty || state.current.busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('erp:before-navigate', before); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('erp:before-navigate', before); window.removeEventListener('beforeunload', unload); };
  }, []);
  const apply = bom => { const value = editable(bom); setEditor(value); setBaseline(JSON.stringify(value)); setCalculation(null); action.setError(''); setMessage(''); };
  const back = () => { if (action.busy || dirty && !window.confirm('用料清单尚未保存，确定离开？')) return; setEditor(null); setCalculation(null); action.setError(''); };
  const open = (id, kind) => action.run(async () => {
    const bom = await api(`/boms/${id}`, { warehouseId: data.warehouse_id });
    if (kind === 'calculate') { setCalculation(bom); action.setError(''); setMessage(''); }
    else if (kind === 'copy') apply({ ...newBom(null), name: `${bom.name}副本`.slice(0, 100), base_quantity: bom.base_quantity, note: bom.note, items: editable(bom).items });
    else apply(bom);
  });
  const update = change => { setEditor(previous => ({ ...previous, ...change })); action.setError(''); };
  const save = event => {
    event.preventDefault();
    action.run(async () => {
      const body = { name: editor.name, product_id: editor.product_id, base_quantity: parseQuantity(editor.base_quantity, true),
        base_unit: editor.product?.unit || '', note: editor.note, enabled: editor.enabled,
        items: editor.items.map(item => ({ product_id: item.product_id, ...parseBomQuantity(item.quantity), unit: item.product.unit, note: item.note })),
        ...(editor.id ? { version: editor.version } : {}) };
      validateBom(body);
      await action.send(editor.id ? `/boms/${editor.id}` : '/boms', body, { warehouseId: data.warehouse_id });
      setEditor(null); setRevision(n => n + 1); setMessage('用料清单已保存。');
    });
  };
  if (calculation) return <div className="bom-page"><BomCalculation key={`${calculation.id}:${calculation.version}`} bom={calculation} data={data} onBack={back} onCreateProduction={onCreateProduction} /></div>;
  if (editor) return <div className="bom-page">
    <PageHeading title={editor.id ? '编辑用料清单' : '新建用料清单'} description="配置基准产量和材料用量，保存后可按生产数量测算备料。">
      <Button icon={ArrowLeft} disabled={action.busy} onClick={back}>返回用料清单</Button>
    </PageHeading>
    <form onSubmit={save}>
      <section className="panel bom-section"><h2>成品与配方</h2>
        <div className="bom-form-grid"><label>清单名称<input maxLength={100} required value={editor.name} disabled={action.busy} onChange={e => update({ name: e.target.value })} /></label>
          <label>基准产量{editor.product && `（${editor.product.unit}）`}<input aria-label="基准产量" inputMode="decimal" required value={editor.base_quantity} disabled={action.busy} onChange={e => update({ base_quantity: e.target.value })} /></label></div>
        {editor.product && <div className="bom-selected-product"><div><strong>成品：{editor.product.name}</strong><small>{editor.product.barcode} · {editor.product.unit}</small></div></div>}
        {editor.id && editor.base_unit !== editor.product?.unit && <p className="bom-warning">成品单位已从 {editor.base_unit} 改为 {editor.product.unit}，请核对基准产量后保存。</p>}
        {!editor.product && <p className="bom-hint">请选择成品。复制配方时请选择另一成品，每个成品保留一份用料清单。</p>}
        <ProductPicker data={data} disabled={action.busy} onSelect={product => {
          if (editor.items.some(item => item.product_id === product.id)) { action.setError('成品不能作为自身的材料，请先移除对应材料。'); return; }
          update({ product, product_id: product.id, name: editor.name || `${product.name}用料清单`.slice(0, 100) });
        }} />
        <label className="bom-note">备注<textarea rows={2} maxLength={500} value={editor.note} disabled={action.busy} onChange={e => update({ note: e.target.value })} /></label>
        <label className="bom-checkbox"><input type="checkbox" checked={!!editor.enabled} disabled={action.busy} onChange={e => update({ enabled: e.target.checked ? 1 : 0 })} />启用此清单</label>
      </section>
      <section className="panel bom-section"><div className="bom-section-heading"><h2>材料用量</h2><span className="bom-hint">已添加 {editor.items.length} / {BOM_MAX_ITEMS} 种</span></div>
        <p className="bom-hint">填写生产 {editor.base_quantity || '…'} {editor.product?.unit || '单位成品'} 所需的材料量。半成品按一项材料计算。</p>
        <p className="bom-hint" id="bom-usage-help">用量支持小数或分数，如 1/40 表示每 40 件成品分摊 1 份材料（基准产量为 1 时）。分数按原比例测算，不自动按整箱取整；实际耗料在生产完工时核对。</p>
        <ProductPicker data={data} material disabled={action.busy} onSelect={product => {
          if (product.id === editor.product_id) { action.setError('成品不能作为自身的材料。'); return; }
          const found = editor.items.find(item => item.product_id === product.id);
          if (!found && editor.items.length >= BOM_MAX_ITEMS) { action.setError(`最多添加 ${BOM_MAX_ITEMS} 种材料。`); return; }
          try { update({ items: found ? editor.items.map(item => item.product_id === product.id ? { ...item, product, quantity: incrementUsage(item.quantity) } : item)
            : [...editor.items, { product_id: product.id, product, quantity: 1, unit: product.unit, note: '' }] }); }
          catch (error) { action.setError(error.message); }
        }} />
        {!editor.items.length && <p className="bom-empty">搜索或扫码添加材料。</p>}
        <div className="bom-materials">{editor.items.map(item => <div className="bom-material" key={item.product_id}>
          <div className="bom-material-name"><strong>{item.product.name}</strong><small>{item.product.barcode} · {item.product.specification || '无规格'}{!item.product.active && ' · 已停用'}</small>
            {item.unit !== item.product.unit && <span className="bom-warning">单位已从 {item.unit} 改为 {item.product.unit}，请核对用量。</span>}</div>
          <label>用量（{item.product.unit}）<input aria-label={`${item.product.name}用量`} aria-describedby="bom-usage-help" inputMode="text" placeholder="如 0.025 或 1/40" maxLength={60} spellCheck={false} required value={item.quantity} disabled={action.busy}
            onChange={e => update({ items: editor.items.map(row => row.product_id === item.product_id ? { ...row, quantity: e.target.value } : row) })} />
            <UsagePreview value={item.quantity} unit={item.product.unit} /></label>
          <label>材料备注<input aria-label={`${item.product.name}备注`} maxLength={200} value={item.note} disabled={action.busy}
            onChange={e => update({ items: editor.items.map(row => row.product_id === item.product_id ? { ...row, note: e.target.value } : row) })} /></label>
          <Button type="button" icon={Trash2} disabled={action.busy} aria-label={`移除材料 ${item.product.name}`} onClick={() => update({ items: editor.items.filter(row => row.product_id !== item.product_id) })}>移除</Button>
        </div>)}</div>
      </section>
      {action.error && <p className="form-error bom-error" role="alert">{action.error}</p>}
      <div className="bom-editor-actions"><Button type="button" disabled={action.busy} onClick={back}>取消</Button>
        {editor.id && <Button type="button" disabled={action.busy} onClick={() => { if (!dirty || window.confirm('重新读取会丢弃当前未保存内容，确定继续？')) open(editor.id, 'edit'); }}>重新读取已保存清单</Button>}
        <Button type="submit" icon={Save} kind="primary" busy={action.busy} disabled={!editor.product || !editor.items.length}>保存用料清单</Button></div>
    </form>
  </div>;
  return <div className="bom-page">
    <PageHeading title="用料清单" description="维护成品的材料组合，按生产数量测算需求和缺料。">
      <Button kind="primary" icon={Plus} disabled={action.busy} onClick={() => apply(newBom(filterProduct))}>新建用料清单</Button>
    </PageHeading>
    {message && <p className="bom-success" role="status">{message}</p>}{action.error && <p className="form-error" role="alert">{action.error}</p>}
    {filterProduct && <div className="bom-filter-product"><span>成品：{filterProduct.name} · {filterProduct.barcode}</span><Button onClick={() => { setFilterProduct(null); setOffset(0); }}>显示全部清单</Button></div>}
    <section className="panel bom-section">
      <div className="bom-list-filters"><input type="search" aria-label="搜索用料清单" placeholder="搜索清单、成品名称或编码" maxLength={100} value={q} onChange={e => { setQ(e.target.value); setOffset(0); }} />
        <Select aria-label="清单状态" value={status} onChange={e => { setStatus(e.target.value); setOffset(0); }}>
          <option value="all">全部状态</option><option value="enabled">已启用</option><option value="disabled">已停用</option>
        </Select></div>
      <QueryStatus query={list} />
      <div className="bom-list">{list.result?.boms.map(bom => <article className="bom-list-item" key={bom.id}>
        <div className="bom-list-info"><strong>{bom.name}</strong><p>{bom.product_name} · {bom.barcode}</p>
          <small>基准产量 {count(bom.base_quantity)} {bom.base_unit} · {bom.item_count} 种材料 · 更新人 {bom.updated_by_name}</small>
          <div><Badge tone={bom.enabled ? 'green' : 'orange'}>{bom.enabled ? '已启用' : '已停用'}</Badge>{!bom.product_active && <Badge tone="orange">成品已停用</Badge>}</div></div>
        <div className="bom-actions"><Button icon={Calculator} disabled={action.busy || !bom.enabled} onClick={() => open(bom.id, 'calculate')}>测算备料</Button>
          {onCreateProduction && <Button disabled={action.busy || !bom.enabled || !bom.product_active} onClick={() => onCreateProduction(bom)}>新建生产单</Button>}
          <Button disabled={action.busy} onClick={() => open(bom.id, 'edit')}>编辑</Button>
          <Button icon={Copy} disabled={action.busy} onClick={() => open(bom.id, 'copy')}>复制</Button>
          <Button disabled={action.busy} onClick={() => action.run(async () => {
            await action.send(`/boms/${bom.id}/status`, { version: bom.version, enabled: bom.enabled ? 0 : 1 }, { warehouseId: data.warehouse_id });
            setRevision(n => n + 1); setMessage(bom.enabled ? '用料清单已停用。' : '用料清单已启用。');
          })}>{bom.enabled ? '停用' : '启用'}</Button></div>
      </article>)}</div>
      {list.result && !list.result.boms.length && <p className="bom-empty">暂无匹配的用料清单，可以新建一份成品配方。</p>}
      {list.result && (offset > 0 || list.result.has_more) && <div className="bom-actions bom-pagination"><Button disabled={!offset} onClick={() => setOffset(n => n - 30)}>上一页</Button>
        <span>共 {list.result.total} 张</span><Button disabled={!list.result.has_more} onClick={() => setOffset(n => n + 30)}>下一页</Button></div>}
    </section>
  </div>;
}
