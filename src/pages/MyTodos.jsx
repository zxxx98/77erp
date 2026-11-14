import { useEffect, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { useQuery, queryPath } from '../queries.js';
import { Button, QueryStatus } from '../components/common.jsx';
import { Input } from '../ui/controls.jsx';
import { t } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { dateTime } from '../app/format.js';
import { localizeError } from '../i18n/errors.js';
import '../todos.css';

export function MyTodos({ data, onOpen }) {
  useLocale();
  const [q, setQ] = useState(''), [offset, setOffset] = useState(0), [opening, setOpening] = useState(false), [error, setError] = useState('');
  const list = useQuery(queryPath('/todos', { q, offset, limit: 20 }), data, q ? 200 : 0);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden' && navigator.onLine !== false) list.retry(); };
    const timer = setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    window.addEventListener('erp:business-changed', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('erp:business-changed', refresh); };
  }, [q,offset,data]);
  useEffect(() => { if (list.result && offset && offset >= list.result.total) setOffset(Math.max(0, (Math.ceil(list.result.total / 20) - 1) * 20)); }, [list.result,offset]);
  const open = async item => {
    setOpening(true); setError('');
    try { await onOpen(item); } catch (e) { setError(localizeError(e.message)); }
    finally { setOpening(false); }
  };
  return <section className="panel my-todos" aria-label={t('todos.title')}>
    <div className="todo-heading"><h1><ClipboardCheck size={24} />{t('todos.title')}</h1><Button disabled={list.loading || opening} onClick={list.retry}>{t('stockApproval.refresh')}</Button></div>
    <p className="material-muted">{t('todos.description')}</p>
    <Input type="search" maxLength={100} aria-label={t('todos.search')} placeholder={t('todos.search')} value={q} onChange={e => { setQ(e.target.value); setOffset(0); }} />
    <QueryStatus query={list} />
    {error && <p role="alert" className="form-error">{error}</p>}
    {list.result && <p className="todo-total">{t('todos.total', { count: list.result.total })}</p>}
    <ul className="todo-list">{list.result?.items.map(item => <li key={`${item.source}:${item.source_id}`}>
      <div><strong>{item.number}</strong><span className="todo-kind">{t(`todos.kind.${item.kind}`)}</span><p>{item.title} · {item.warehouse_name}</p><small>{item.submitter_name} · {dateTime(item.created_at)}</small></div>
      <Button disabled={opening} onClick={() => open(item)}>{t('warehouse.view.and.approve')}</Button>
    </li>)}</ul>
    {list.result && !list.result.total && <div className="todo-empty"><ClipboardCheck size={36} /><p>{t(q ? 'todos.noMatch' : 'todos.empty')}</p></div>}
    {list.result && (offset > 0 || list.result.has_more) && <div className="todo-pagination"><Button disabled={opening || list.loading || !offset} onClick={() => setOffset(value => Math.max(0,value-20))}>{t('stockApproval.previous')}</Button><span>{t('stockApproval.page', { total: list.result.total, page: offset/20+1 })}</span><Button disabled={opening || list.loading || !list.result.has_more} onClick={() => setOffset(value => value+20)}>{t('stockApproval.next')}</Button></div>}
  </section>;
}
