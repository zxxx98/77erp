import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Minus, Plus, Maximize2 } from 'lucide-react';
import { Button, PageHeading, QueryStatus } from '../components/common.jsx';
import { Input } from '../ui/controls.jsx';
import { useLocale } from '../i18n/react.jsx';
import { t, getFormatLocale } from '../i18n/index.js';
import { useQuery } from '../queries.js';
import { layoutOverview, overviewScope, productionOverviewLayers } from '../../shared/process-overview.js';
import { validateProcessGraph } from '../../shared/process-routes.js';
import './process-overview.css';

const count = value => value == null ? t('overview.unknown') : Number(value).toLocaleString(getFormatLocale(), { maximumFractionDigits: 6 });
const sourceLabel = source => t(source === 'snapshot' ? 'overview.fromSnapshot' : source === 'bom' ? 'overview.fromBom' : 'overview.fromProduct');
const noRouteLabel = production => t(production ? 'overview.noSnapshot' : 'overview.noRoute');

function LayerHeading({ layer, production }) {
  return <>
    <strong className="overview-layer-name" title={layer.name}>{layer.name}</strong>
    <span className="overview-layer-recipe" title={`${layer.bom_name || ''} · ${layer.path || t('production.finalProduct')}`}>{layer.bom_name} · {layer.path || t('production.finalProduct')}</span>
    <span className="overview-layer-route" title={layer.route?.name}>{layer.route ? `${layer.route.name} · ${sourceLabel(layer.route_source)} · v${layer.route.version}` : noRouteLabel(production)}</span>
    {(layer.enabled === 0 || layer.product_active === 0 || layer.route?.enabled === 0) && <span className="overview-inactive">{t('route.disabled')}</span>}
    {production && <span className="overview-layer-quantity">{t('production.completed')} <b>{count(layer.completed_quantity)}</b> / {count(layer.planned_quantity)} {layer.unit}</span>}
  </>;
}

function LayerActions({ layer, childrenCount, folded, onToggle, onBranch, onOpen, disabled, scopePath }) {
  return <div className="overview-layer-actions">
    <Button disabled={disabled} aria-expanded={!folded} onClick={() => onToggle(layer.path)}>{t(folded ? 'overview.expand' : 'overview.collapse')}</Button>
    {!!childrenCount && layer.path !== scopePath && <Button disabled={disabled} icon={ChevronRight} onClick={() => onBranch(layer.path)}>{t('overview.branch', { count: childrenCount })}</Button>}
    {onOpen && layer.route && <Button disabled={disabled} onClick={() => onOpen(layer.path)}>{t('route.viewProgress')}</Button>}
  </div>;
}

function LayerList({ layers, production, collapsed, onSelect, counts, byPath, ...actions }) {
  return <div className="overview-list">
    {layers.map(layer => {
      const folded = collapsed.has(layer.path), graph = layer.route?.graph;
      const meta = graph ? validateProcessGraph(graph) : null, nodes = new Map((graph?.nodes || []).map(node => [node.id, node]));
      const progress = new Map((layer.route?.operations || []).map(op => [op.id, op]));
      const parent = byPath.get(layer.parent_path);
      return <article className="overview-list-layer" key={layer.path} data-layer-path={layer.path}>
        <header><LayerHeading layer={layer} production={production} /></header>
        {parent && <p className="overview-supply-label">{t('overview.suppliesTo', { name: parent.name })}</p>}
        <LayerActions layer={layer} childrenCount={counts.get(layer.path) || 0} folded={folded} {...actions} />
        {!folded && graph && <ol className="overview-operation-list">{meta.order.map(id => {
          const node = nodes.get(id), op = progress.get(id), parents = meta.incoming.get(id);
          return <li key={id}><button type="button" aria-label={`${layer.name} · ${node.name}`} onClick={() => onSelect(layer.path, id)}>
            <strong>{node.name}</strong><span>{id === meta.output ? t('route.output') : t('route.intermediate')}</span>
            <small>{parents.length ? `${t('route.predecessors')}: ${parents.map(parentId => nodes.get(parentId).name).join(' / ')}` : t('route.noPredecessors')}</small>
            {op && <small>{t('route.completed')} {count(op.completed_quantity)} {layer.unit}</small>}
          </button></li>;
        })}</ol>}
        {!folded && !graph && <p>{noRouteLabel(production)}</p>}
        {!!layer.materials?.length && <details className="overview-materials"><summary>{t('overview.materials')} ({layer.materials.length})</summary>
          <ul>{layer.materials.map((material, index) => <li key={material.path || index}>{material.name} · {material.unit}</li>)}</ul>
        </details>}
      </article>;
    })}
  </div>;
}

