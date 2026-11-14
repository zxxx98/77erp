import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { api } from './api.js';
import { Button } from './components/common.jsx';
import { t } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { localizeError } from './i18n/errors.js';
import './todos.css';

export function useTodoNotifications(data, userId) {
  const [snapshot, setSnapshot] = useState(null);
  const refreshRef = useRef(() => {});
  useEffect(() => {
    if (!data.warehouse_id) return;
    const controller = new AbortController();
    let checking = false, requested = false;
    const inspect = async () => {
      if (controller.signal.aborted || document.visibilityState === 'hidden' || navigator.onLine === false) return;
      if (checking) { requested = true; return; }
      checking = true;
      try {
        const result = await api('/todo-notifications', { warehouseId: data.warehouse_id, signal: controller.signal });
        if (!controller.signal.aborted) {
          if (result.user_id !== userId) window.dispatchEvent(new Event('erp:unauthorized'));
          else setSnapshot(result);
        }
      } catch { /* Retry on reconnect, focus or the next poll; never acknowledge on failure. */ }
      finally { checking = false; if (requested) { requested = false; void inspect(); } }
    };
    refreshRef.current = inspect;
    void inspect();
    const timer = setInterval(inspect, 15000);
    for (const event of ['focus','online','erp:business-changed','erp:todos-changed']) window.addEventListener(event, inspect);
    document.addEventListener('visibilitychange', inspect);
    return () => {
      controller.abort(); clearInterval(timer);
      for (const event of ['focus','online','erp:business-changed','erp:todos-changed']) window.removeEventListener(event, inspect);
      document.removeEventListener('visibilitychange', inspect);
    };
  }, [data.warehouse_id, data.revision, userId]);
  const refresh = useCallback(() => refreshRef.current(), []);
  return { snapshot: snapshot?.user_id === userId ? snapshot : null, refresh };
}

export function TodoNotifications({ snapshot, onRefresh, onOpen }) {
  useLocale();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  if (!snapshot?.total) return null;
  const acknowledge = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await api('/todo-notifications/acknowledge', { method: 'POST', body: { through_id: snapshot.through_id } });
      await onRefresh();
      window.dispatchEvent(new Event('erp:todos-changed'));
    } catch (e) { setError(localizeError(e.message)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <aside className="todo-notice" aria-label={t('todos.notifications')}>
    <div role="status" aria-live="polite"><h2><Bell size={19} />{t('todos.notifications')}</h2>
      {!!snapshot.pending && <p>{t('todos.newPending', { count: snapshot.pending })}</p>}
      {!!snapshot.approved && <p>{t('todos.newApproved', { count: snapshot.approved })}</p>}
      <ul>{snapshot.items.map(item => <li key={item.id}><span>{t(item.event === 'approved' ? 'todos.passed' : item.task_pending ? 'todos.request' : 'todos.requestProcessed')}</span> {item.number} · {item.warehouse_name}</li>)}</ul>
      {snapshot.total > snapshot.items.length && <small>{t('todos.merged', { count: snapshot.total })}</small>}
      <p className="todo-notice-hint">{t('todos.ackHint')}</p>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="todo-notice-actions"><Button disabled={busy} onClick={onOpen}>{t('todos.view')}</Button><Button kind="primary" disabled={busy} onClick={acknowledge}>{t('todos.acknowledge')}</Button></div>
  </aside>;
}
