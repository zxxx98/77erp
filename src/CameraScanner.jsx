import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Camera, Keyboard, LoaderCircle, RefreshCw } from 'lucide-react';
import { mobileDevice } from './device.js';
import './camera-scanner.css';

export function CameraScanner({ onResult, onClose, onManual, title = '扫一扫', note = '识别后自动返回' }) {
  const video = useRef(null), overlay = useRef(null);
  const callbacks = useRef({ onResult, onClose });
  callbacks.current = { onResult, onClose };
  const titleId = useId();
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true, delivered = false, stream, controls;
    const preview = video.current;
    const stop = () => {
      alive = false;
      controls?.stop();
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
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (!alive) return;
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        // A permission prompt can finish after the user has already canceled.
        if (!alive) { stream.getTracks().forEach(track => track.stop()); return; }
        const reader = new BrowserMultiFormatReader();
        const decoding = await reader.decodeFromStream(stream, preview, (result, _error, scanControls) => {
          if (!result || !alive || delivered) return;
          delivered = true;
          scanControls.stop();
          stop();
          callbacks.current.onResult(result.getText());
        });
        if (!alive || delivered) decoding.stop();
        else { controls = decoding; setReady(true); }
      } catch (e) {
        if (!alive) return;
        stop();
        setError(e.name === 'NotAllowedError'
          ? '摄像头权限未开启，请在浏览器中授权，或手动输入物料条码。'
          : '无法访问摄像头，请检查摄像头及浏览器权限，或手动输入条码。');
      }
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
      <div className="camera-crosshair" />
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
      <div className="camera-viewfinder" aria-hidden="true"><i /><i /><i /><i /><span className="camera-scan-line" /></div>
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
