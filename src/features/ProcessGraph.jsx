import { Fragment, useId, useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import { t } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { ProcessGraphMenu } from './ProcessGraphMenu.jsx';
import { useProcessGraphGestures } from './useProcessGraphGestures.js';
import './process-routes.css';

export function orderProcessNodes(graph) {
  if (!graph?.nodes?.length) return [];
  const ids = new Set(graph.nodes.map(n => n.id));
  const incoming = new Map(graph.nodes.map(n => [n.id, []])), outgoing = new Map(graph.nodes.map(n => [n.id, []]));
  for (const edge of graph.edges || []) {
    if (ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to) {
      incoming.get(edge.to).push(edge.from);
      outgoing.get(edge.from).push(edge.to);
    }
  }
  const remaining = new Map([...incoming].map(([id, parents]) => [id, parents.length]));
  const queue = graph.nodes.filter(n => remaining.get(n.id) === 0).map(n => n.id), orderedIds = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]; orderedIds.push(id);
    for (const child of outgoing.get(id) || []) {
      remaining.set(child, remaining.get(child) - 1);
      if (remaining.get(child) === 0) queue.push(child);
    }
  }
  for (const node of graph.nodes) if (!orderedIds.includes(node.id)) orderedIds.push(node.id);
  return orderedIds.map((id, index) => {
    const node = graph.nodes.find(n => n.id === id);
    const parents = incoming.get(id) || [], children = outgoing.get(id) || [];
    return { ...node, step: index + 1, isStart: parents.length === 0, isOutput: children.length === 0, parents, children };
  });
}

export function ProcessFlowStrip({ graph, operations = [], limit = 6 }) {
  useLocale();
  const ordered = orderProcessNodes(graph);
  if (!ordered.length) return null;
  const visible = ordered.slice(0, limit), hiddenCount = Math.max(0, ordered.length - visible.length);
  return <div className="process-flow-strip" aria-label={t('route.operations')}>
    {visible.map((node, index) => {
      const op = operations.find(item => item.id === node.id);
      return <div className="process-flow-step-wrap" key={node.id}>
        {index > 0 && <ArrowRight size={13} className="process-flow-arrow" aria-hidden="true" />}
        <span className={`process-flow-pill${node.isOutput ? ' is-output' : node.isStart ? ' is-start' : ''}`}>
          <em className="process-flow-index">{node.step}</em>
          <strong className="process-flow-name">{node.name}</strong>
          {op !== undefined && <small className="process-flow-qty">{op.completed_quantity}</small>}
          {node.isOutput && <i className="process-flow-tag">{t('route.output')}</i>}
        </span>
      </div>;
    })}
    {hiddenCount > 0 && <span className="process-flow-more">+{hiddenCount}</span>}
  </div>;
}

