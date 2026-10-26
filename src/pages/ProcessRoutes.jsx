import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, ArrowLeft } from 'lucide-react';
import { Button, PageHeading, QueryStatus, Badge } from '../components/common.jsx';
import { Input } from '../ui/controls.jsx';
import { Select } from '../Dropdown.jsx';
import { useQuery, queryPath } from '../queries.js';
import { api } from '../api.js';
import { useBusiness } from '../business-api.js';
import { t } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { mobileDevice } from '../device.js';
import { validateProcessGraph, arrangeProcessGraph } from '../../shared/process-routes.js';
import { ProcessGraph } from '../features/ProcessGraph.jsx';
import './bom.css';

export function ProcessRoutes({ data }) {
  useLocale();
  const action = useBusiness();
  const [q, setQ] = useState(''), [status, setStatus] = useState('all'), [offset, setOffset] = useState(0), [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState(null), [baseline, setBaseline] = useState(''), [selected, setSelected] = useState('');
  const [view, setView] = useState(mobileDevice ? 'list' : 'graph'), [connecting, setConnecting] = useState(null), [message, setMessage] = useState('');
  const queryData = useMemo(() => ({ ...data, routeRevision: revision }), [data, revision]);
  const list = useQuery(queryPath('/process-routes', { q, status, offset }), queryData, 150);
  const dirty = !!editor && JSON.stringify(editor) !== baseline;
  const guard = useRef({}); guard.current = { dirty, busy: action.busy };
  useEffect(() => {
    const before = event => { if (guard.current.busy || guard.current.dirty && !window.confirm(t('route.unsaved'))) event.preventDefault(); };
    const unload = event => { if (guard.current.dirty || guard.current.busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('erp:before-navigate', before); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('erp:before-navigate', before); window.removeEventListener('beforeunload', unload); };
  }, []);
  const apply = route => { setEditor(route); setBaseline(JSON.stringify(route)); setSelected(route.graph.nodes[0]?.id || ''); setConnecting(null); action.setError(''); setMessage(''); };
  const open = (route, copy = false) => action.run(async () => {
    const result = await api(`/process-routes/${route.id}`, { warehouseId: data.warehouse_id });
    apply(copy ? { name: `${result.name} (${t('route.copy')})`.slice(0, 100), note: result.note, enabled: 1, graph: result.graph } : result);
  });
  const back = () => { if (!action.busy && (!dirty || window.confirm(t('route.unsaved')))) { setEditor(null); action.setError(''); } };
  const update = changes => { setEditor(previous => ({ ...previous, ...changes })); action.setError(''); };
  const select = nodeId => {
    if (connecting !== null) {
      if (!connecting) { setConnecting(nodeId); setSelected(nodeId); return; }
      const graph = { ...editor.graph, edges: [...editor.graph.edges, { from: connecting, to: nodeId }] };
      if (connecting === nodeId || graph.edges.filter(e => e.from === connecting && e.to === nodeId).length > 1) { setConnecting(null); return; }
      update({ graph }); setConnecting(null);
    }
    setSelected(nodeId);
  };
  const notices = <>{action.error && <p className="form-error" role="alert">{action.error}</p>}{message && <p className="bom-success" role="status">{message}</p>}</>;
  if (!editor) return <div className="bom-page process-page"><PageHeading title={t('route.title')} description={t('route.listHint')}><Button kind="primary" icon={Plus} onClick={() => apply({ name: '', note: '', enabled: 1, graph: { nodes: [{ id: crypto.randomUUID(), name: t('route.newNode'), note: '', x: 24, y: 24 }], edges: [] } })}>{t('route.new')}</Button></PageHeading>
    {notices}<section className="panel bom-section"><div className="bom-filters"><Input type="search" aria-label={t('route.search')} placeholder={t('route.search')} value={q} onChange={event => { setQ(event.target.value); setOffset(0); }} /><Select aria-label={t('route.all')} value={status} onChange={next => { setStatus(next); setOffset(0); }}><option value="all">{t('route.all')}</option><option value="enabled">{t('route.enabled')}</option><option value="disabled">{t('route.disabled')}</option></Select></div><QueryStatus query={list} />
      <div className="process-route-list">{list.result?.routes.map(route => <article key={route.id} className="process-operation process-route-card"><div className="bom-section-heading"><h2>{route.name}</h2><Badge tone={route.enabled ? 'green' : 'gray'}>{t(route.enabled ? 'route.enabled' : 'route.disabled')}</Badge></div><p className="bom-hint">{t('route.version', { version: route.version })} · {t('route.operations')} {route.graph.nodes.length} · {t('route.uses')} {route.product_count} / {route.bom_count}</p>{route.note && <p>{route.note}</p>}<div className="bom-actions"><Button onClick={() => open(route)}>{t('route.edit')}</Button><Button onClick={() => open(route, true)}>{t('route.copy')}</Button><Button disabled={action.busy} onClick={() => action.run(async () => { await action.send(`/process-routes/${route.id}/status`, { version: route.version, enabled: route.enabled ? 0 : 1 }, { warehouseId: data.warehouse_id }); setRevision(n => n + 1); })}>{t(route.enabled ? 'route.disabled' : 'route.enabled')}</Button></div></article>)}</div>
      {list.result && !list.result.total && <p>{t('route.empty')}</p>}<div className="bom-actions"><Button disabled={!offset || list.loading} onClick={() => setOffset(n => Math.max(0, n - 30))}>{t('route.previous')}</Button><Button disabled={!list.result?.has_more || list.loading} onClick={() => setOffset(n => n + 30)}>{t('route.next')}</Button>{list.result && <span>{t('route.total', { total: list.result.total })}</span>}</div>
    </section></div>;
  const graph = editor.graph, node = graph.nodes.find(n => n.id === selected);
  const patchNode = changes => update({ graph: { ...graph, nodes: graph.nodes.map(n => n.id === selected ? { ...n, ...changes } : n) } });
  return <div className="bom-page process-page"><PageHeading title={t(editor.id ? 'route.edit' : 'route.new')} description={t('route.snapshotHint')}><Button icon={ArrowLeft} disabled={action.busy} onClick={back}>{t('route.back')}</Button></PageHeading>
    <section className="panel bom-section process-route-fields"><label>{t('route.name')}<Input aria-label={t('route.name')} maxLength={100} value={editor.name} disabled={action.busy} onChange={event => update({ name: event.target.value })} /></label><label>{t('route.note')}<Input.TextArea aria-label={t('route.note')} maxLength={1000} value={editor.note} disabled={action.busy} onChange={event => update({ note: event.target.value })} /></label></section>
    {editor.id && (editor.products?.length > 0 || editor.boms?.length > 0) && <section className="panel bom-section"><h2>{t('route.uses')}</h2><p>{[...(editor.products || []).map(row => `${row.name} (#${row.id})`), ...(editor.boms || []).map(row => `BOM ${row.name} (#${row.id})`)].join('、')}</p></section>}
    <section className="panel bom-section"><div className="bom-actions"><Button aria-pressed={view === 'graph'} onClick={() => setView('graph')}>{t('route.graph')}</Button><Button aria-pressed={view === 'list'} onClick={() => setView('list')}>{t('route.list')}</Button><Button disabled={action.busy || graph.nodes.length >= 50} onClick={() => { const next = { id: crypto.randomUUID(), name: t('route.newNode'), note: '', x: 24, y: Math.min(9900, graph.nodes.length * 110 + 24) }; update({ graph: { ...graph, nodes: [...graph.nodes, next] } }); setSelected(next.id); }}>{t('route.add')}</Button><Button disabled={action.busy} onClick={() => action.run(async () => update({ graph: arrangeProcessGraph(graph) }))}>{t('route.auto')}</Button>{view === 'graph' && <Button disabled={action.busy} aria-pressed={connecting !== null} onClick={() => setConnecting(connecting === null ? '' : null)}>{t('route.connect')}</Button>}</div>
      <p className="bom-hint">{t(connecting !== null ? 'route.connectHint' : 'route.dragHint')}</p><p className="bom-hint">{t('route.topologyHint')}</p>
      <div className="process-editor-layout"><div>{view === 'graph' ? <ProcessGraph graph={graph} selected={selected} onSelect={select} onChange={next => update({ graph: next })} disabled={action.busy} /> : <div>{graph.nodes.map(n => <article className="process-operation" key={n.id}><Button disabled={action.busy} aria-pressed={selected === n.id} onClick={() => setSelected(n.id)}>{n.name}</Button><p className="bom-hint">{t('route.predecessors')}: {graph.edges.filter(e => e.to === n.id).map(e => graph.nodes.find(parent => parent.id === e.from)?.name).join('、') || t('route.noPredecessors')}</p></article>)}</div>}</div>
        {node && <aside className="process-properties"><label>{t('route.nodeName')}<Input aria-label={t('route.nodeName')} value={node.name} maxLength={80} disabled={action.busy} onChange={event => patchNode({ name: event.target.value })} /></label><label>{t('route.nodeNote')}<Input.TextArea aria-label={t('route.nodeNote')} value={node.note} maxLength={500} disabled={action.busy} onChange={event => patchNode({ note: event.target.value })} /></label><fieldset className="process-predecessors" disabled={action.busy}><legend>{t('route.predecessors')}</legend>{graph.nodes.filter(n => n.id !== node.id).map(parent => <label key={parent.id}><input type="checkbox" checked={graph.edges.some(e => e.from === parent.id && e.to === node.id)} onChange={event => update({ graph: { ...graph, edges: event.target.checked ? [...graph.edges, { from: parent.id, to: node.id }] : graph.edges.filter(e => e.from !== parent.id || e.to !== node.id) } })} />{parent.name}</label>)}</fieldset><Button kind="danger" disabled={action.busy || graph.nodes.length <= 1} onClick={() => { if (!window.confirm(t('route.removeConfirm'))) return; update({ graph: { nodes: graph.nodes.filter(n => n.id !== node.id), edges: graph.edges.filter(e => e.from !== node.id && e.to !== node.id) } }); setSelected(graph.nodes.find(n => n.id !== node.id)?.id || ''); }}>{t('route.remove')}</Button></aside>}
      </div></section>{notices}<div className="bom-editor-actions"><Button disabled={action.busy} onClick={back}>{t('route.cancel')}</Button>{editor.id && <Button disabled={action.busy} onClick={() => { if (!dirty || window.confirm(t('route.reloading'))) open(editor); }}>{t('route.reload')}</Button>}<Button kind="primary" busy={action.busy} disabled={!editor.name.trim()} onClick={() => action.run(async () => { validateProcessGraph(editor.graph); await action.send(editor.id ? `/process-routes/${editor.id}` : '/process-routes', { name: editor.name, note: editor.note, enabled: editor.enabled, graph: editor.graph, ...(editor.id ? { version: editor.version } : {}) }, { warehouseId: data.warehouse_id }); setEditor(null); setRevision(n => n + 1); setMessage(t('route.saved')); })}>{t('route.save')}</Button></div>
  </div>;
}
