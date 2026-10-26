import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useBusiness } from '../business-api.js';
import { useQuery } from '../queries.js';
import { api } from '../api.js';
import { usePermissions } from '../permissions.jsx';
import { Button, PageHeading, QueryStatus, Badge } from '../components/common.jsx';
import { Input } from '../ui/controls.jsx';
import { Select } from '../Dropdown.jsx';
import { t, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { parseQuantity } from '../../shared/quantity.js';
import { ProcessGraph } from './ProcessGraph.jsx';
import { mobileDevice } from '../device.js';
const count = value => Number(value).toLocaleString(getFormatLocale(), { maximumFractionDigits: 4 });

export function OperationWorkerSelect({ order, warehouseId, value, onChange, disabled }) {
  useLocale();
  const { user } = usePermissions();
  const data = useMemo(() => ({ warehouse_id: warehouseId }), [warehouseId]);
  const query = useQuery(`/production-orders/${order.id}/operation-workers`, data);
  const currentId = value ?? user.id;
  return <div className="process-picker process-worker-picker"><label>{t('route.worker')}<Select aria-label={t('route.worker')} value={currentId ?? ''} disabled={disabled || query.loading || !!query.error} onChange={next => onChange(Number(next))}>
    {!query.result?.workers.some(w => w.id === currentId) && <option value={currentId ?? ''}>{currentId === user.id ? (user.name || user.username || t('route.self')) : `#${currentId}`}</option>}
    {query.result?.workers.map(w => <option key={w.id} value={w.id}>{w.name}{w.id === user.id ? ` · ${t('route.self')}` : ''}</option>)}
  </Select></label><p className="bom-hint">{t('route.workerHint')}</p><QueryStatus query={query} /></div>;
}

export function ProductionOperations({ order, path = '', data, canRegister, onOutput, onBack, onSaved, onActivity }) {
  useLocale();
  const { can, user } = usePermissions(), action = useBusiness();
  const route = order.operation_routes.find(r => r.path === path), layer = order.stages?.find(s => s.path === path);
  const unit = layer?.unit || order.unit;
  const [workerId, setWorkerId] = useState(user.id), [form, setForm] = useState(null), [voiding, setVoiding] = useState(null), [selected, setSelected] = useState('');
  const [offset, setOffset] = useState(0);
  const historyData = useMemo(() => ({ warehouse_id: data.warehouse_id, version: order.version }), [data.warehouse_id, order.version]);
  const historyQuery = useQuery(`/production-orders/${order.id}/operations/reports?${new URLSearchParams({ snapshot_id: String(route.id), offset: String(offset) })}`, historyData);
  const [view, setView] = useState(mobileDevice ? 'list' : 'graph');
  const dirty = !!form && (!!form.quantity || !!form.note) || !!voiding?.reason;
  const guard = useRef({}); guard.current = { dirty, busy: action.busy };
  useEffect(() => { onActivity?.({ form, voiding, busy: action.busy }); }, [form, voiding, action.busy, onActivity]);
  useEffect(() => () => onActivity?.(null), [onActivity]);
  useEffect(() => {
    const before = event => { if (guard.current.busy || guard.current.dirty && !window.confirm(t('route.unsaved'))) event.preventDefault(); };
    const unload = event => { if (guard.current.dirty || guard.current.busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('erp:before-navigate', before); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('erp:before-navigate', before); window.removeEventListener('beforeunload', unload); };
  }, []);
  const leave = fn => { if (!action.busy && (!dirty || window.confirm(t('route.unsaved')))) { action.setError(''); fn(); } };
  const send = (suffix, body) => action.send(`/production-orders/${order.id}${suffix}`, { schema_version: 2, stage_schema_version: 1, operation_schema_version: 1, version: order.version, ...body }, { warehouseId: data.warehouse_id });
  const back = () => leave(() => { if (form || voiding) { setForm(null); setVoiding(null); } else onBack(); });
  const activeNode = form ? route.operations.find(n => n.id === form.node_id) : null;
  return <div className="production-stages process-page"><PageHeading title={t('route.progress')} description={`${order.number} · ${layer?.name || order.product_name} · ${route.route_name}`}><Button icon={ArrowLeft} disabled={action.busy} onClick={back}>{t(form || voiding ? 'route.backOperations' : 'route.backOrder')}</Button></PageHeading>
    <section className="panel bom-section">
      <div className="process-progress-top">
        <div className="process-progress-intro">
          <div className="process-progress-badges">
            <strong>{route.route_name}</strong>
            <span className="process-meta-pill">{t('route.version', { version: route.route_version })}</span>
            <span className="process-meta-pill">{t('route.operations')} {route.operations.length}</span>
          </div>
          <p className="bom-hint">{t('route.reportHint')}</p>
        </div>
        <OperationWorkerSelect order={order} warehouseId={data.warehouse_id} value={workerId} onChange={setWorkerId} disabled={action.busy} />
      </div>
      {!form && !voiding && <>
        <div className="process-editor-toolbar process-progress-toolbar">
          <div className="process-view-segmented" role="group" aria-label={t('route.operations')}>
            <Button aria-pressed={view === 'graph'} onClick={() => setView('graph')}>{t('route.graph')}</Button>
            <Button aria-pressed={view === 'list'} onClick={() => setView('list')}>{t('route.list')}</Button>
          </div>
          {view === 'graph' && selected && <Button onClick={() => setSelected('')}>{t('route.allNodes')}</Button>}
        </div>
        {view === 'graph' && <ProcessGraph graph={route.graph} operations={route.operations} selected={selected} onSelect={setSelected} />}
        <div className="process-operations-grid">
          {route.operations.filter(node => view === 'list' || !selected || selected === node.id).map((node) => {
            const stepIndex = route.operations.findIndex(item => item.id === node.id) + 1;
            const isStart = node.predecessors.length === 0;
            return <article key={node.id} className={`process-operation process-operation-card${node.is_output ? ' is-output' : ''}${selected === node.id ? ' selected' : ''}`}>
              <div className="bom-section-heading process-operation-card-head">
                <div className="process-operation-title-group">
                  <span className="process-step-badge">#{stepIndex}</span>
                  <h3>{node.name}</h3>
                </div>
                {node.is_output ? <Badge tone="blue">{t('route.output')}</Badge> : isStart ? <Badge tone="green">{t('route.start')}</Badge> : null}
              </div>
              {node.note && <p className="process-operation-note">{node.note}</p>}
              <p className="bom-hint">{t('route.predecessors')}: {node.predecessors.map(parent => route.operations.find(n => n.id === parent)?.name).join('、') || t('route.noPredecessors')}</p>
              <dl className="process-operation-stats">
                <div className="process-stat-box"><dt>{t('route.completed')}</dt><dd>{count(node.completed_quantity)} {unit}</dd></div>
                {node.available_quantity !== null && <div className={`process-stat-box${node.available_quantity > 0 ? ' is-available' : ''}`}><dt>{t('route.available')}</dt><dd>{count(node.available_quantity)} {unit}</dd></div>}
              </dl>
              {canRegister && <div className="process-operation-card-action">
                <Button kind="primary" disabled={action.busy || node.available_quantity === 0} aria-label={`${t(node.is_output ? 'route.outputReport' : 'route.report')} ${node.name}`} onClick={() => node.is_output ? onOutput(node, workerId) : setForm({ node_id: node.id, quantity: '', note: '' })}>{t(node.is_output ? 'route.outputReport' : 'route.report')}</Button>
              </div>}
            </article>;
          })}
        </div>
      </>}
      {form && <form className="process-report-form" onSubmit={event => { event.preventDefault(); action.run(async () => {
        const quantity = parseQuantity(form.quantity, true);
        if (!window.confirm(t('route.confirmReport'))) return;
        const result = await send('/operations/report', { path, operation_node_id: form.node_id, quantity, note: form.note, worker_id: workerId });
        setForm(null); await onSaved(result, t('route.reported'));
      }); }}>
        <div className="process-report-context">
          <h2>{activeNode?.name}</h2>
          {activeNode && <dl className="process-operation-stats">
            <div className="process-stat-box"><dt>{t('route.completed')}</dt><dd>{count(activeNode.completed_quantity)} {unit}</dd></div>
            {activeNode.available_quantity !== null && <div className="process-stat-box is-available"><dt>{t('route.available')}</dt><dd>{count(activeNode.available_quantity)} {unit}</dd></div>}
          </dl>}
        </div>
        <div className="process-report-quantity-row">
          <label>{t('route.quantity')}（{unit}）<Input autoFocus aria-label={t('route.quantity')} inputMode="decimal" value={form.quantity} disabled={action.busy} onChange={event => { setForm({ ...form, quantity: event.target.value }); action.setError(''); }} /></label>
          {activeNode?.available_quantity > 0 && <Button disabled={action.busy} onClick={() => { setForm({ ...form, quantity: String(activeNode.available_quantity) }); action.setError(''); }}>{t('route.fillAvailable')} ({count(activeNode.available_quantity)})</Button>}
        </div>
        <label>{t('route.batchNote')}<Input.TextArea rows={3} aria-label={t('route.batchNote')} maxLength={500} value={form.note} disabled={action.busy} onChange={event => setForm({ ...form, note: event.target.value })} /></label>
        <div className="bom-actions"><Button disabled={action.busy} onClick={back}>{t('route.cancel')}</Button><Button type="submit" kind="primary" busy={action.busy}>{t('route.report')}</Button></div>
      </form>}
      {voiding && <form className="process-report-form" onSubmit={event => { event.preventDefault(); action.run(async () => { if (!voiding.reason.trim()) throw new Error(t('route.reason')); if (!window.confirm(t('route.confirmVoid'))) return; const result = await send(`/operations/${voiding.id}/void`, { reason: voiding.reason }); setVoiding(null); await onSaved(result, t('route.voided')); }); }}><label>{t('route.reason')}<Input.TextArea rows={3} aria-label={t('route.reason')} maxLength={500} value={voiding.reason} disabled={action.busy} onChange={event => setVoiding({ ...voiding, reason: event.target.value })} /></label><div className="bom-actions"><Button onClick={back} disabled={action.busy}>{t('route.cancel')}</Button><Button type="submit" kind="danger" busy={action.busy}>{t('route.confirmVoid')}</Button></div></form>}
    </section>
    {action.error && <p className="form-error" role="alert">{action.error}</p>}
    <div className="bom-actions process-reload-bar"><Button icon={RefreshCw} disabled={action.busy} onClick={() => leave(() => action.run(async () => onSaved(await api(`/production-orders/${order.id}`, { warehouseId: data.warehouse_id }), t('route.reload'))))}>{t('route.reload')}</Button></div>
    {!form && !voiding && <section className="panel bom-section">
      <div className="bom-section-heading">
        <h2>{t('route.history')}</h2>
        <span className="bom-hint">{t('route.latest')}</span>
      </div>
      <QueryStatus query={historyQuery} />
      {historyQuery.result?.total === 0 && <div className="bom-empty process-empty-state"><p>{t('route.noReports')}</p></div>}
      <div className="process-history-list">
        {historyQuery.result?.reports.map(report => <article className={`process-operation process-history-card${report.status === 'void' ? ' is-void' : ''}`} key={report.id}>
          <div className="process-history-main">
            <div className="bom-section-heading process-history-head">
              <strong>{route.operations.find(n => n.id === report.node_id)?.name} · {count(report.quantity)} {unit}</strong>
              <Badge tone={report.status === 'active' ? 'green' : 'gray'}>{t(report.status === 'active' ? 'route.active' : 'route.voided')}</Badge>
            </div>
            <p className="process-history-people">{t('route.worker')}: {report.worker_name} · {t('route.recorder')}: {report.registered_by_name}</p>
            <p className="bom-hint">{new Date(report.created_at).toLocaleString(getFormatLocale())}</p>
            {report.note && <p className="process-history-note">{report.note}</p>}
            {report.status === 'void' && <p className="process-history-void-reason">{t('route.reason')}: {report.void_reason}</p>}
            {report.output_kind && <p className="bom-hint">{t('route.outputVoidHint')}</p>}
          </div>
          {!report.output_kind && report.status === 'active' && order.status !== 'void' && can('production') && can('corrections') && <div className="process-history-action">
            <Button disabled={action.busy} onClick={() => setVoiding({ id: report.id, reason: '' })}>{t('route.void')}</Button>
          </div>}
        </article>)}
      </div>
      <div className="bom-actions bom-pagination process-pagination"><Button disabled={offset === 0 || historyQuery.loading} onClick={() => setOffset(n => Math.max(0, n - 20))}>{t('route.previous')}</Button><Button disabled={!historyQuery.result?.has_more || historyQuery.loading} onClick={() => setOffset(n => n + 20)}>{t('route.next')}</Button></div>
    </section>}
  </div>;
}
