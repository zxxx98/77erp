import { t as translate, getFormatLocale } from './i18n/index.js';
import { useEffect, useState } from 'react';
import { api } from './api.js';

// Scope every request explicitly and discard responses after filters or warehouse change.
export function useQuery(path, data, delay = 0) {
  const [state, setState] = useState({ result: null, error: '', loading: true });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!path || !data.warehouse_id) return;
    const controller = new AbortController();
    setState({ path, data, result: null, error: '', loading: true });
    const timer = setTimeout(() => {
      api(path, { warehouseId: data.warehouse_id, signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) setState({ path, data, result, error: '', loading: false }); })
        .catch(error => { if (!controller.signal.aborted) setState({ path, data, result: null, error: error.message, loading: false }); });
    }, delay);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [path, data, delay, retry]);
  const current = state.path === path && state.data === data;
  return { ...(current ? state : { result: null, error: '', loading: !!path }), retry: () => setRetry(value => value + 1) };
}

export function queryPath(path, values) {
  return `${path}?${new URLSearchParams(Object.entries(values).filter(([, value]) => value !== null && value !== undefined && value !== ''))}`;
}

export function usePagedQuery(path, data, field, delay = 0) {
  const [state, setState] = useState({ path: null, data: null, result: null, offset: 0, error: '', loading: true });
  const current = state.path === path && state.data === data;
  const offset = current ? state.offset : 0;
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!data.warehouse_id) return;
    const controller = new AbortController();
    setState(previous => ({ path, data, offset, result: previous.path === path && previous.data === data ? previous.result : null, error: '', loading: true }));
    const timer = setTimeout(() => {
      api(`${path}&limit=30&offset=${offset}`, { warehouseId: data.warehouse_id, signal: controller.signal })
        .then(result => {
          if (controller.signal.aborted) return;
          setState(previous => ({ path, data, offset, error: '', loading: false, result: {
            ...result, [field]: offset ? [...(previous.result?.[field] || []), ...result[field]] : result[field],
          } }));
        })
        .catch(error => { if (!controller.signal.aborted) setState(previous => ({ ...previous, error: error.message, loading: false })); });
    }, delay);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [path, data, field, offset, delay, revision]);
  return {
    result: current ? state.result : null, error: current ? state.error : '', loading: !current || state.loading,
    retry: () => setRevision(value => value + 1),
    loadMore: () => { if (current && !state.loading && state.result?.has_more) setState(previous => ({ ...previous, offset: previous.result.next_offset, loading: true })); },
  };
}
