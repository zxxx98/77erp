import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from './api.js';
import { LoadingIndicator } from './Loading.jsx';
import './data-updates.css';

export function useDataUpdates(data, userId) {
  const [check, setCheck] = useState(null);
  const { revision, warehouse_id: warehouseId } = data;
  useEffect(() => {
    if (!revision || !warehouseId) return;
    const controller = new AbortController();
    let checking = false;
    const inspect = async () => {
      if (checking || document.visibilityState !== 'visible' || !navigator.onLine) return;
      checking = true;
      try {
        const result = await api('/updates', { warehouseId, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result.user_id !== userId) {
          window.dispatchEvent(new Event('erp:unauthorized'));
          return;
        }
        setCheck({ revision, changed: result.revision !== revision });
      } catch (error) {
        // A deleted warehouse can be recovered by the existing explicit refresh.
        if (!controller.signal.aborted && error.status === 400 && error.message.startsWith('仓库不存在'))
          setCheck({ revision, changed: true });
      } finally { checking = false; }
    };
    const timer = setInterval(inspect, 30000);
    window.addEventListener('focus', inspect);
    window.addEventListener('online', inspect);
    document.addEventListener('visibilitychange', inspect);
    return () => {
      controller.abort(); clearInterval(timer);
      window.removeEventListener('focus', inspect);
      window.removeEventListener('online', inspect);
      document.removeEventListener('visibilitychange', inspect);
    };
  }, [revision, warehouseId, userId]);
  return !!check && check.revision === revision && check.changed;
}

export function DataUpdateNotice({ onRefresh, busy, disabled }) {
  return <div className="data-update-notice" role="status" aria-label="数据更新提示">
    <span>数据有变更，点击刷新查看最新数据。</span>
    <button type="button" onClick={onRefresh} disabled={busy || disabled} aria-busy={busy}>
      {busy ? <LoadingIndicator size={18} /> : <RefreshCw size={18} />}刷新数据
    </button>
    {disabled && <small>请先完成并关闭当前操作。</small>}
  </div>;
}