export function ProcessGraph({ graph, selected, connectingSource = null, onSelect, onChange, onCreate, operations = [], disabled = false }) {
  useLocale();
  const marker = useId().replace(/:/g, ''), drag = useRef(null);
  const gestures = useProcessGraphGestures({ onCreate, disabled });
  const limit = graph.nodes.length >= 50 ? 'route.nodeLimit' : graph.edges.length >= 200 ? 'route.edgeLimit' : null;
  const ordered = orderProcessNodes(graph);
  const metaById = new Map(ordered.map(n => [n.id, n]));
  const handleWidth = (node, direction) => {
    const x = node.x + (direction === 'after' ? 184 : 0);
    // Old/manual layouts can leave only 16px between ports. Do not let an
    // invisible touch target steal the neighbouring handle or the short edge.
    const distances = graph.nodes.filter(other => other.id !== node.id && Math.abs(other.y - node.y) < 44)
      .flatMap(other => [Math.abs(other.x - x), Math.abs(other.x + 184 - x)]);
    return Math.max(12, Math.min(44, ...distances.map(distance => distance - 4)));
  };
  const width = Math.max(620, ...graph.nodes.map(n => n.x + (onCreate ? 420 : 228))), height = Math.max(onCreate ? 360 : 240, ...graph.nodes.map(n => n.y + (onCreate ? 240 : 124)));
  return <div className="process-canvas-scroll" role="region" aria-label={t('route.graph')} tabIndex={0}>
    <div ref={gestures.canvasRef} className={`process-canvas${onCreate ? ' is-editable' : ''}`} style={{ width, height }} {...gestures.canvasEvents}>
      <svg width={width} height={height} aria-hidden="true" className="process-edges">
        <defs>
          <marker id={marker} markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 1L7 4L0 7Z" fill="currentColor" /></marker>
          <marker id={`${marker}-active`} markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 1L7 4L0 7Z" fill="var(--accent, #2563eb)" /></marker>
        </defs>
        {graph.edges.map(edge => {
          const from = graph.nodes.find(n => n.id === edge.from), to = graph.nodes.find(n => n.id === edge.to);
          if (!from || !to) return null;
          const active = selected && (edge.from === selected || edge.to === selected);
          const x1 = from.x + 184, y1 = from.y + 41, x2 = to.x, y2 = to.y + 41, bend = Math.max(28, Math.abs(x2 - x1) / 2);
          const path = `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`;
          return <g key={`${edge.from}:${edge.to}`} className="process-edge">
            {onCreate && !disabled && <path className="process-edge-hit" data-from={edge.from} data-to={edge.to} d={path} fill="none" stroke="transparent" strokeWidth="20" />}
            <path className={`process-edge-line${active ? ' process-edge-active' : ''}`} d={path} fill="none" stroke={active ? 'var(--accent, #2563eb)' : 'currentColor'} strokeWidth={active ? '2' : '1.6'} markerEnd={`url(#${active ? `${marker}-active` : marker})`} />
          </g>;
        })}
        {gestures.line && <path className="process-edge-preview" d={gestures.line.direction === 'after'
          ? `M${gestures.line.start.x},${gestures.line.start.y} L${gestures.line.end.x},${gestures.line.end.y}`
          : `M${gestures.line.end.x},${gestures.line.end.y} L${gestures.line.start.x},${gestures.line.start.y}`} fill="none" stroke="var(--accent, #2563eb)" strokeWidth="2" strokeDasharray="5 4" markerEnd={`url(#${marker}-active)`} />}
      </svg>
      {graph.nodes.map(node => {
        const progress = operations.find(n => n.id === node.id), meta = metaById.get(node.id) || {};
        const output = !graph.edges.some(e => e.from === node.id), isStart = !graph.edges.some(e => e.to === node.id);
        const isConnectingFrom = connectingSource === node.id;
        return <Fragment key={node.id}><button type="button" className={`process-node${selected === node.id ? ' selected' : ''}${output ? ' is-output' : isStart ? ' is-start' : ''}${isConnectingFrom ? ' is-connecting' : ''}`} style={{ left: node.x, top: node.y }} aria-pressed={selected === node.id}
          onClick={() => !disabled && onSelect?.(node.id)}
          onPointerDown={event => {
            if (!onChange || disabled || event.button !== 0) return;
            drag.current = { id: node.id, px: event.clientX, py: event.clientY, x: node.x, y: node.y };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            const active = drag.current;
            if (!active || active.id !== node.id || disabled) return;
            const margin = onCreate ? 24 : 0;
            const x = Math.min(10000, Math.max(margin, Math.round(active.x + event.clientX - active.px))), y = Math.min(10000, Math.max(margin, Math.round(active.y + event.clientY - active.py)));
            if (Math.abs(x - active.x) + Math.abs(y - active.y) > 3) onChange({ ...graph, nodes: graph.nodes.map(n => n.id === node.id ? { ...n, x, y } : n) });
          }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
          {!onCreate && !isStart && <i className="process-node-port in" aria-hidden="true" />}
          {!onCreate && !output && <i className="process-node-port out" aria-hidden="true" />}
          <div className="process-node-header">
            <small className="process-node-step">#{meta.step || 1}</small>
            <em className={`process-node-role${output ? ' role-output' : isStart ? ' role-start' : ''}`}>
              {t(output ? 'route.output' : isStart ? 'route.start' : 'route.operations')}
            </em>
          </div>
          <strong title={node.name}>{node.name}</strong>
          {progress ? <span className="process-node-metrics">
            <b>{t('route.completed')} {progress.completed_quantity}</b>
            {progress.available_quantity !== null && <b className={progress.available_quantity > 0 ? 'has-available' : ''}>{t('route.available')} {progress.available_quantity}</b>}
          </span> : <span>{node.note || (output ? t('route.output') : isStart ? t('route.noPredecessors') : t('route.operations'))}</span>}
        </button>
          {onCreate && ['before', 'after'].map(direction => <button key={direction} type="button" className="process-node-handle"
            style={{ left: node.x + (direction === 'after' ? 184 : 0), top: node.y + 41, '--process-handle-width': `${handleWidth(node, direction)}px` }}
            aria-label={t(direction === 'before' ? 'route.dragBefore' : 'route.dragAfter', { name: node.name })}
            title={t(limit || (direction === 'before' ? 'route.dragBefore' : 'route.dragAfter'), { name: node.name })}
            disabled={disabled || !!limit} {...gestures.handleEvents(node, direction, !!limit)} />)}
        </Fragment>;
      })}
    </div>
    {gestures.menu && !disabled && <ProcessGraphMenu menu={gestures.menu} limit={graph.nodes.length >= 50 ? 'route.nodeLimit' : gestures.menu.edge && graph.edges.length >= 200 ? 'route.edgeLimit' : null} onCreate={onCreate} onClose={gestures.closeMenu} />}
  </div>;
}
