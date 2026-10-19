import { useEffect, useRef } from 'react';
import { useQuery } from './queries.js';

export const announcementsChanged = () => window.dispatchEvent(new Event('erp:announcements-changed'));

export function useAnnouncementQuery(path, data) {
  const query = useQuery(path, data);
  const retry = useRef(query.retry);
  retry.current = query.retry;
  useEffect(() => {
    const refresh = () => retry.current();
    window.addEventListener('erp:announcements-changed', refresh);
    return () => {
      window.removeEventListener('erp:announcements-changed', refresh);
    };
  }, []);
  return query;
}
