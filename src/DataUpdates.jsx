import { t as translate, getFormatLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { Button as AntButton } from './ui/controls.jsx';

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
    let checking = false, changed = false;
    let lastCheckedAt = Date.now();
    const inspect = async () => {
      if (checking || changed || document.visibilityState !== 'visible' || !navigator.onLine || Date.now() - lastCheckedAt < 30000) return;
      lastCheckedAt = Date.now();
      checking = true;
      try {
        const result = await api('/updates', { warehouseId, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result.user_id !== userId) {
          window.dispatchEvent(new Event('erp:unauthorized'));
          return;
        }
        changed = result.revision !== revision;
        setCheck({ revision, warehouseId, userId, changed });
      } catch (error) {
        if (!controller.signal.aborted && error.status === 400 && error.code === 'WAREHOUSE_NOT_FOUND') {
          changed = true;
          setCheck({ revision, warehouseId, userId, changed });
        }
      } finally {
        checking = false;
        if (changed) clearInterval(timer);
      }
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
  return !!check && check.revision === revision && check.warehouseId === warehouseId && check.userId === userId && check.changed;
}

export function DataUpdateNotice({ onRefresh, busy, disabled }) {
  useLocale();
  return <div className="data-update-notice" role="status" aria-label={translate("system.data.update.tips")}>
    <span>{translate("system.the.data.has.changed.click.refresh.to.view.the.latest.data")}</span>
    <AntButton type="default" htmlType="button" onClick={onRefresh} disabled={busy || disabled} aria-busy={busy}>
      {busy ? <LoadingIndicator size={18} /> : <RefreshCw size={18} />}{translate("system.refresh.data")}</AntButton>
    {disabled && <small>{translate("system.please.complete.and.close.the.current.operation.first")}</small>}
  </div>;
}
