import { t as translate, getFormatLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { Button as AntButton } from './ui/controls.jsx';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { productThumbnailUrl } from './image-url.js';

export function ProductImage({ src, alt, className = '', preview = true, thumbnailSize }) {
  useLocale();
  const [open, setOpen] = useState(false);
  const [failedThumbnail, setFailedThumbnail] = useState('');
  const thumbnail = productThumbnailUrl(src, thumbnailSize);
  const displaySrc = failedThumbnail === thumbnail ? src : thumbnail;
  const img = <img src={displaySrc} alt={alt} loading="lazy" decoding="async" onError={() => { if (displaySrc !== src) setFailedThumbnail(thumbnail); }} />;
  if (!preview) return <span className={className}>{img}</span>;
  return <>
    <AntButton type="text" htmlType="button" className={`product-image-button ${className}`} aria-label={translate("system.zoom.in.to.view", { v0: alt })} onClick={e => { e.stopPropagation(); setOpen(true); }}>{img}</AntButton>
    {open && createPortal(<ImageViewer src={src} title={alt} onClose={() => setOpen(false)} />, document.body)}
  </>;
}

function ImageViewer({ src, title, onClose }) {
  useLocale();
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
    const back = event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      close.current();
    };
    window.addEventListener('erp:back-modal', back, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('erp:back-modal', back, true);
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, []);
  return <section className="image-viewer" role="dialog" aria-modal="true" aria-label={translate("system.image.preview", { v0: title })}>
    <AntButton type="text" ref={closeButton} htmlType="button" className="image-viewer-close" aria-label={translate("system.close.image.preview")} onClick={e => { e.stopPropagation(); onClose(); }}><X size={24} /></AntButton>
    {failed ? <p role="alert">{translate("system.the.image.cannot.be.displayed.please.close.it.and.try.again")}</p> : <img className="image-viewer-image" src={src} alt={translate("system.big.picture", { v0: title })} draggable={false} onClick={e => e.stopPropagation()} onError={() => setFailed(true)} />}
  </section>;
}
