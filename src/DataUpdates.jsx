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
        if (!controller.signal.aborted && error.status === 400 && error.message.startsWith(translate("system.warehouse.does.not.exist")))
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
  useLocale();
  return <div className="data-update-notice" role="status" aria-label={translate("system.data.update.tips")}>
    <span>{translate("system.the.data.has.changed.click.refresh.to.view.the.latest.data")}</span>
    <AntButton type="default" htmlType="button" onClick={onRefresh} disabled={busy || disabled} aria-busy={busy}>
      {busy ? <LoadingIndicator size={18} /> : <RefreshCw size={18} />}{translate("system.refresh.data")}</AntButton>
    {disabled && <small>{translate("system.please.complete.and.close.the.current.operation.first")}</small>}
  </div>;
}
