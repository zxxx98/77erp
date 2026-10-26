import { useId, useRef } from 'react';
import { t } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import './process-routes.css';

export function ProcessGraph({ graph, selected, onSelect, onChange, operations = [], disabled = false }) {
  useLocale();
  const marker = useId().replace(/:/g, ''), drag = useRef(null);
  const width = Math.max(600, ...graph.nodes.map(n => n.x + 220)), height = Math.max(240, ...graph.nodes.map(n => n.y + 115));
  return <div className="process-canvas-scroll" role="region" aria-label={t('route.graph')} tabIndex={0}>
    <div className="process-canvas" style={{ width, height }}>
      <svg width={width} height={height} aria-hidden="true" className="process-edges"><defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="currentColor" /></marker></defs>
        {graph.edges.map(edge => {
          const from = graph.nodes.find(n => n.id === edge.from), to = graph.nodes.find(n => n.id === edge.to);
          if (!from || !to) return null;
          const x1 = from.x + 180, y1 = from.y + 36, x2 = to.x, y2 = to.y + 36, bend = Math.max(25, Math.abs(x2 - x1) / 2);
          return <path key={`${edge.from}:${edge.to}`} d={`M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`} fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd={`url(#${marker})`} />;
        })}
      </svg>
      {graph.nodes.map(node => {
        const progress = operations.find(n => n.id === node.id), output = !graph.edges.some(e => e.from === node.id);
        return <button key={node.id} type="button" className={`process-node${selected === node.id ? ' selected' : ''}`} style={{ left: node.x, top: node.y }} aria-pressed={selected === node.id}
          onClick={() => !disabled && onSelect?.(node.id)}
          onPointerDown={event => {
            if (!onChange || disabled || event.button !== 0) return;
            drag.current = { id: node.id, px: event.clientX, py: event.clientY, x: node.x, y: node.y };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            const active = drag.current;
            if (!active || active.id !== node.id || disabled) return;
            const x = Math.min(10000, Math.max(0, Math.round(active.x + event.clientX - active.px))), y = Math.min(10000, Math.max(0, Math.round(active.y + event.clientY - active.py)));
            if (Math.abs(x - active.x) + Math.abs(y - active.y) > 3) onChange({ ...graph, nodes: graph.nodes.map(n => n.id === node.id ? { ...n, x, y } : n) });
          }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
          <strong>{node.name}</strong><span>{progress ? `${t('route.completed')} ${progress.completed_quantity}` : output ? t('route.output') : t('route.operations')}</span>
        </button>;
      })}
    </div>
  </div>;
}
