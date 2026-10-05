import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

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
  const [failed, setFailed] = useState(false);
  const closeButton = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const key = e => {
      // Keep closing and focus local when previewing over a product editor.
      if (e.key !== 'Escape' && e.key !== 'Tab') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.key === 'Escape') close.current();
      else closeButton.current?.focus();
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, []);
  return <section className="image-viewer" role="dialog" aria-modal="true" aria-label={`图片预览：${title}`} onClick={e => { e.stopPropagation(); onClose(); }}>
    <button ref={closeButton} type="button" className="image-viewer-close" aria-label="关闭图片预览" onClick={e => { e.stopPropagation(); onClose(); }}><X size={24} /></button>
    {failed ? <p role="alert">图片无法显示，请关闭后重试。</p> : <img className="image-viewer-image" src={src} alt={`${title} 大图`} draggable={false} onClick={e => e.stopPropagation()} onError={() => setFailed(true)} />}
  </section>;
}