function OverviewCanvas({ layout, production, scale, canvasRef, onSelect, counts, ...actions }) {
  const marker = `overview-${useId().replace(/:/g, '')}`;
  return <div className="overview-canvas-scroll" ref={canvasRef} tabIndex={0} role="region" aria-label={t('route.graph')} data-testid="overview-canvas">
    <div style={{ width: layout.width * scale, height: layout.height * scale }}>
      <div className="overview-canvas" style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}>
        <svg width={layout.width} height={layout.height} className="overview-edges" aria-hidden="true">
          <defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 1L7 4L0 7Z" fill="currentColor" /></marker></defs>
          {layout.groups.map(group => <rect key={group.path} className="overview-group-bg" x={group.x} y={group.y} width={group.width} height={group.height} rx="12" />)}
          {layout.supplyEdges.map(edge => <path key={edge.fromPath} data-supply-from={edge.fromPath} data-supply-to={edge.toPath} className="overview-supply-edge"
            d={`M${edge.x1},${edge.y1} C${edge.x1 + 64},${edge.y1} ${edge.x2 - 64},${edge.y2} ${edge.x2},${edge.y2}`}
            fill="none" stroke="currentColor" strokeWidth="2" stroke-dasharray="6 5" markerEnd={`url(#${marker})`} />)}
          {layout.groups.flatMap(group => {
            const nodes = new Map(group.nodes.map(node => [node.id, node]));
            return group.edges.map(edge => {
              const from = nodes.get(edge.from), to = nodes.get(edge.to);
              const x1 = group.x + from.x + 180, y1 = group.y + from.y + 44, x2 = group.x + to.x, y2 = group.y + to.y + 44;
              return <path key={`${group.path}:${edge.from}:${edge.to}`} d={`M${x1},${y1} C${x1 + 26},${y1} ${x2 - 26},${y2} ${x2},${y2}`}
                fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd={`url(#${marker})`} />;
            });
          })}
        </svg>
        {layout.groups.map(group => <article className="overview-graph-layer" data-layer-path={group.path} key={group.path} style={{ left: group.x, top: group.y, width: group.width, height: group.height }}>
          <header><LayerHeading layer={group} production={production} /></header>
          <div className="overview-graph-actions"><LayerActions layer={group} childrenCount={counts.get(group.path) || 0} folded={group.folded} {...actions} /></div>
          {!!counts.get(group.path) && <span className="overview-inlet">{t('overview.inlet')}</span>}
          {group.parent_path != null && <span className="overview-outlet" style={{ top: (group.nodes.find(node => node.output)?.y ?? 88) + 48 }}>{t('overview.supply')}</span>}
          {group.nodes.map(node => <button type="button" key={node.key} className={`overview-node${node.output ? ' is-output' : ''}`} style={{ left: node.x, top: node.y }}
            aria-label={`${group.name} · ${node.name}`} onClick={() => onSelect(group.path, node.placeholder ? null : node.id)}>
            <span>{node.placeholder ? noRouteLabel(production) : node.output ? t('route.output') : t('route.operations')}</span>
            <strong title={node.name}>{node.name}</strong>
            {node.progress ? <small>{t('route.completed')} {count(node.progress.completed_quantity)} {group.unit}</small> : <small title={node.note}>{node.note || group.unit}</small>}
          </button>)}
        </article>)}
      </div>
    </div>
  </div>;
}

