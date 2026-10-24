import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { CameraScanner } from '../CameraScanner.jsx';
import { Modal, Button } from '../components/common.jsx';
import { Input } from '../ui/controls.jsx';
import { parseProductionRegistrationUrl } from '../../shared/production-link.js';

export function clearProductionRegistration() {
  if (!location.hash.startsWith('#production?') || !new URLSearchParams(location.hash.split('?')[1]).has('register')) return;
  const url = new URL(location.href);
  url.searchParams.delete('warehouse_id'); url.hash = 'production';
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useProductionRegistration({ data, onSwitchWarehouse, onOrder, onError, navigationState, navigationBusy }) {
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
        if (!onSwitchWarehouse) throw new Error('请先切换至二维码对应的仓库后重试。');
        // The shell owns workspace changes; remounting then resolves with its new scope.
        const switched = await onSwitchWarehouse(destination.warehouseId);
        if (!switched) throw new Error('无法切换到生产单所在仓库，请检查仓库权限后重试。');
        return;
      }
      const order = await api(`/production-orders/${destination.orderId}`, { warehouseId: destination.warehouseId });
      if (!alive()) return;
      if (order.id !== destination.orderId || order.number !== destination.number) throw new Error('二维码与当前生产单单号不一致，单据可能已删除或数据已恢复，请重新导出。');
      // A form may have changed while the network request was pending.
      if ((callbacks.current.navigationBusy || navigationState !== callbacks.current.navigationState) && !window.dispatchEvent(new Event('erp:before-navigate', { cancelable: true }))) { clearProductionRegistration(); return; }
      callbacks.current.onOrder(order); setScanner(false); clearProductionRegistration();
    } catch (error) {
      if (error.status === 401) return;
      if (alive()) { const message = error.status === 404 ? '生产单不存在或不属于您可查看的生产小组，请联系管理员。' : error.message; setError(message); callbacks.current.onError(message); clearProductionRegistration(); }
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
  return { busy, openScanner: () => { setError(''); setScanner(true); }, scanner: scanner ? <ProductionScanDialog error={error} busy={busy} onScan={resolve} onClose={() => { if (!busy) { setScanner(false); clearProductionRegistration(); } }} /> : null };
}

function ProductionScanDialog({ error, busy, onScan, onClose }) {
  const [value, setValue] = useState(''), [camera, setCamera] = useState(false);
  return <Modal title="扫码登记" onClose={onClose}><form className="form-body" onSubmit={event => { event.preventDefault(); if (value.trim() && !busy) void onScan(value.trim()); }}>
    <p>扫描生产单 PDF 上的二维码，或使用扫码枪、粘贴完整链接。扫码只打开登记表，核对后由您提交。</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    <label>生产登记链接<Input aria-label="生产登记链接" autoFocus value={value} disabled={busy} onChange={event => setValue(event.target.value)} placeholder="扫描或粘贴生产登记链接" /></label>
    <div className="bom-actions"><Button type="submit" kind="primary" busy={busy} disabled={!value.trim()}>打开登记</Button><Button disabled={busy} onClick={() => setCamera(true)}>使用相机扫码</Button><Button disabled={busy} onClick={onClose}>取消</Button></div>
    {camera && <CameraScanner title="扫描生产登记二维码" note="对准生产单 PDF 上的二维码" onClose={() => setCamera(false)} onManual={() => setCamera(false)} onResult={result => { setCamera(false); setValue(result); void onScan(result); }} />}
  </form></Modal>;
}
