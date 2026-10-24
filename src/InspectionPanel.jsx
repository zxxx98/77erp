import { Form as AntForm } from 'antd';
import { Input as AntInput } from './ui/controls.jsx';
import { FormField } from './ui/FormField.jsx';

import { useMemo, useState } from 'react';
import { usePagedQuery } from './queries.js';
import { api } from './api.js';
import { useBusiness } from './business-api.js';
import { usePermissions } from './permissions.jsx';
import { Button, Modal } from './components/common.jsx';
import { inspectionCompletion, inspectionCycleLabel, inspectionToday, nextInspectionDate, validInspectionDate } from '../shared/inspection.js';
import './inspection.css';

export function InspectionPanel({ data }) {
  const { can } = usePermissions();
  const [revision, setRevision] = useState(0);
  const queryData = useMemo(() => ({ ...data }), [data, revision]);
  const query = usePagedQuery('/products?inspection=due', queryData, 'products');
  const action = useBusiness();
  const [selected, setSelected] = useState(null);
  const [inspectedOn, setInspectedOn] = useState(inspectionToday);
  const [nextDate, setNextDate] = useState('');
  const [message, setMessage] = useState('');
  const periodicDate = useMemo(() => {
    if (!selected?.inspection_interval || !validInspectionDate(inspectedOn)) return '';
    try { return inspectionCompletion(selected, { inspected_on: inspectedOn }).inspection_date; }
    catch { return ''; }
  }, [selected, inspectedOn]);
  const refresh = () => { setSelected(null); action.setError(''); setRevision(value => value + 1); };
  const complete = product => action.run(async () => {
    const saved = await api(`/products/${product.id}/inspect`, {
      method: 'POST', warehouseId: data.warehouse_id,
      body: { version: product.version, inspected_on: inspectedOn, ...(product.inspection_interval ? {} : { next_date: nextDate }) },
    });
    setSelected(null);
    setMessage(`${product.name}已校验，下次校验日期：${saved.inspection_date}`);
    setRevision(value => value + 1);
  });
  const products = query.result?.products || [];
  if (!query.result?.total && !query.error && !action.error && !message) return null;
  return <section className="inspection-panel" aria-label="待校验物料">
    <div className="inspection-heading"><h2>待校验物料{query.result ? `（${query.result.total}）` : ''}</h2><Button disabled={action.busy || query.loading} onClick={refresh}>刷新列表</Button></div>
    {message && <p className="inspection-success" role="status">{message}</p>}
    {(query.error || (!selected && action.error)) && <p role="alert" className="form-error">{query.error || action.error}</p>}
    {products.map(product => <div className="inspection-row" key={product.id}>
      <div><strong>{product.name}</strong><small>{product.barcode}{product.specification ? ` · ${product.specification}` : ''}</small><span>校验日期：{product.inspection_date} · {inspectionCycleLabel(product)}</span></div>
      {can('products') && <Button aria-label={`已校验：${product.name}`} disabled={action.busy || query.loading} onClick={() => {
        action.setError('');
        setSelected(product);
        setInspectedOn(inspectionToday());
        setNextDate('');
      }}>已校验</Button>}
    </div>)}
    {query.result?.has_more && <Button disabled={query.loading || action.busy} onClick={query.loadMore}>{query.loading ? '正在加载…' : '加载更多待校验物料'}</Button>}
    {selected && <Modal title="记录已校验" subtitle={selected.name} onClose={() => { if (!action.busy) setSelected(null); }}>
      <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }} onFinish={() => {  complete(selected); }}>
        <div className="form-body">
          <label>实际校验日期<FormField value={inspectedOn} required type="date" max={inspectionToday()} label="实际校验日期"><AntInput type="date" aria-label="实际校验日期"  max={inspectionToday()} value={inspectedOn} disabled={action.busy} onChange={event => setInspectedOn(event.target.value)} /></FormField><small>默认今天，补录时请选择实际完成校验的日期。</small></label>
          {selected.inspection_interval ? <p>校验周期：{inspectionCycleLabel(selected)}；下次校验日期：{periodicDate || '请选择有效的实际校验日期'}。从实际校验日期按配置周期顺延。</p> : <>
            <p>此物料未配置周期，请手动填写下次校验日期。</p>
            <label>下次校验日期<FormField label="下次校验日期" value={nextDate} required type="date" min={validInspectionDate(inspectedOn) && inspectedOn < '9999-12-31' ? nextInspectionDate(inspectedOn, 1, 'day') : undefined}><AntInput type="date"  min={validInspectionDate(inspectedOn) && inspectedOn < '9999-12-31' ? nextInspectionDate(inspectedOn, 1, 'day') : undefined} value={nextDate} disabled={action.busy} onChange={event => setNextDate(event.target.value)} /></FormField></label>
          </>}
          {action.error && <p role="alert" className="form-error">{action.error}</p>}
        </div>
        <div className="modal-footer"><Button type="button" disabled={action.busy} onClick={() => setSelected(null)}>取消</Button><Button type="submit" kind="primary" busy={action.busy}>完成</Button></div>
      </AntForm>
    </Modal>}
  </section>;
}