export function ProcessOverview({ layers, production = false, onOpen, disabled = false }) {
  useLocale();
  const [view, setView] = useState(() => window.matchMedia('(max-width: 760px)').matches ? 'list' : 'graph');
  const [scope, setScope] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(0);
  const [expandedDepth, setExpandedDepth] = useState(1);
  const [collapsed, setCollapsed] = useState(() => new Set(layers.length > 12 ? layers.filter(layer => layer.path).map(layer => layer.path) : []));
  const [selected, setSelected] = useState(null), [zoom, setZoom] = useState(null), [canvasWidth, setCanvasWidth] = useState(900);
  const canvasRef = useRef(null);
  const byPath = useMemo(() => new Map(layers.map(layer => [layer.path, layer])), [layers]);
  const counts = useMemo(() => {
    const result = new Map();
    for (const layer of layers) if (layer.parent_path != null) result.set(layer.parent_path, (result.get(layer.parent_path) || 0) + 1);
    return result;
  }, [layers]);
  const visible = useMemo(() => overviewScope(layers, byPath.has(scope) ? scope : '', search, page, expandedDepth), [layers, byPath, scope, search, page, expandedDepth]);
  const layout = useMemo(() => layoutOverview(visible.layers, collapsed), [visible.layers, collapsed]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(entries => setCanvasWidth(entries[0].contentRect.width));
    observer.observe(canvas); return () => observer.disconnect();
  }, [view, visible.layers.length]);
  const fit = Math.max(0.35, Math.min(1, canvasWidth / layout.width)), scale = zoom ?? fit;
  const navigate = path => { setScope(path); setSearch(''); setPage(0); setSelected(null); setZoom(null); setExpandedDepth(1); };
  const onToggle = path => setCollapsed(previous => { const next = new Set(previous); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  const onSelect = (path, id) => setSelected({ path, id });
  const selectedLayer = selected && byPath.get(selected.path), selectedNode = selectedLayer?.route?.graph.nodes.find(node => node.id === selected.id);
  const selectedProgress = selectedLayer?.route?.operations?.find(node => node.id === selected?.id);
  const actions = { onToggle, onBranch: navigate, onOpen, disabled, scopePath: search.trim() ? null : scope };
  return <section className="panel bom-section process-overview" data-testid="process-overview">
    <h2>{t(production ? 'overview.production' : 'overview.connections')}</h2>
    <p className="overview-description">{t(production ? 'overview.snapshotHint' : 'overview.savedHint')}</p>
    <div className="overview-toolbar">
      <div className="overview-view-switch"><Button aria-pressed={view === 'graph'} onClick={() => setView('graph')}>{t('route.graph')}</Button><Button aria-pressed={view === 'list'} onClick={() => setView('list')}>{t('overview.list')}</Button></div>
      <Input aria-label={t('overview.search')} placeholder={t('overview.search')} value={search} onChange={event => { setSearch(event.target.value); setPage(0); setSelected(null); setZoom(null); }} />
    </div>
    <div className="overview-context">
      {scope && !search && <><Button icon={ArrowLeft} onClick={() => navigate(byPath.get(scope)?.parent_path || '')}>{t('overview.up')}</Button><Button onClick={() => navigate('')}>{t('overview.root')}</Button><strong>{byPath.get(scope)?.name} · {scope}</strong></>}
      <span>{t('overview.page', { page: visible.page + 1, count: visible.total, kind: t(search.trim() ? 'overview.matches' : 'overview.children') })}</span>
      {(visible.page > 0 || visible.hasMore) && <><Button disabled={!visible.page} onClick={() => { setPage(visible.page - 1); setSelected(null); }}>{t('route.previous')}</Button><Button disabled={!visible.hasMore} onClick={() => { setPage(visible.page + 1); setSelected(null); }}>{t('route.next')}</Button></>}
      {!search.trim() && <><Button disabled={visible.limited || expandedDepth >= 10 || !visible.layers.some(layer => layer.path !== scope && layers.some(child => child.parent_path === layer.path && !visible.layers.some(shown => shown.path === child.path)))} onClick={() => { setExpandedDepth(depth => depth + 1); setZoom(null); }}>{t('overview.deeper')}</Button>
        {expandedDepth > 1 && <Button onClick={() => { setExpandedDepth(1); setSelected(null); setZoom(null); }}>{t('overview.shallow')}</Button>}</>}
    </div>
    {visible.limited && <p role="status">{t('overview.limited')}</p>}
    {!visible.layers.length ? <p role="status">{t('overview.empty')}</p> : view === 'list'
      ? <LayerList layers={visible.layers} production={production} collapsed={collapsed} counts={counts} byPath={byPath} onSelect={onSelect} {...actions} />
      : <><div className="overview-graph-toolbar"><div className="overview-legend"><span>{t('overview.sequence')}</span><span>{t('overview.supply')}</span></div>
        <Button icon={Minus} aria-label={t('overview.zoomOut')} disabled={scale <= 0.35} onClick={() => setZoom(Math.max(0.35, scale - 0.15))} />
        <span className="overview-scale">{Math.round(scale * 100)}%</span><Button icon={Plus} aria-label={t('overview.zoomIn')} disabled={scale >= 1.5} onClick={() => setZoom(Math.min(1.5, scale + 0.15))} />
        <Button icon={Maximize2} onClick={() => { setZoom(null); canvasRef.current?.scrollTo({ left: 0, top: 0 }); }}>{t('overview.fit')}</Button></div>
        <OverviewCanvas layout={layout} production={production} scale={scale} canvasRef={canvasRef} counts={counts} onSelect={onSelect} {...actions} /></>}
    {selectedLayer && <aside className="overview-detail" aria-label={t('overview.detail')}>
      <div className="overview-detail-heading"><h3>{selectedLayer.name} · {selectedNode?.name || noRouteLabel(production)}</h3><Button onClick={() => setSelected(null)}>{t('route.close')}</Button></div>
      <p>{selectedLayer.bom_name} · {selectedLayer.path || t('production.finalProduct')}</p>
      {selectedNode && <><p>{selectedNode.note || t('overview.noInstructions')}</p><p>{t('route.predecessors')}: {selectedLayer.route.graph.edges.filter(edge => edge.to === selectedNode.id).map(edge => selectedLayer.route.graph.nodes.find(node => node.id === edge.from)?.name).join(' / ') || t('route.noPredecessors')}</p></>}
      {selectedProgress && <p>{t('route.completed')} {count(selectedProgress.completed_quantity)} {selectedLayer.unit}{selectedProgress.available_quantity != null && ` · ${t('route.available')} ${count(selectedProgress.available_quantity)} ${selectedLayer.unit}`}</p>}
      {onOpen && selectedLayer.route && <Button disabled={disabled} onClick={() => onOpen(selectedLayer.path)}>{t('route.viewProgress')}</Button>}
    </aside>}
    <p className="overview-description overview-footnote">{t('overview.hint')}</p>
  </section>;
}

export function BomProcessOverview({ bomId, data, onBack }) {
  useLocale();
  const query = useQuery(`/boms/${bomId}/process-overview`, data);
  return <div className="bom-page">
    <PageHeading title={t('overview.bom')} description={query.result?.layers[0]?.name || ''}><Button icon={ArrowLeft} onClick={onBack}>{t('production.backToBom')}</Button></PageHeading>
    <QueryStatus query={query} />
    {query.result && <ProcessOverview key={`${data.warehouse_id}:${bomId}`} layers={query.result.layers} />}
  </div>;
}

export function ProductionProcessOverview({ order, onOpen, disabled }) {
  const layers = useMemo(() => productionOverviewLayers(order), [order]);
  return <ProcessOverview layers={layers} production onOpen={onOpen} disabled={disabled} />;
}
