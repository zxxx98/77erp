import { localizeError } from '../i18n/errors.js';
import { t as translate, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Form as AntForm } from 'antd';
import { Button as AntButton, Input as AntInput, Checkbox as AntCheckbox } from '../ui/controls.jsx';
import { FormField } from './../ui/FormField.jsx';

import { useEffect, useMemo, useState } from 'react';
import { Megaphone, Pin, Plus, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { useQuery } from '../queries.js';
import { announcementsChanged, useAnnouncementQuery } from '../announcement-query.js';
import { usePermissions } from '../permissions.jsx';
import { Button, Modal, PageHeading } from '../components/common.jsx';
import { LoadingStatus } from '../Loading.jsx';
import './announcements.css';

const formatDate = value => new Date(value).toLocaleString(getFormatLocale(), { hour12: false });
function ErrorNotice({ children, retry }) {
  useLocale();
  return children ? <div className="announcement-error" role="alert"><span>{children}</span>{retry && <Button onClick={retry} icon={RefreshCw}>{translate("system.reload")}</Button>}</div> : null;
}

export function Announcements({ data, openModal }) {
  useLocale();
  const { user } = usePermissions();
  const [unread, setUnread] = useState(false);
  const [offset, setOffset] = useState(0);
  const query = useAnnouncementQuery(`/announcements?unread=${unread}&offset=${offset}&limit=20`, data);
  const result = query.result;
  useEffect(() => {
    if (result && offset > 0 && !result.announcements.length) setOffset(Math.max(0, offset - 20));
  }, [result, offset]);
  return <div className="announcements-page">
    <PageHeading title={translate("system.announcements")} description={translate("system.view.team.announcements.shared.by.all.repositories")}>
      {user.role === 'admin' && <Button kind="primary" icon={Plus} onClick={() => openModal({ kind: 'announcementEditor' })}>{translate("system.make.an.announcement")}</Button>}
    </PageHeading>
    <div className="announcement-toolbar">
      <div className="segmented" role="group" aria-label={translate("system.announcement.screening")}>
        <AntButton type="text" htmlType="button" aria-pressed={!unread} className={!unread ? 'active' : ''} onClick={() => { setUnread(false); setOffset(0); }}>{translate("system.all.announcements")}</AntButton>
        <AntButton type="text" htmlType="button" aria-pressed={unread} className={unread ? 'active' : ''} onClick={() => { setUnread(true); setOffset(0); }}>{translate("system.see.only.unread")}{result ? `（${result.unread_count}）` : ''}</AntButton>
      </div>
      <Button icon={RefreshCw} onClick={announcementsChanged} busy={query.loading}>{translate("system.refresh.announcement")}</Button>
    </div>
    <ErrorNotice retry={query.retry}>{query.error}</ErrorNotice>
    {query.loading && <LoadingStatus>{translate("system.reading.announcement")}</LoadingStatus>}
    {result && <>
      <div className="announcement-list">
        {result.announcements.map(item => <AntButton type="text" htmlType="button" key={item.id} className="announcement-card" onClick={() => openModal({ kind: 'announcementDetail', id: item.id })}>
          <div className="announcement-card-heading">
            {!!item.pinned && <span className="announcement-tag"><Pin size={13} />{translate("system.pin.to.top")}</span>}
            <strong>{item.title}</strong><span className={`announcement-state${item.unread ? ' unread' : ''}`}>{item.unread ? translate("system.unread") : translate("system.read")}</span>
          </div>
          <p>{item.excerpt}</p>
          <span className="announcement-meta">{item.created_by_name} · {formatDate(item.created_at)}</span>
        </AntButton>)}
      </div>
      {!result.announcements.length && <div className="announcement-empty"><Megaphone size={32} /><h2>{unread ? translate("system.no.unread.announcements.yet") : translate("system.no.announcement.yet")}</h2><p>{unread ? translate("system.new.announcements.will.appear.here") : user.role === 'admin' ? translate("system.make.the.first.announcement.to.keep.the.team.up.to.date") : translate("system.announcements.posted.by.administrators.will.be.displayed.here")}</p></div>}
      {result.total > 0 && <div className="announcement-pagination"><span>{translate("system.total.2")}{" "}{result.total}{" "}{translate("system.article.article")}{" "}{offset / 20 + 1}{" "}{translate("system.page")}</span><Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>{translate("system.previous.page")}</Button><Button disabled={!result.has_more} onClick={() => setOffset(offset + 20)}>{translate("system.next.page")}</Button></div>}
    </>}
  </div>;
}

export function AnnouncementDetail({ id, data, onClose, onEdit, onSaved, onRead }) {
  useLocale();
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
    if (!window.confirm(translate("system.delete.announcement.it.cannot.be.restored.after.deletion", { v0: item.title }))) return;
    setBusy(true); setError('');
    try { await api(`/announcements/${id}`, { method: 'DELETE', body: { version: item.version } }); onSaved(translate("system.announcement.has.been.deleted")); }
    catch (error) { setError(localizeError(error.message)); }
    finally { setBusy(false); }
  };
  return <Modal title={translate("system.announcement.details")} className="announcement-modal" onClose={busy ? () => {} : onClose}>
    <div className="form-body announcement-detail">
      <ErrorNotice retry={query.retry}>{query.error}</ErrorNotice>
      {query.loading && <LoadingStatus>{translate("system.reading.announcement")}</LoadingStatus>}
      {item && <><h2>{!!item.pinned && <Pin size={18} />}{item.title}</h2><p className="announcement-meta">{item.created_by_name}{" "}{translate("system.published.in")}{" "}{formatDate(item.created_at)}</p>{item.content_version > 1 && <p className="announcement-meta">{translate("system.updated.on")}{" "}{formatDate(item.updated_at)}</p>}<div className="announcement-content">{item.content}</div></>}
      <ErrorNotice retry={query.retry}>{readError}</ErrorNotice><ErrorNotice>{error}</ErrorNotice>
    </div>
    <div className="modal-footer">{item && user.role === 'admin' && <><Button kind="danger" busy={busy} onClick={remove}>{translate("system.delete.announcement")}</Button><Button disabled={busy} onClick={() => onEdit(item)}>{translate("system.editorial.notice")}</Button></>}<Button onClick={onClose} disabled={busy}>{translate("system.close")}</Button></div>
  </Modal>;
}

