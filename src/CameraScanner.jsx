import { t as translate, getFormatLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { Button as AntButton } from './ui/controls.jsx';

import { LoadingIndicator } from './Loading.jsx';
import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Camera, Keyboard, RefreshCw } from 'lucide-react';
import { mobileDevice } from './device.js';
import { cameraRegion, createCameraDecoder } from './camera-decoder.js';
import './camera-scanner.css';

export function CameraScanner({ onResult, onClose, onManual, title = translate("system.scan"), note = translate("system.automatically.return.after.recognition") }) {
  useLocale();
  const video = useRef(null), overlay = useRef(null), guide = useRef(null);
  const callbacks = useRef({ onResult, onClose });
  callbacks.current = { onResult, onClose };
  const titleId = useId();
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true, delivered = false, stream, timer;
    const preview = video.current;
    const stop = () => {
      alive = false;
      clearTimeout(timer);
      stream?.getTracks().forEach(track => track.stop());
      if (preview) { preview.pause(); preview.srcObject = null; }
    };
    const suspend = () => {
      stop();
      setReady(false);
      setError(translate("system.the.camera.has.been.paused.please.restart.scanning.or.enter.the"));
    };
    const visibility = () => { if (document.visibilityState === 'hidden') suspend(); };
    setReady(false);
    setError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(translate("system.scanning.the.qr.code.with.the.mobile.phone.camera.requires.https"));
      return;
    }
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', suspend);
    const start = async () => {
      try {
        const decoderPromise = createCameraDecoder();
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        // A permission prompt can finish after the user has already canceled.
        if (!alive) { stream.getTracks().forEach(track => track.stop()); return; }
        preview.srcObject = stream;
        await preview.play();
        if (!alive) return;
        const decode = await decoderPromise;
        if (!alive) return;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas unavailable');
        let lastExpanded = performance.now();
        const scan = async () => {
          if (!alive || delivered) return;
          const started = performance.now();
          try {
            if (preview.readyState >= 2 && preview.videoWidth && preview.videoHeight) {
              const bounds = preview.getBoundingClientRect();
              // Occasionally search the visible preview too, for wider or off-center labels.
              const expanded = started - lastExpanded >= 800;
              if (expanded) lastExpanded = started;
              const region = cameraRegion(preview.videoWidth, preview.videoHeight, bounds,
                expanded ? bounds : guide.current?.getBoundingClientRect() || bounds);
              if (region.width > 0 && region.height > 0) {
                const scale = Math.min(1, 960 / Math.max(region.width, region.height));
                const width = Math.max(1, Math.round(region.width * scale));
                const height = Math.max(1, Math.round(region.height * scale));
                if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
                context.drawImage(preview, region.x, region.y, region.width, region.height, 0, 0, width, height);
                const result = await decode(canvas, expanded);
                if (!alive || delivered) return;
                if (result) {
                  delivered = true;
                  stop();
                  callbacks.current.onResult(result);
                  return;
                }
              }
            }
            if (alive) timer = setTimeout(scan, Math.max(0, 100 - (performance.now() - started)));
          } catch (e) { fail(e); }
        };
        setReady(true);
        timer = setTimeout(scan, 0);
      } catch (e) {
        fail(e);
      }
    };
    const fail = e => {
      if (!alive) return;
      stop();
      setReady(false);
      setError(e.name === 'NotAllowedError'
        ? translate("system.the.camera.permission.is.not.enabled.please.authorize.it.in.the")
        : translate("system.unable.to.access.the.camera.please.check.the.camera.and.browser"));
    };
    start();
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', suspend);
      stop();
    };
  }, [attempt]);

  useEffect(() => {
    if (!mobileDevice) return;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    // Mobile sheets are portaled beside #root by Ant Design Mobile.
    const backgrounds = [...document.body.children]
      .filter(element => element instanceof HTMLElement && element !== overlay.current && !element.matches('script, style, link'))
      .map(element => [element, element.inert]);
    document.body.style.overflow = 'hidden';
    for (const [element] of backgrounds) element.inert = true;
    overlay.current?.focus({ preventScroll: true });
    window.dispatchEvent(new CustomEvent('erp:camera-active', { detail: true }));
    const close = event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      callbacks.current.onClose();
    };
    const key = event => {
      if (event.key === 'Escape') { close(event); return; }
      if (event.key !== 'Tab') return;
      event.stopImmediatePropagation();
      const targets = [...overlay.current.querySelectorAll('button:not(:disabled)')];
      const first = targets[0], last = targets.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === overlay.current)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener('keydown', key, true);
    window.addEventListener('erp:back-modal', close, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('erp:back-modal', close, true);
      document.body.style.overflow = overflow;
      for (const [element, inert] of backgrounds) element.inert = inert;
      previousFocus?.focus({ preventScroll: true });
      window.dispatchEvent(new CustomEvent('erp:camera-active', { detail: false }));
    };
  }, []);

  if (!mobileDevice) return <div className="camera-scanner">
    <video ref={video} muted playsInline hidden={!!error} />
    {error ? <div className="camera-error" role="alert"><Camera size={30} /><p>{error}</p></div> : <>
      <div ref={guide} className="camera-crosshair" />
      {!ready && <div className="camera-loading"><LoadingIndicator size={48} />{translate("system.starting.camera")}</div>}
      <span className="camera-instruction">{translate("system.place.the.material.barcode.or.qr.code.in.the.viewfinder")}</span>
    </>}
  </div>;

  return createPortal(<section ref={overlay} className="camera-scanner-immersive" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
    <video ref={video} muted playsInline className={ready ? 'camera-preview ready' : 'camera-preview'} />
    <header className="camera-overlay-header">
      <AntButton type="text" htmlType="button" className="camera-back" aria-label={translate("system.cancel.qr.code.scanning")} onClick={onClose}><ArrowLeft size={24} /></AntButton>
      <h2 id={titleId}>{title}</h2>
    </header>
    {error ? <div className="camera-error" role="alert"><Camera size={38} /><h3>{translate("system.unable.to.scan.code.at.the.moment")}</h3><p>{error}</p></div> : <>
      <div ref={guide} className="camera-viewfinder" aria-hidden="true"><i /><i /><i /><i /><span className="camera-scan-line" /></div>
      {!ready && <div className="camera-opening" role="status"><LoadingIndicator size={48} /><span>{translate("system.starting.camera")}</span></div>}
    </>}
    <footer className="camera-overlay-footer">
      <p className="camera-overlay-instruction">{translate("system.place.the.material.barcode.or.qr.code.in.the.viewfinder")}</p>
      <p className="camera-overlay-note">{note}</p>
      <div className="camera-overlay-actions">
        {error && <AntButton type="text" htmlType="button" className="camera-action" onClick={() => { overlay.current?.focus({ preventScroll: true }); setAttempt(value => value + 1); }}><RefreshCw size={20} />{translate("system.restart.qr.code.scanning")}</AntButton>}
        {onManual && <AntButton type="text" htmlType="button" className="camera-action" onClick={onManual}><Keyboard size={20} />{translate("system.enter.barcode.manually")}</AntButton>}
      </div>
    </footer>
  </section>, document.body);
}
