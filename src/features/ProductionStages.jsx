import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Input } from '../ui/controls.jsx';
import { Button, Badge, PageHeading, QueryStatus } from '../components/common.jsx';
import { useBusiness } from '../business-api.js';
import { useQuery } from '../queries.js';
import { api } from '../api.js';
import { parseQuantity, materialQuantity, addQuantity } from '../../shared/quantity.js';
import { stageDisplayStandardQuantity, stageStandardQuantity } from '../../shared/production-stages.js';
import { scrapExpectedQuantity, validateScrapActuals } from '../../shared/scrap.js';
import { ScrapOutputs } from './ScrapOutputs.jsx';
import './production-stages.css';

const count = value => Number(value ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 6 });
const time = value => new Date(value).toLocaleString('zh-CN', { hour12: false });

export function ProductionStageSummary({ order, onOpen, disabled }) {
  const children = order.stages.filter(stage => stage.path !== '');
  const started = children.filter(stage => stage.completed_quantity > 0).length;
  const remaining = children.filter(stage => stage.available_quantity > 0);
  return <section className="panel bom-section" aria-label="分层生产进度">
    <div className="bom-section-heading"><h2>分层生产</h2><span>{started} / {children.length} 个半成品层已登记</span></div>
    <p className="bom-hint">先登记下层半成品，再供上层使用。半成品留在本单内，原材料只记录一次耗用。</p>
    {remaining.length > 0 && <p className="bom-hint">{remaining.length} 个半成品层仍有可用数量，使用完后才能结束生产。</p>}
    <Button disabled={disabled} onClick={onOpen}>查看各层进度与批次</Button>
  </section>;
}

