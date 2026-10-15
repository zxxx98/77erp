import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Camera, Keyboard, LoaderCircle, RefreshCw } from 'lucide-react';
import { mobileDevice } from './device.js';
import { cameraRegion, createCameraDecoder } from './camera-decoder.js';
import './camera-scanner.css';

export function CameraScanner({ onResult, onClose, onManual, title = '扫一扫', note = '识别后自动返回' }) {
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
      setError('摄像头已暂停，请重新开启扫码，或手动输入条码。');
    };
    const visibility = () => { if (document.visibilityState === 'hidden') suspend(); };
    setReady(false);
    setError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('手机摄像头扫码需要 HTTPS，请通过 HTTPS 地址打开此页面。');
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
        ? '摄像头权限未开启，请在浏览器中授权，或手动输入物料条码。'
        : '无法访问摄像头，请检查摄像头及浏览器权限，或手动输入条码。');
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
    const root = document.getElementById('root');
    const inert = root?.inert;
    document.body.style.overflow = 'hidden';
    if (root) root.inert = true;
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
      if (root) root.inert = inert;
      previousFocus?.focus({ preventScroll: true });
      window.dispatchEvent(new CustomEvent('erp:camera-active', { detail: false }));
    };
  }, []);

  if (!mobileDevice) return <div className="camera-scanner">
    <video ref={video} muted playsInline hidden={!!error} />
    {error ? <div className="camera-error" role="alert"><Camera size={30} /><p>{error}</p></div> : <>
      <div ref={guide} className="camera-crosshair" />
      {!ready && <div className="camera-loading"><LoaderCircle className="spin" size={24} />正在开启摄像头…</div>}
      <span className="camera-instruction">将物料条码或二维码置于取景框内</span>
    </>}
  </div>;

  return createPortal(<section ref={overlay} className="camera-scanner-immersive" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
    <video ref={video} muted playsInline className={ready ? 'camera-preview ready' : 'camera-preview'} />
    <header className="camera-overlay-header">
      <button type="button" className="camera-back" aria-label="取消扫码" onClick={onClose}><ArrowLeft size={24} /></button>
      <h2 id={titleId}>{title}</h2>
    </header>
    {error ? <div className="camera-error" role="alert"><Camera size={38} /><h3>暂时无法扫码</h3><p>{error}</p></div> : <>
      <div ref={guide} className="camera-viewfinder" aria-hidden="true"><i /><i /><i /><i /><span className="camera-scan-line" /></div>
      {!ready && <div className="camera-opening" role="status"><LoaderCircle className="spin" size={24} /><span>正在开启摄像头…</span></div>}
    </>}
    <footer className="camera-overlay-footer">
      <p className="camera-overlay-instruction">将物料条码或二维码置于取景框内</p>
      <p className="camera-overlay-note">{note}</p>
      <div className="camera-overlay-actions">
        {error && <button type="button" className="camera-action" onClick={() => { overlay.current?.focus({ preventScroll: true }); setAttempt(value => value + 1); }}><RefreshCw size={20} />重新开启扫码</button>}
        {onManual && <button type="button" className="camera-action" onClick={onManual}><Keyboard size={20} />手动输入条码</button>}
      </div>
    </footer>
  </section>, document.body);
}
