import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { t } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import './zoom-viewport.css';

const interactive = 'button, a, input, select, textarea, [role="button"], [contenteditable="true"]';

// Tables keep native scrolling (including sticky headers and touch scrolling).
// Diagrams can pan freely, even when all nodes already fit inside the viewport.
export const ZoomViewport = forwardRef(function ZoomViewport({ children, className = '', label, height, freePan = false, scale: controlledScale, onScaleChange, showTools = true, minScale = 0.4, maxScale = 2, testId, onNavigate }, forwardedRef) {
  useLocale();
  const viewport = useRef(null), content = useRef(null), drag = useRef(null), suppressClick = useRef(false);
  const current = useRef({ scale: 1, x: 0, y: 0 });
  const [view, setView] = useState(current.current), [panning, setPanning] = useState(false);
  const attachViewport = useCallback(element => {
    viewport.current = element;
    if (typeof forwardedRef === 'function') forwardedRef(element);
    else if (forwardedRef) forwardedRef.current = element;
  }, [forwardedRef]);
  useLayoutEffect(() => {
    if (freePan) return;
    const element = viewport.current;
    // Keep the unscaled table width stable: zoom should enlarge the whole
    // structure rather than reflowing its columns into the same viewport.
    const resize = () => { content.current.style.width = `${element.clientWidth}px`; };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [freePan]);
  const changeScale = useCallback((value, clientX, clientY, notify = true) => {
    const element = viewport.current;
    if (!element) return;
    const before = current.current, scale = Math.min(maxScale, Math.max(minScale, value));
    if (scale === before.scale) return;
    const rect = element.getBoundingClientRect();
    const x = clientX == null ? element.clientWidth / 2 : clientX - rect.left - element.clientLeft;
    const y = clientY == null ? element.clientHeight / 2 : clientY - rect.top - element.clientTop;
    const ratio = scale / before.scale;
    const next = freePan ? { scale, x: x - (x - before.x) * ratio, y: y - (y - before.y) * ratio } : { ...before, scale };
    if (!freePan) {
      const left = (element.scrollLeft + x) * ratio - x, top = (element.scrollTop + y) * ratio - y;
      // Apply the new layout before moving the scroll position, so it is not
      // clamped against the old dimensions during a zoom-in.
      content.current.style.zoom = scale;
      element.scrollLeft = left;
      element.scrollTop = top;
    }
    current.current = next; setView(next); if (notify) onScaleChange?.(scale); onNavigate?.();
  }, [freePan, minScale, maxScale, onScaleChange, onNavigate]);
  useLayoutEffect(() => {
    if (controlledScale != null) changeScale(controlledScale, undefined, undefined, false);
  }, [controlledScale, changeScale]);
  useEffect(() => {
    const element = viewport.current;
    const wheel = event => {
      if (!event.deltaY) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      changeScale(current.current.scale * Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002), event.clientX, event.clientY);
    };
    // React wheel handlers are passive; a native listener keeps the page still
    // while zooming this view, including on trackpads.
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [changeScale]);
  const finishPan = event => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null; setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const reset = () => {
    current.current = { scale: 1, x: 0, y: 0 }; setView(current.current);
    if (content.current) content.current.style.zoom = '';
    viewport.current?.scrollTo(0, 0);
  };
  return <div className="zoom-view">
    {showTools && <div className="zoom-view-tools" role="group" aria-label={t('canvas.controls')}>
      <span className="zoom-view-hint">{t(freePan ? 'canvas.graphHint' : 'canvas.tableHint')}</span>
      <button type="button" aria-label={t('canvas.zoomOut')} title={t('canvas.zoomOut')} disabled={view.scale <= minScale} onClick={() => changeScale(current.current.scale / 1.2)}><Minus size={16} /></button>
      <output aria-label={t('canvas.scale')}>{Math.round(view.scale * 100)}%</output>
      <button type="button" aria-label={t('canvas.zoomIn')} title={t('canvas.zoomIn')} disabled={view.scale >= maxScale} onClick={() => changeScale(current.current.scale * 1.2)}><Plus size={16} /></button>
      <button type="button" aria-label={t('canvas.reset')} title={t('canvas.reset')} onClick={reset}><RotateCcw size={16} /></button>
    </div>}
    <div ref={attachViewport} data-testid={testId} className={`zoom-viewport ${freePan ? 'is-canvas' : 'is-scroll'}${panning ? ' is-panning' : ''} ${className}`} style={height ? { height } : undefined} role="region" aria-label={label} tabIndex={0}
      onKeyDown={event => {
        if (!freePan || event.target !== event.currentTarget) return;
        const offset = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[event.key];
        if (!offset) return;
        event.preventDefault();
        current.current = { ...current.current, x: current.current.x + offset[0], y: current.current.y + offset[1] }; setView(current.current);
      }}
      onPointerDown={event => {
        suppressClick.current = false;
        if (event.button !== 0 || drag.current || event.target.closest(interactive) || (!freePan && event.pointerType === 'touch')) return;
        const element = event.currentTarget, rect = element.getBoundingClientRect();
        if (event.clientX >= rect.left + element.clientLeft + element.clientWidth || event.clientY >= rect.top + element.clientTop + element.clientHeight) return;
        event.preventDefault();
        drag.current = { id: event.pointerId, px: event.clientX, py: event.clientY, x: current.current.x, y: current.current.y, left: element.scrollLeft, top: element.scrollTop };
        if (event.pointerType !== 'touch') element.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const active = drag.current;
        if (!active || active.id !== event.pointerId) return;
        const dx = event.clientX - active.px, dy = event.clientY - active.py;
        if (!suppressClick.current && Math.hypot(dx, dy) < 4) return;
        if (!suppressClick.current) onNavigate?.();
        suppressClick.current = true; setPanning(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        if (freePan) {
          current.current = { ...current.current, x: active.x + dx, y: active.y + dy }; setView(current.current);
        } else {
          event.currentTarget.scrollLeft = active.left - dx;
          event.currentTarget.scrollTop = active.top - dy;
        }
      }}
      onPointerUp={finishPan} onPointerCancel={finishPan} onLostPointerCapture={finishPan}
      onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}>
      <div ref={content} className="zoom-view-content" style={freePan ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` } : { zoom: view.scale }}>
        {children}
      </div>
    </div>
  </div>;
});
