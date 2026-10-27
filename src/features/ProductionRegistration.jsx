import { productionMessage } from '../i18n/production-errors.js';
import { t as pt } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { CameraScanner } from '../CameraScanner.jsx';
import { Modal, Button } from '../components/common.jsx';
import { Input } from '../ui/controls.jsx';
import { parseProductionRegistrationUrl, productionRegistrationUrl } from '../../shared/production-link.js';
import { qrSymbol } from '../product-code.js';
import './production-registration.css';

export function ProductionRegistrationQr({ order, data }) {
  useLocale();
  const code = useMemo(() => {
    try {
      const url = productionRegistrationUrl({ origin: location.origin, warehouseId: data.warehouse_id,
        orderId: order.id, number: order.number, sourceId: data.instance_id });
      return { url, symbol: qrSymbol(url) };
    } catch { return null; }
  }, [data.warehouse_id, data.instance_id, order.id, order.number]);
  return <section className="panel bom-section production-registration-qr" aria-label={pt('registration.qr')}>
    {code && <svg className="registration-qr-symbol" viewBox={`0 0 ${code.symbol.size} ${code.symbol.size}`} role="img" aria-label={pt('registration.qr')} shapeRendering="crispEdges">
      <rect width={code.symbol.size} height={code.symbol.size} fill="#fff" /><path d={code.symbol.path} fill="#000" />
    </svg>}
    <div><h2>{pt('registration.qr')}</h2><p className="bom-hint">{pt('registration.qrHint')}</p>
      {code ? <a href={code.url}>{pt('production.openRegistration')}</a> : <p role="alert" className="form-error">{pt('registration.qrUnavailable')}</p>}
      <p className="bom-hint registration-origin">{location.origin}</p>
    </div>
  </section>;
}

export function clearProductionRegistration() {
  if (!location.hash.startsWith('#production?') || !new URLSearchParams(location.hash.split('?')[1]).has('register')) return;
  const url = new URL(location.href);
  url.searchParams.delete('warehouse_id'); url.hash = 'production';
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useProductionRegistration({ data, onSwitchWarehouse, onOrder, onError, navigationState, navigationBusy }) {
  useLocale();
  const [scanner, setScanner] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const callbacks = useRef({}); callbacks.current = { onSwitchWarehouse, onOrder, onError, navigationState, navigationBusy };
  const last = useRef('');
  const request = useRef(0), mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const onHash = () => { request.current++; setBusy(false); setRevision(value => value + 1); };
    window.addEventListener('hashchange', onHash);
    return () => { mounted.current = false; request.current++; window.removeEventListener('hashchange', onHash); };
  }, []);
  const resolve = async (value, active = () => true) => {
    const id = ++request.current;
    const alive = () => mounted.current && id === request.current && active();
    const { onSwitchWarehouse, navigationState } = callbacks.current;
    try {
      setError('');
      const destination = parseProductionRegistrationUrl(value, { origin: location.origin, sourceId: data.instance_id });
      if (!window.dispatchEvent(new Event('erp:before-navigate', { cancelable: true }))) { clearProductionRegistration(); return; }
      setBusy(true);
      // Keep even a manually scanned same-warehouse destination through expired login.
      const url = new URL(value); history.replaceState(history.state, '', url.pathname + url.search + url.hash);
      if (destination.warehouseId !== data.warehouse_id) {
        if (!onSwitchWarehouse) throw new Error(pt("production.switchToTheWarehouseInTheQrCode"));
        // The shell owns workspace changes; remounting then resolves with its new scope.
        const switched = await onSwitchWarehouse(destination.warehouseId);
        if (!switched) throw new Error(pt("production.unableToSwitchToThisOrderSWarehouse"));
        return;
      }
      const order = await api(`/production-orders/${destination.orderId}`, { warehouseId: destination.warehouseId });
      if (!alive()) return;
      if (order.id !== destination.orderId || order.number !== destination.number) throw new Error(pt("production.qrCodeAndCurrentOrderNumberDifferThe"));
      // A form may have changed while the network request was pending.
      if ((callbacks.current.navigationBusy || navigationState !== callbacks.current.navigationState) && !window.dispatchEvent(new Event('erp:before-navigate', { cancelable: true }))) { clearProductionRegistration(); return; }
      callbacks.current.onOrder(order); setScanner(false); clearProductionRegistration();
    } catch (error) {
      if (error.status === 401) return;
      if (alive()) { const message = error.status === 404 ? pt("production.orderDoesNotExistOrIsOutsideYour") : error.message; setError(message); callbacks.current.onError(message); clearProductionRegistration(); }
    } finally { if (alive()) setBusy(false); }
  };
  useEffect(() => {
    if (!data.warehouse_id || !data.instance_id || !location.hash.startsWith('#production?') || !new URLSearchParams(location.hash.split('?')[1]).has('register')) return;
    const key = `${data.warehouse_id}:${location.href}`;
    if (last.current === key) return;
    last.current = key;
    let alive = true;
    void resolve(location.href, () => alive);
    return () => { alive = false; last.current = ''; };
  }, [data.warehouse_id, data.instance_id, revision]);
  return { busy, openScanner: () => { setError(''); setScanner(true); }, scanner: scanner ? <ProductionScanDialog error={productionMessage(error)} busy={busy} onScan={resolve} onClose={() => { if (!busy) { setScanner(false); clearProductionRegistration(); } }} /> : null };
}

function ProductionScanDialog({ error, busy, onScan, onClose }) {
  useLocale();
  const [value, setValue] = useState(''), [camera, setCamera] = useState(false);
  return <Modal title={pt("production.scanToRegister")} onClose={onClose}><form className="form-body" onSubmit={event => { event.preventDefault(); if (value.trim() && !busy) void onScan(value.trim()); }}>
    <p>{pt("production.scanTheQrCodeOnTheProductionPdf")}</p>
    {error && <p role="alert" className="form-error">{productionMessage(error)}</p>}
    <label>{pt("production.productionRegistrationLink")}<Input aria-label={pt("production.productionRegistrationLink")} autoFocus value={value} disabled={busy} onChange={event => setValue(event.target.value)} placeholder={pt("production.scanOrPasteProductionRegistrationLink")} /></label>
    <div className="bom-actions"><Button type="submit" kind="primary" busy={busy} disabled={!value.trim()}>{pt("production.openRegistration")}</Button><Button disabled={busy} onClick={() => setCamera(true)}>{pt("production.scanWithCamera")}</Button><Button disabled={busy} onClick={onClose}>{pt("production.cancel")}</Button></div>
    {camera && <CameraScanner title={pt("production.scanProductionRegistrationQr")} note={pt("production.pointAtTheQrCodeOnTheProduction")} onClose={() => setCamera(false)} onManual={() => setCamera(false)} onResult={result => { setCamera(false); setValue(result); void onScan(result); }} />}
  </form></Modal>;
}
