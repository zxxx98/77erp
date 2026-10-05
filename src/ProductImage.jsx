import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus, RotateCcw, X } from 'lucide-react';

export function ProductImage({ src, alt, className = '', preview = true }) {
  const [open, setOpen] = useState(false);
  const img = <img src={src} alt={alt} loading="lazy" decoding="async" />;
  if (!preview) return <span className={className}>{img}</span>;
  return <>
    <button type="button" className={`product-image-button ${className}`} aria-label={`放大查看 ${alt}`} onClick={e => { e.stopPropagation(); setOpen(true); }}>{img}</button>
    {open && createPortal(<ImageViewer src={src} title={alt} onClose={() => setOpen(false)} />, document.body)}
  </>;
}

function ImageViewer({ src, title, onClose }) {
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState(false);
  const viewer = useRef(null);
  const stage = useRef(null);
  const drag = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  const changeZoom = step => setZoom(current => Math.max(1, Math.min(4, current + step)));
  const reset = () => { setZoom(1); stage.current?.scrollTo(0, 0); };
  useEffect(() => {
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    viewer.current.querySelector('[data-close]')?.focus();
    const key = e => {
      // A preview can open over an editor: keep its shortcuts and close action local.
      if (['Escape', 'Tab', '+', '=', '-', '0'].includes(e.key)) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
      if (e.key === 'Escape') close.current();
      else if (e.key === '+' || e.key === '=') changeZoom(0.5);
      else if (e.key === '-') changeZoom(-0.5);
      else if (e.key === '0') reset();
      else if (e.key === 'Tab') {
        const targets = [...viewer.current.querySelectorAll('button:not(:disabled), [tabindex="0"]')];
        const current = targets.indexOf(document.activeElement);
        const next = (current + (e.shiftKey ? -1 : 1) + targets.length) % targets.length;
        targets[next]?.focus();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, []);
  useEffect(() => {
    const el = stage.current;
    if (el) el.scrollTo((el.scrollWidth - el.clientWidth) / 2, (el.scrollHeight - el.clientHeight) / 2);
  }, [zoom]);
  return <section ref={viewer} className="image-viewer" role="dialog" aria-modal="true" aria-label={`图片预览：${title}`} onClick={e => e.stopPropagation()}>
    <header className="image-viewer-header">
      <strong>{title}</strong>
      <button type="button" data-close aria-label="关闭图片预览" onClick={onClose}><X size={22} /></button>
    </header>
    <div ref={stage} className={`image-viewer-stage ${zoom > 1 ? 'is-zoomed' : ''}`} tabIndex={0} aria-label="图片查看区域"
      onDoubleClick={() => setZoom(current => current === 1 ? 2 : 1)}
      onPointerDown={e => {
        if (zoom === 1 || e.button !== 0) return;
        e.preventDefault();
        drag.current = { x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => { if (drag.current) { e.currentTarget.scrollLeft = drag.current.left + drag.current.x - e.clientX; e.currentTarget.scrollTop = drag.current.top + drag.current.y - e.clientY; } }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {failed ? <p role="alert">图片无法显示，请关闭后重试。</p> : <div className="image-viewer-canvas" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
        <img src={src} alt={`${title} 大图`} draggable={false} onError={() => setFailed(true)} />
      </div>}
    </div>
    <footer className="image-viewer-controls">
      <button type="button" aria-label="缩小图片" disabled={zoom <= 1} onClick={() => changeZoom(-0.5)}><Minus size={20} /></button>
      <output aria-label="图片缩放比例">{Math.round(zoom * 100)}%</output>
      <button type="button" aria-label="放大图片" disabled={zoom >= 4} onClick={() => changeZoom(0.5)}><Plus size={20} /></button>
      <button type="button" aria-label="重置图片" onClick={reset}><RotateCcw size={20} /></button>
      <small>放大后可拖动，双击切换缩放</small>
    </footer>
  </section>;
}