export function AnnouncementEditor({ item, onClose, onSaved }) {
  useLocale();
  const [title, setTitle] = useState(item?.title || '');
  const [content, setContent] = useState(item?.content || '');
  const [pinned, setPinned] = useState(!!item?.pinned);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {

    if (busy) return;
    setBusy(true); setError('');
    try {
      await api(item ? `/announcements/${item.id}` : '/announcements', { method: item ? 'PUT' : 'POST', body: { title, content, pinned, ...(item ? { version: item.version } : {}) } });
      onSaved(item ? translate("system.announcement.has.been.updated") : translate("system.announcement.has.been.released"));
    } catch (error) { setError(localizeError(error.message)); }
    finally { setBusy(false); }
  };
  return <Modal title={item ? translate("system.editorial.notice") : translate("system.make.an.announcement")} subtitle={translate("system.visible.to.all.logged.in.users.and.all.warehouses")} onClose={busy ? () => {} : onClose}>
    <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }} onFinish={submit}>
      <div className="form-body announcement-editor">
        <label><span>{translate("system.announcement.title")}</span><FormField value={title} required maxLength={100}><AntInput value={title} onChange={event => setTitle(event.target.value)} maxLength={100}  disabled={busy} placeholder={translate("system.for.example.month.end.inventory.arrangement")} /></FormField></label>
        <label><span>{translate("system.announcement.text")}</span><FormField value={content} required maxLength={10000} label={translate("system.announcement.text")}><AntInput.TextArea aria-label={translate("system.announcement.text")} value={content} onChange={event => setContent(event.target.value)} maxLength={10000}  disabled={busy} rows={10} placeholder={translate("system.fill.in.what.you.need.to.tell.your.team")} /></FormField><small>{content.length}{" "}{translate("system.10.000.words")}</small></label>
        <AntCheckbox  checked={pinned} onChange={event => setPinned(event.target.checked)} disabled={busy}><span>{translate("system.pinned.announcement")}</span></AntCheckbox>
        <ErrorNotice>{error}</ErrorNotice>
      </div>
      <div className="modal-footer"><Button type="button" disabled={busy} onClick={onClose}>{translate("system.cancel")}</Button><Button type="submit" kind="primary" busy={busy} disabled={!title.trim() || !content.trim()}>{item ? translate("system.save.changes") : translate("system.confirm.release")}</Button></div>
    </AntForm>
  </Modal>;
}