export function ProductionStages({ order, data, canRegister, canVoid, canReceive, management, busy = false, onActivity, onSaved, onBack }) {
  const [scope, setScope] = useState(''), [search, setSearch] = useState('');
  const [form, setForm] = useState(null), [baseline, setBaseline] = useState('');
  const [history, setHistory] = useState(null), [voiding, setVoiding] = useState(null);
  const action = useBusiness(), locked = busy || action.busy;
  const byPath = useMemo(() => new Map(order.stages.map(stage => [stage.path, stage])), [order.stages]);
  const stage = form ? byPath.get(form.path) : null;
  const pathLabel = value => {
    const parts = [], seen = new Set();
    for (let current = value; current && !seen.has(current.path); current = current.path ? byPath.get(current.parent_path) : null) {
      seen.add(current.path); parts.unshift(current.name);
    }
    return parts.join(' / ');
  };
  const dirty = (!!form && JSON.stringify(form) !== baseline) || !!voiding?.reason;
  useEffect(() => { onActivity?.({ form, history, voiding, busy: locked }); }, [form, history, voiding, locked, onActivity]);
  useEffect(() => () => onActivity?.(null), [onActivity]);
  const guard = useRef({}); guard.current = { dirty, locked };
  useEffect(() => {
    const navigate = event => { if (guard.current.locked || guard.current.dirty && !window.confirm('分层登记尚未保存，确定离开？')) event.preventDefault(); };
    const unload = event => { if (guard.current.dirty || guard.current.locked) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('erp:before-navigate', navigate); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('erp:before-navigate', navigate); window.removeEventListener('beforeunload', unload); };
  }, []);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [form?.path, history?.path, scope]);
  const leave = fn => { if (!locked && (!dirty || window.confirm('分层登记尚未保存，确定离开？'))) { action.setError(''); fn(); } };
  const back = () => leave(() => {
    if (form) setForm(null);
    else if (history) { setHistory(null); setVoiding(null); }
    else onBack();
  });
  const defaults = (target, quantity) => target.items.map(item => ({ path: item.path, quantity: String(stageStandardQuantity(item, quantity)), variance_reason: '' }));
  const begin = target => action.run(async () => {
    const quantity = materialQuantity(Math.max(0, target.planned_quantity - target.completed_quantity) || 1, target);
    const next = { path: target.path, completed_quantity: String(quantity), items: defaults(target, quantity), note: '',
      scraps: target.path ? [] : order.scraps.map(row => ({ product_id: row.product_id, quantity: '0', disposition: 'stock' })) };
    setForm(next); setBaseline(JSON.stringify(next)); setHistory(null);
  });
  const patch = update => { setForm(previous => ({ ...previous, ...update })); action.setError(''); };
  const historyQuery = useQuery(history ? `/production-orders/${order.id}/stages/batches?${new URLSearchParams({ path: history.path, offset: String(history.offset), limit: '20' })}` : null, data);
  const send = (path, body) => action.send(`/production-orders/${order.id}${path}`, { schema_version: 2, stage_schema_version: 1, version: order.version, ...body }, { warehouseId: data.warehouse_id });
  const submit = event => {
    event.preventDefault();
    const finish = management && stage.path === '' && event.nativeEvent.submitter?.value === 'finish';
    action.run(async () => {
      const quantity = materialQuantity(parseQuantity(form.completed_quantity, true), stage);
      const items = form.items.map(row => {
        const item = stage.items.find(item => item.path === row.path);
        const actual = materialQuantity(parseQuantity(row.quantity, item.usage_mode === 'explode'), item);
        if (actual > item.available_quantity) throw new Error(`${item.name}可用数量不足，请先${item.usage_mode === 'explode' ? '登记下层半成品' : '补料'}。`);
        return { ...row, quantity: actual };
      });
      if (!items.some(item => item.quantity > 0)) throw new Error('至少一种材料的实际投入需大于零。');
      const scraps = form.scraps.map(row => ({ ...row, quantity: materialQuantity(parseQuantity(row.quantity), order.scraps.find(item => item.product_id === row.product_id)) }));
      if (stage.path === '') validateScrapActuals(scraps, order.scraps);
      if (!window.confirm(`确认登记 ${stage.name} ${count(quantity)} ${stage.unit}？${stage.path ? '本批半成品留在本单，供上层使用。' : '本批成品待仓库批准后入库。'}${finish ? '同时结束生产单。' : ''}`)) return;
      const result = await send('/stages/complete', { path: stage.path, completed_quantity: quantity, items, scraps, note: form.note, finish_order: finish });
      setForm(null); setBaseline('');
      await onSaved(result, stage.path ? '本批半成品已登记，可供上层使用，仓库库存未变动。' : `本批成品已登记，待仓库批准入库。${finish ? '生产已结束。' : ''}`);
    });
  };
  let standardError = '';
  const standards = new Map();
  if (stage) {
    try { for (const item of stage.items) standards.set(item.path, stageDisplayStandardQuantity(item, parseQuantity(form.completed_quantity, true))); }
    catch (error) { standardError = error.message; }
  }
  const scrapRows = stage?.path === '' ? order.scraps.map(row => {
    let expected_quantity = null;
    try { expected_quantity = scrapExpectedQuantity(row, parseQuantity(form.completed_quantity, true), order.base_quantity,
      form.items.map(input => ({ product_id: stage.items.find(item => item.path === input.path).product_id, quantity: parseQuantity(input.quantity) })), order.quantity_decimals); } catch { /* Keep invalid input visible until corrected. */ }
    const actual = form.scraps.find(item => item.product_id === row.product_id);
    return { ...row, expected_quantity, actual: actual.quantity, disposition: actual.disposition };
  }) : [];
  const heading = stage ? `登记${stage.path ? '半成品' : '成品'}` : history ? '层级批次记录' : '选择生产层';
  const notices = <>{action.error && <p className="form-error" role="alert">{action.error}</p>}</>;
  const visible = order.stages.filter(item => search.trim()
    ? `${item.name} ${item.path}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    : item.path === scope || item.path !== '' && item.parent_path === scope);
  const requiresReceiptPermission = batch => {
    const root = batch.root_batch_id && order.batches.find(row => row.id === batch.root_batch_id);
    return root && (root.receipt_status === 'confirmed' || !root.receipt_required);
  };
  return <div className="production-stages">
    <PageHeading title={heading} description={`${order.number} · ${stage ? pathLabel(stage) : history ? pathLabel(byPath.get(history.path)) : order.product_name}`}>
      <Button icon={ArrowLeft} disabled={locked} onClick={back}>{form || history ? '返回层级选择' : '返回单据详情'}</Button>
    </PageHeading>
    {form && stage ? <form onSubmit={submit}>
      <section className="panel bom-section">
        <h2>{stage.name}</h2><p className="stage-path">{pathLabel(stage)}</p>
        <p className="bom-hint">计划 {count(stage.planned_quantity)} {stage.unit}，累计合格 {count(stage.completed_quantity)} {stage.unit}。填写本批数量。</p>
        <label className="production-output">本批合格数量（{stage.unit}）<Input aria-label="本批合格数量" inputMode="decimal" value={form.completed_quantity} disabled={locked} onChange={event => patch({ completed_quantity: event.target.value })} /></label>
        {Number(form.completed_quantity) + stage.completed_quantity > stage.planned_quantity && <p className="bom-warning">本次登记后将超过计划产量，请按实际产出核对。</p>}
        <Button disabled={locked} onClick={() => action.run(async () => patch({ items: defaults(stage, parseQuantity(form.completed_quantity, true)).map(item => ({ ...item, variance_reason: form.items.find(row => row.path === item.path).variance_reason })) }))}>按本批产量带出耗料</Button>
      </section>
      <section className="panel bom-section"><h2>核对本层投入</h2><p className="bom-hint">原材料消耗已领余额；半成品消耗对应下层的可用数量，不重复扣下层原料。</p>
        {standardError && <p className="bom-warning">{standardError}</p>}
        {stage.items.map(item => {
          const actual = form.items.find(row => row.path === item.path), standard = standards.get(item.path);
          return <article className="stage-input" key={item.path}>
            <div><strong>{item.name}</strong><p className="bom-hint">{item.usage_mode === 'explode' ? '本单半成品' : '已领原材料'} · {item.usage_mode === 'explode' ? pathLabel(byPath.get(item.path)) : item.path}</p></div>
            <div className="stage-input-numbers"><span>标准投入 <strong>{standard === undefined ? '—' : count(standard)} {item.unit}</strong></span><span>可用 <strong>{count(item.available_quantity)} {item.unit}</strong></span></div>
            <label>实际投入（{item.unit}）<Input aria-label={`${item.name}实际投入`} inputMode="decimal" disabled={locked} value={actual.quantity} onChange={event => patch({ items: form.items.map(row => row.path === item.path ? { ...row, quantity: event.target.value } : row) })} /></label>
            {Number(actual.quantity) > item.available_quantity && <p className="bom-warning">可用数量不足，请先{item.usage_mode === 'explode' ? '登记下层半成品' : '补料'}。</p>}
            <label>耗料差异原因<Input aria-label={`${item.name}耗料差异原因`} maxLength={500} value={actual.variance_reason} disabled={locked} onChange={event => patch({ items: form.items.map(row => row.path === item.path ? { ...row, variance_reason: event.target.value } : row) })} /></label>
          </article>;
        })}
      </section>
      {scrapRows.length > 0 && <section className="panel bom-section"><ScrapOutputs rows={scrapRows} materials={stage.items} complete disabled={locked}
        onChange={(id, changes) => patch({ scraps: form.scraps.map(row => row.product_id === id ? { ...row, ...changes } : row) })} /></section>}
      <section className="panel bom-section"><label>本批备注<Input.TextArea aria-label="本批备注" maxLength={500} rows={2} value={form.note} disabled={locked} onChange={event => patch({ note: event.target.value })} /></label></section>
      {notices}<div className="bom-editor-actions"><Button disabled={locked} onClick={back}>取消</Button>
        <Button disabled={locked} onClick={() => leave(() => action.run(async () => onSaved(await api(`/production-orders/${order.id}`, { warehouseId: data.warehouse_id }), '已重新读取生产单，请选择层级后核对。')))}>重新读取生产单</Button>
        <Button type="submit" kind="primary" value="continue" busy={locked}>{stage.path ? '登记本批半成品' : '本批登记并继续生产'}</Button>
        {stage.path === '' && management && <Button type="submit" value="finish" disabled={locked}>本批登记并结束生产</Button>}
      </div>
    </form> : history ? <section className="panel bom-section">
      <h2>{byPath.get(history.path)?.name}</h2><QueryStatus query={historyQuery} />
      {historyQuery.result?.batches.length === 0 && <p className="bom-hint">本层尚无登记批次。</p>}
      {historyQuery.result?.batches.map(batch => <article className="production-batch" key={batch.id}>
        <div className="bom-section-heading"><strong>第 {batch.batch_number} 批 · {count(batch.completed_quantity)} {byPath.get(history.path)?.unit}</strong><Badge tone={batch.status === 'active' ? 'green' : 'gray'}>{batch.status === 'active' ? '有效' : '已作废'}</Badge></div>
        <p className="bom-hint">{batch.created_by_name} · {time(batch.created_at)}</p>
        {batch.note && <p className="production-note">{batch.note}</p>}
        <details><summary>查看本批投入</summary>{batch.items?.map(item => {
          const source = byPath.get(history.path)?.items.find(input => input.path === item.path);
          let standard = null;
          try { if (source) standard = stageDisplayStandardQuantity(source, batch.completed_quantity); } catch { /* Show actual records if standards exceed limits. */ }
          return <div className="production-batch-material" key={item.path ?? item.id}><strong>{item.name}</strong>
            <p>实际投入 {count(item.quantity ?? item.actual_quantity)} {item.unit}{standard !== null && ` · 标准 ${count(standard)} ${item.unit}`}</p>
            {item.variance_reason && <p>差异原因：{item.variance_reason}</p>}
            {item.allocations?.map(allocation => <p className="bom-hint" key={allocation.id}>来源层 {allocation.source_path} · 第 {allocation.source_batch_number} 批 · {count(allocation.quantity)} {item.unit}</p>)}
          </div>;
        })}</details>
        {batch.status === 'void' && <p className="bom-hint">作废原因：{batch.void_reason}</p>}
        {canVoid && batch.status === 'active' && order.status !== 'void' && (requiresReceiptPermission(batch) && !canReceive
          ? <p className="bom-hint">本批成品已入库，作废还需要仓库入库权限。</p>
          : <div className="bom-actions"><Button disabled={locked} onClick={() => leave(() => setVoiding({ id: batch.id, reason: '' }))}>作废第 {batch.batch_number} 批</Button></div>)}
        {voiding?.id === batch.id && <form onSubmit={event => { event.preventDefault(); action.run(async () => {
          if (!voiding.reason.trim()) throw new Error('请填写作废原因。');
          const consequence = batch.path === ''
            ? requiresReceiptPermission(batch) ? '已入库的成品和废料将按原数量、原成本回退。' : '本批待批准的入库单也会作废。'
            : '已被上层使用的半成品须先撤销上层批次。';
          if (!window.confirm(`确认作废此批次并恢复原投入？${consequence}`)) return;
          const result = await send(`/stages/batches/${batch.id}/void`, { reason: voiding.reason });
          setVoiding(null); await onSaved(result, '本批已作废，原投入数量和成本已恢复。');
        }); }}><label>作废原因<Input.TextArea aria-label="层级批次作废原因" rows={2} maxLength={500} disabled={locked} value={voiding.reason} onChange={event => setVoiding({ ...voiding, reason: event.target.value })} /></label>
          <div className="bom-actions"><Button disabled={locked} onClick={() => leave(() => setVoiding(null))}>取消作废</Button><Button type="submit" kind="danger" busy={locked}>确认作废批次</Button></div></form>}
      </article>)}
      <div className="bom-actions"><Button disabled={locked || !history.offset} onClick={() => leave(() => setHistory({ ...history, offset: history.offset - 20 }))}>上一页批次</Button><Button disabled={locked || !historyQuery.result?.has_more} onClick={() => leave(() => setHistory({ ...history, offset: history.offset + 20 }))}>下一页批次</Button></div>{notices}
    </section> : <section className="panel bom-section">
      <h2>分层生产</h2><p className="bom-hint">选择要登记的成品或半成品。半成品仅供本单对应上层使用。</p>
      <Input type="search" aria-label="搜索生产层" placeholder="搜索成品、半成品或层级路径" value={search} disabled={locked} onChange={event => setSearch(event.target.value)} />
      {scope && !search && <div className="bom-actions"><Button icon={ArrowLeft} disabled={locked} onClick={() => setScope(byPath.get(scope)?.parent_path || '')}>返回上层</Button><span className="stage-path">{pathLabel(byPath.get(scope))}</span></div>}
      {!visible.length && <p className="bom-hint">没有匹配的生产层。</p>}
      {visible.map(item => <article className="stage-row" key={item.path}>
        <div className="stage-row-heading"><div><strong>{item.name}</strong><p className="stage-path">{item.path ? `${pathLabel(item)} · 路径 ${item.path}` : '最终成品'}</p></div><Badge tone={item.completed_quantity >= item.planned_quantity ? 'green' : item.completed_quantity ? 'blue' : 'gray'}>{item.completed_quantity >= item.planned_quantity ? '已达计划' : item.completed_quantity ? '已登记' : '未登记'}</Badge></div>
        <dl className="stage-progress"><div><dt>计划</dt><dd>{count(item.planned_quantity)} {item.unit}</dd></div><div><dt>已完成</dt><dd>{count(item.completed_quantity)} {item.unit}</dd></div>
          <div><dt>尚欠计划</dt><dd>{count(Math.max(0, addQuantity(item.planned_quantity, -item.completed_quantity)))} {item.unit}</dd></div>
          {item.path !== '' && <><div><dt>已供上层</dt><dd>{count(item.consumed_quantity)} {item.unit}</dd></div><div><dt>单内可用</dt><dd>{count(item.available_quantity)} {item.unit}</dd></div></>}
        </dl>
        <details><summary>查看累计投入差异</summary><p className="bom-hint">标准按本层累计合格数量计算一次；已作废批次不计入。</p>
          {item.items.map(input => <div className="stage-cumulative-input" key={input.path}>
            <strong>{input.name}</strong><p>累计实际 {count(input.actual_quantity)} {input.unit} · 累计标准 {input.standard_quantity == null ? '超出计算范围' : `${count(input.standard_quantity)} ${input.unit}`}</p>
            {input.standard_quantity != null && <p>差异 {count(addQuantity(input.actual_quantity, -input.standard_quantity))} {input.unit}</p>}
          </div>)}
        </details><div className="bom-actions">
          {canRegister && <Button kind="primary" disabled={locked} aria-label={`登记 ${item.name}`} onClick={() => begin(item)}>登记</Button>}
          <Button disabled={locked} aria-label={`查看批次 ${item.name}`} onClick={() => { setHistory({ path: item.path, offset: 0 }); action.setError(''); }}>批次记录</Button>
          {item.path !== scope && item.items.some(input => input.usage_mode === 'explode') && <Button disabled={locked} icon={ChevronRight} aria-label={`查看下层 ${item.name}`} onClick={() => { setScope(item.path); setSearch(''); }}>查看下层</Button>}
        </div>
      </article>)}{notices}
    </section>}
  </div>;
}
