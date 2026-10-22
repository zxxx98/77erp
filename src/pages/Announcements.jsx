import { useEffect, useMemo, useState } from 'react';
import { Megaphone, Pin, Plus, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { useQuery } from '../queries.js';
import { announcementsChanged, useAnnouncementQuery } from '../announcement-query.js';
import { usePermissions } from '../permissions.jsx';
import { Button, Modal, PageHeading } from '../components/common.jsx';
import { LoadingStatus } from '../Loading.jsx';
import './announcements.css';

const formatDate = value => new Date(value).toLocaleString('zh-CN', { hour12: false });
function ErrorNotice({ children, retry }) {
  return children ? <div className="announcement-error" role="alert"><span>{children}</span>{retry && <Button onClick={retry} icon={RefreshCw}>重新加载</Button>}</div> : null;
}

export function Announcements({ data, openModal }) {
  const { user } = usePermissions();
  const [unread, setUnread] = useState(false);
  const [offset, setOffset] = useState(0);
  const query = useAnnouncementQuery(`/announcements?unread=${unread}&offset=${offset}&limit=20`, data);
  const result = query.result;
  useEffect(() => {
    if (result && offset > 0 && !result.announcements.length) setOffset(Math.max(0, offset - 20));
  }, [result, offset]);
  return <div className="announcements-page">
    <PageHeading title="公告中心" description="查看团队公告，所有仓库共用。">
      {user.role === 'admin' && <Button kind="primary" icon={Plus} onClick={() => openModal({ kind: 'announcementEditor' })}>发布公告</Button>}
    </PageHeading>
    <div className="announcement-toolbar">
      <div className="segmented" role="group" aria-label="公告筛选">
        <button type="button" aria-pressed={!unread} className={!unread ? 'active' : ''} onClick={() => { setUnread(false); setOffset(0); }}>全部公告</button>
        <button type="button" aria-pressed={unread} className={unread ? 'active' : ''} onClick={() => { setUnread(true); setOffset(0); }}>只看未读{result ? `（${result.unread_count}）` : ''}</button>
      </div>
      <Button icon={RefreshCw} onClick={announcementsChanged} busy={query.loading}>刷新公告</Button>
    </div>
    <ErrorNotice retry={query.retry}>{query.error}</ErrorNotice>
    {query.loading && <LoadingStatus>正在读取公告…</LoadingStatus>}
    {result && <>
      <div className="announcement-list">
        {result.announcements.map(item => <button type="button" key={item.id} className="announcement-card" onClick={() => openModal({ kind: 'announcementDetail', id: item.id })}>
          <div className="announcement-card-heading">
            {!!item.pinned && <span className="announcement-tag"><Pin size={13} />置顶</span>}
            <strong>{item.title}</strong><span className={`announcement-state${item.unread ? ' unread' : ''}`}>{item.unread ? '未读' : '已读'}</span>
          </div>
          <p>{item.excerpt}</p>
          <span className="announcement-meta">{item.created_by_name} · {formatDate(item.created_at)}</span>
        </button>)}
      </div>
      {!result.announcements.length && <div className="announcement-empty"><Megaphone size={32} /><h2>{unread ? '暂无未读公告' : '暂无公告'}</h2><p>{unread ? '新的公告会在这里显示。' : user.role === 'admin' ? '发布第一条公告，让团队及时了解最新安排。' : '管理员发布公告后会在这里显示。'}</p></div>}
      {result.total > 0 && <div className="announcement-pagination"><span>共 {result.total} 条 · 第 {offset / 20 + 1} 页</span><Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>上一页</Button><Button disabled={!result.has_more} onClick={() => setOffset(offset + 20)}>下一页</Button></div>}
    </>}
  </div>;
}

export function AnnouncementDetail({ id, data, onClose, onEdit, onSaved, onRead }) {
  const { user } = usePermissions();
  // A read receipt refreshes the workspace baseline, but must not reload the open detail.
  const queryScope = useMemo(() => ({ warehouse_id: data.warehouse_id }), [data.warehouse_id]);
  const query = useQuery(`/announcements/${id}`, queryScope);
  const item = query.result;
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!item?.unread) return;
    const controller = new AbortController();
    setReadError('');
    api(`/announcements/${id}/read`, { method: 'POST', body: { content_version: item.content_version }, signal: controller.signal })
      .then(() => {
        if (controller.signal.aborted) return;
        announcementsChanged();
        // Reading changes the user's data revision too; reload its baseline along with the page data.
        return onRead();
      })
      .catch(error => { if (!controller.signal.aborted) setReadError(error.message); });
    return () => controller.abort();
  }, [id, item]);
  const remove = async () => {
    if (!window.confirm(`删除公告“${item.title}”？删除后无法恢复。`)) return;
    setBusy(true); setError('');
    try { await api(`/announcements/${id}`, { method: 'DELETE', body: { version: item.version } }); onSaved('公告已删除'); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  };
  return <Modal title="公告详情" className="announcement-modal" onClose={busy ? () => {} : onClose}>
    <div className="form-body announcement-detail">
      <ErrorNotice retry={query.retry}>{query.error}</ErrorNotice>
      {query.loading && <LoadingStatus>正在读取公告…</LoadingStatus>}
      {item && <><h2>{!!item.pinned && <Pin size={18} />}{item.title}</h2><p className="announcement-meta">{item.created_by_name} · 发布于 {formatDate(item.created_at)}</p>{item.content_version > 1 && <p className="announcement-meta">更新于 {formatDate(item.updated_at)}</p>}<div className="announcement-content">{item.content}</div></>}
      <ErrorNotice retry={query.retry}>{readError}</ErrorNotice><ErrorNotice>{error}</ErrorNotice>
    </div>
    <div className="modal-footer">{item && user.role === 'admin' && <><Button kind="danger" busy={busy} onClick={remove}>删除公告</Button><Button disabled={busy} onClick={() => onEdit(item)}>编辑公告</Button></>}<Button onClick={onClose} disabled={busy}>关闭</Button></div>
  </Modal>;
}

export function AnnouncementEditor({ item, onClose, onSaved }) {
  const [title, setTitle] = useState(item?.title || '');
  const [content, setContent] = useState(item?.content || '');
  const [pinned, setPinned] = useState(!!item?.pinned);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      await api(item ? `/announcements/${item.id}` : '/announcements', { method: item ? 'PUT' : 'POST', body: { title, content, pinned, ...(item ? { version: item.version } : {}) } });
      onSaved(item ? '公告已更新' : '公告已发布');
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  };
  return <Modal title={item ? '编辑公告' : '发布公告'} subtitle="所有登录用户、所有仓库可见" onClose={busy ? () => {} : onClose}>
    <form onSubmit={submit}>
      <div className="form-body announcement-editor">
        <label><span>公告标题</span><input value={title} onChange={event => setTitle(event.target.value)} maxLength={100} required disabled={busy} placeholder="例如：月末盘点安排" /></label>
        <label><span>公告正文</span><textarea aria-label="公告正文" value={content} onChange={event => setContent(event.target.value)} maxLength={10000} required disabled={busy} rows={10} placeholder="填写需要告知团队的内容…" /><small>{content.length} / 10,000 字</small></label>
        <label><input type="checkbox" checked={pinned} onChange={event => setPinned(event.target.checked)} disabled={busy} /><span>置顶公告</span></label>
        <ErrorNotice>{error}</ErrorNotice>
      </div>
      <div className="modal-footer"><Button type="button" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" kind="primary" busy={busy} disabled={!title.trim() || !content.trim()}>{item ? '保存修改' : '确认发布'}</Button></div>
    </form>
  </Modal>;
}
