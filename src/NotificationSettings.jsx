import { localizeError } from './i18n/errors.js';
import { t as translate, getFormatLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { ConfigProvider as AntConfigProvider } from 'antd';
import { Checkbox as AntCheckbox, Input as AntInput, Button as AntButton } from './ui/controls.jsx';

import { LoadingStatus } from './Loading.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Select } from './Dropdown.jsx';
import { notificationEvents, notificationFormats, notificationStatuses } from './i18n/display.js';
import './notifications.css';

export function NotificationSettings({ warehouses = [], active, onBusy, onDirty }) {
  useLocale();
  const [config, setConfig] = useState(null), [saved, setSaved] = useState('');
  const [url, setUrl] = useState(''), [secret, setSecret] = useState('');
  const [clearUrl, setClearUrl] = useState(false), [clearSecret, setClearSecret] = useState(false);
  const [logs, setLogs] = useState([]), [busy, setBusy] = useState(false);
  const [logsChanged, setLogsChanged] = useState(false);
  const logsSnapshot = useRef(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const lock = useRef(false);
  const dirty = !!config && (JSON.stringify(config) !== saved || !!url || !!secret || clearUrl || clearSecret);
  const keepsSecret = config?.has_secret && config.format === (saved ? JSON.parse(saved).format : '');
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    if (!active || config) return;
    let live = true;
    api('/settings/notifications').then(value => { if (live) { setConfig(value); setSaved(JSON.stringify(value)); } }).catch(e => { if (live) setError(localizeError(e.message)); });
    return () => { live = false; };
  }, [active, config]);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const load = async () => {
      const snapshot = logsSnapshot.current;
      try {
        const value = await api('/settings/notifications/deliveries');
        if (!live || snapshot !== logsSnapshot.current) return;
        const next = JSON.stringify(value);
        if (snapshot === null) { logsSnapshot.current = next; setLogs(value); }
        else setLogsChanged(next !== snapshot);
      } catch (e) { if (live && snapshot === null) setError(localizeError(e.message)); }
    };
    void load(); const timer = setInterval(load, 5000);
    return () => { live = false; clearInterval(timer); };
  }, [active]);
  const run = async action => {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy?.(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(localizeError(e.message)); }
    finally { lock.current = false; setBusy(false); onBusy?.(false); }
  };
  const field = (key, value) => { setConfig(c => ({ ...c, [key]: value })); setNotice(''); };
  const toggle = (key, value) => field(key, config[key].includes(value) ? config[key].filter(v => v !== value) : [...config[key], value]);
  const refreshLogs = async () => {
    const value = await api('/settings/notifications/deliveries');
    logsSnapshot.current = JSON.stringify(value); setLogs(value); setLogsChanged(false);
  };
  return <section className="notification-settings" aria-label={translate("system.notification.settings")}>
    <div className="settings-section-heading"><h3>{translate("system.webhook.notification")}</h3><p>{translate("system.select.the.type.of.notifications.you.want.to.receive.the.configuration")}</p></div>
    {config ? <>
      <div className="notification-fields">
        <AntCheckbox className="notification-choice" checked={config.enabled} disabled={busy} onChange={e => field('enabled', e.target.checked)}><span><strong>{translate("system.enable.webhook.notifications")}</strong><small>{translate("system.uncheck.and.save.to.stop.sending.business.notifications")}</small></span></AntCheckbox>
        <label>{translate("system.notification.format")}<Select aria-label={translate("system.notification.format")} value={config.format} disabled={busy} onChange={e => { field('format', e); setSecret(''); setClearSecret(false); }}>{notificationFormats.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</Select></label>
        <label>{translate("system.webhook.address")}<AntInput type="password" autoComplete="new-password" placeholder={config.has_url ? translate("system.saved.leave.blank.to.retain", { v0: config.destination }) : 'https://…'} maxLength={4096} value={url} disabled={busy || clearUrl} onChange={e => setUrl(e.target.value)} /></label>
        <small>{translate("system.fill.in.the.public.https.address.the.full.saved.address.and")}</small>
        {config.has_url && <AntCheckbox className="notification-choice" checked={clearUrl} disabled={busy || config.enabled} onChange={e => setClearUrl(e.target.checked)}><span>{translate("system.clear.saved.addresses.need.to.be.deactivated.first")}</span></AntCheckbox>}
        {config.format !== 'wecom' && <>
          <label>{translate("system.signing.key.optional")}<AntInput type="password" autoComplete="new-password" maxLength={4096} value={secret} disabled={busy || clearSecret} placeholder={keepsSecret ? translate("system.saved.leave.blank.to.retain.2") : translate("system.fill.in.the.key.when.the.robot.starts.signing")} onChange={e => setSecret(e.target.value)} /></label>
          <small>{translate("system.after.changing.the.notification.format.you.need.to.fill.in.the")}</small>
          {config.has_secret && <AntCheckbox className="notification-choice" checked={clearSecret} disabled={busy} onChange={e => setClearSecret(e.target.checked)}><span>{translate("system.clear.saved.keys")}</span></AntCheckbox>}
        </>}
        <AntConfigProvider componentDisabled={busy}><fieldset disabled={busy}><legend>{translate("system.notification.type")}</legend><div className="notification-choices">{notificationEvents.map(e => <AntCheckbox key={e.key} className="notification-choice" checked={config.events.includes(e.key)} onChange={() => toggle('events', e.key)}><span><strong>{e.label}</strong><small>{e.description}</small></span></AntCheckbox>)}</div></fieldset></AntConfigProvider>
        <AntConfigProvider componentDisabled={busy}><fieldset disabled={busy}><legend>{translate("system.notify.warehouse")}</legend>
          <AntCheckbox className="notification-choice" checked={!config.warehouse_ids.length} onChange={e => field('warehouse_ids', e.target.checked ? [] : warehouses.length ? [warehouses[0].id] : [])}><span>{translate("system.all.warehouses.including.warehouses.added.in.the.future")}</span></AntCheckbox>
          <div className="notification-choices">{warehouses.map(w => <AntCheckbox key={w.id} className="notification-choice" checked={config.warehouse_ids.includes(w.id)} onChange={() => toggle('warehouse_ids', w.id)}><span>{w.name}</span></AntCheckbox>)}</div>
          <small>{translate("system.notify.all.warehouses.when.no.warehouse.is.specified.key.management.operations")}</small>
        </fieldset></AntConfigProvider>
        <AntCheckbox className="notification-choice" checked={config.include_amounts} disabled={busy} onChange={e => field('include_amounts', e.target.checked)}><span><strong>{translate("system.amount.shown.in.notification")}</strong><small>{translate("system.contains.document.amounts.receipts.and.payments.and.daily.summary.amounts.please")}</small></span></AntCheckbox>
        {config.events.includes('daily_summary') && <div className="notification-schedule"><label>{translate("system.daily.summary.time")}<AntInput type="time" value={config.daily_time} disabled={busy} onChange={e => field('daily_time', e.target.value)} /></label><label>{translate("system.summary.time.zone")}<AntInput value={config.timezone} maxLength={100} placeholder="Asia/Shanghai" disabled={busy} onChange={e => field('timezone', e.target.value)} /></label><small>{translate("system.summarize.the.data.from.zero.o.clock.on.the.day.to")}</small></div>}
        <small>{translate("system.each.save.will.cancel.the.notification.that.the.old.configuration.has")}</small>
        <div className="notification-actions"><AntButton type="primary" htmlType="button" className="btn btn-primary" disabled={busy} onClick={() => void run(async () => {
          const value = await api('/settings/notifications', { method: 'PUT', body: { ...config, url, secret, clear_url: clearUrl, clear_secret: clearSecret } });
          setConfig(value); setSaved(JSON.stringify(value)); setUrl(''); setSecret(''); setClearUrl(false); setClearSecret(false); setNotice(translate("system.notification.settings.saved")); await refreshLogs();
        })}>{busy ? <LoadingStatus size={20}>{translate("system.processing")}</LoadingStatus> : translate("system.save.notification.settings")}</AntButton>
        <AntButton type="default" htmlType="button" className="btn" disabled={busy || dirty || !config.has_url} onClick={() => void run(async () => { await api('/settings/notifications/test', { method: 'POST', body: { version: config.version } }); setNotice(translate("system.the.test.notification.has.been.added.to.the.sending.queue.please")); await refreshLogs(); })}>{translate("system.send.test.notification")}</AntButton></div>
        <small>{translate("system.save.first.and.then.test.test.notifications.are.not.restricted.by")}</small>
      </div>
      <div className="notification-log-heading"><h3>{translate("system.recently.sent.records")}</h3><AntButton type="default" htmlType="button" className="btn" disabled={busy} onClick={() => void run(refreshLogs)}>{translate("system.refresh.record")}</AntButton></div>
      {logsChanged && <div className="data-update-notice" role="status">{translate("system.if.there.are.changes.in.the.sending.record.click.refresh.record")}</div>}
      <p className="notification-help">{translate("system.automatically.retry.after.failure.up.to.5.times.the.latest.50")}</p>
      <div className="notification-logs">{logs.length ? logs.map(log => <article key={log.id} data-delivery-id={log.id}>
        <div><strong>{labelsFor(log.event)}</strong><span>{notificationStatuses[log.status] || log.status}</span></div>
        <small>{new Date(log.created_at).toLocaleString(getFormatLocale())}{" "}{translate("system.tried")}{" "}{log.attempts}{" "}{translate("system.times")}</small>
        {log.last_error && <p>{log.last_error}</p>}
        {['failed', 'retry'].includes(log.status) && <AntButton type="default" htmlType="button" className="btn" disabled={busy} onClick={() => void run(async () => { await api(`/settings/notifications/deliveries/${log.id}/retry`, { method: 'POST', body: {} }); await refreshLogs(); })}>{translate("system.retry.sending")}</AntButton>}
      </article>) : <p>{translate("system.no.sending.record.yet")}</p>}</div>
    </> : !error && <p><LoadingStatus>{translate("system.reading.notification.settings")}</LoadingStatus></p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
function labelsFor(event) { return notificationEvents.find(e => e.key === event)?.label || translate("system.test.notification"); }
