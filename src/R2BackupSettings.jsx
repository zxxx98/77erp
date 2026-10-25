import { localizeError } from './i18n/errors.js';
import { t as translate, getFormatLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { FormField } from './ui/FormField.jsx';
import { Checkbox as AntCheckbox, Input as AntInput, Button as AntButton } from './ui/controls.jsx';

import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import './notifications.css';

export function R2BackupSettings({ active, onBusy, onDirty }) {
  useLocale();
  const [config, setConfig] = useState(null), [saved, setSaved] = useState(''), [credentials, setCredentials] = useState({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const lock = useRef(false);
  const dirty = !!config && (JSON.stringify(config) !== saved || Object.values(credentials).some(Boolean));
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    if (!active || config) return;
    let live = true;
    api('/settings/r2-backup').then(c => { if (live) { setConfig(c); setSaved(JSON.stringify(c)); } }).catch(e => { if (live) setError(localizeError(e.message)); });
    return () => { live = false; };
  }, [active, config]);
  const run = async action => {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy?.(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(localizeError(e.message)); }
    finally { lock.current = false; setBusy(false); onBusy?.(false); }
  };
  const field = (key, value) => setConfig(c => ({ ...c, [key]: value }));
  return <section className="notification-settings r2-backup-settings" aria-label={translate("system.r2.automatic.backup")}>
    <div className="settings-section-heading"><h3>{translate("system.cloudflare.r2.automatic.backup")}</h3><p>{translate("system.full.sqlite.online.backup.including.all.repositories.accounts.and.system.credentials")}</p></div>
    {config && <div className="notification-fields">
      <AntCheckbox className="notification-choice" checked={config.enabled} disabled={busy} onChange={e => field('enabled', e.target.checked)}><span>{translate("system.enable.scheduled.backup")}</span></AntCheckbox>
      {[['account_id', 'Cloudflare Account ID', translate("system.32.digit.account.id")], ['bucket', translate("system.r2.bucket"), translate("system.pre.created.private.bucket")], ['prefix', translate("system.backup.directory.prefix"), '77erp'], ['cron', translate("system.cron.expression.five.paragraphs"), '0 2 * * *'], ['timezone', translate("system.execution.time.zone"), 'Asia/Shanghai']].map(([key, label, placeholder]) => <label key={key}>{label}<AntInput value={config[key]} maxLength={200} placeholder={placeholder} disabled={busy} onChange={e => field(key, e.target.value)} /></label>)}
      <label>{translate("system.excel.directory.prefix")}<FormField value={config.excel_prefix || ''} required maxLength={200} label={translate("system.excel.directory.prefix")}><AntInput  value={config.excel_prefix || ''} maxLength={200} placeholder="excel" disabled={busy} onChange={e => field('excel_prefix', e.target.value)} /></FormField><small>{translate("system.the.original.excel.of.the.acceptance.form.uses.this.independent.directory")}</small></label>
      <small>{translate("system.cron.order.minute.hour.day.month.week.for.example.0.2")}</small>
      {[['access_key', 'R2 Access Key ID'], ['secret_key', 'R2 Secret Access Key']].map(([key, label]) => <React.Fragment key={key}>
        <label>{label}<AntInput type="password" autoComplete="new-password" maxLength={4096} disabled={busy || credentials[`clear_${key}`]} value={credentials[key] || ''} placeholder={config[`has_${key}`] ? translate("system.saved.leave.blank.to.retain.2") : translate("system.not.configured.yet")} onChange={e => setCredentials(c => ({ ...c, [key]: e.target.value }))} /></label>
        {config[`has_${key}`] && <AntCheckbox className="notification-choice" disabled={busy} checked={!!credentials[`clear_${key}`]} onChange={e => setCredentials(c => ({ ...c, [`clear_${key}`]: e.target.checked }))}><span>{translate("system.clear")}{label}</span></AntCheckbox>}
      </React.Fragment>)}
      <small>{translate("system.r2.credentials.require.object.read.and.write.permissions.including.enumeration.deletion")}</small>
      <div className="notification-actions"><AntButton type="primary" htmlType="button" className="btn btn-primary" disabled={busy} onClick={() => void run(async () => {
        const c = await api('/settings/r2-backup', { method: 'PUT', body: { ...config, ...credentials } });
        setConfig(c); setSaved(JSON.stringify(c)); setCredentials({}); setNotice(translate("system.r2.backup.settings.saved"));
      })}>{translate("system.save.backup.settings")}</AntButton>
      <AntButton type="default" htmlType="button" className="btn" disabled={busy || dirty} onClick={() => void run(async () => {
        const result = await api('/settings/r2-backup/run', { method: 'POST', body: { version: config.version } });
        setNotice(translate("system.backup.successful", { v0: result.object_key, v1: result.warning ? `；${result.warning}` : "" }));
      })}>{busy ? translate("system.processing") : translate("system.back.up.now")}</AntButton></div>
      <small>{translate("system.save.first.and.then.back.up.immediately.you.can.still.execute")}</small>
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <p className="notification-help">{translate("system.to.restore.the.complete.database.you.need.to.stop.the.service")}</p>
  </section>;
}
