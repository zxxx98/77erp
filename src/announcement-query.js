import { useEffect, useRef } from 'react';
import { useQuery } from './queries.js';

export const announcementsChanged = () => window.dispatchEvent(new Event('erp:announcements-changed'));

export function useAnnouncementQuery(path, data, poll = false) {
  const query = useQuery(path, data);
  const retry = useRef(query.retry);
  retry.current = query.retry;
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible' && navigator.onLine) retry.current(); };
    window.addEventListener('erp:announcements-changed', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = poll ? setInterval(refresh, 60000) : null;
    return () => {
      window.removeEventListener('erp:announcements-changed', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
      if (timer) clearInterval(timer);
    };
  }, [poll]);
  return query;
}
