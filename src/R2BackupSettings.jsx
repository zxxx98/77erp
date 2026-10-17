import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import './notifications.css';

export function R2BackupSettings({ active, onBusy, onDirty }) {
  const [config, setConfig] = useState(null), [saved, setSaved] = useState(''), [credentials, setCredentials] = useState({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const lock = useRef(false);
  const dirty = !!config && (JSON.stringify(config) !== saved || Object.values(credentials).some(Boolean));
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    if (!active || config) return;
    let live = true;
    api('/settings/r2-backup').then(c => { if (live) { setConfig(c); setSaved(JSON.stringify(c)); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [active, config]);
  const run = async action => {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy?.(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(false); onBusy?.(false); }
  };
  const field = (key, value) => setConfig(c => ({ ...c, [key]: value }));
  return <section className="notification-settings r2-backup-settings" aria-label="R2 自动备份">
    <div className="settings-section-heading"><h3>Cloudflare R2 自动备份</h3><p>完整 SQLite 在线备份，包含所有仓库、账号和系统凭据。请使用私有存储桶；图片文件仍需在图床保留。</p></div>
    {config && <div className="notification-fields">
      <label className="notification-choice"><input type="checkbox" checked={config.enabled} disabled={busy} onChange={e => field('enabled', e.target.checked)} /><span>启用定时备份</span></label>
      {[['account_id', 'Cloudflare Account ID', '32 位账户 ID'], ['bucket', 'R2 存储桶', '预先创建的私有存储桶'], ['prefix', '备份目录前缀', '77erp'], ['cron', 'Cron 表达式（五段）', '0 2 * * *'], ['timezone', '执行时区', 'Asia/Shanghai']].map(([key, label, placeholder]) => <label key={key}>{label}<input value={config[key]} maxLength={200} placeholder={placeholder} disabled={busy} onChange={e => field(key, e.target.value)} /></label>)}
      <small>Cron 顺序：分 时 日 月 周。例如 0 2 * * * 为每天 02:00，0 * * * * 为每小时。服务需保持运行；停机错过的计划不补跑。每次成功上传后自动保留当前目录内最新 10 个备份，超出的旧备份会被删除。</small>
      {[['access_key', 'R2 Access Key ID'], ['secret_key', 'R2 Secret Access Key']].map(([key, label]) => <React.Fragment key={key}>
        <label>{label}<input type="password" autoComplete="new-password" maxLength={4096} disabled={busy || credentials[`clear_${key}`]} value={credentials[key] || ''} placeholder={config[`has_${key}`] ? '已保存，留空保留' : '尚未配置'} onChange={e => setCredentials(c => ({ ...c, [key]: e.target.value }))} /></label>
        {config[`has_${key}`] && <label className="notification-choice"><input type="checkbox" disabled={busy} checked={!!credentials[`clear_${key}`]} onChange={e => setCredentials(c => ({ ...c, [`clear_${key}`]: e.target.checked }))} /><span>清除{label}</span></label>}
      </React.Fragment>)}
      <small>R2 凭据需要目标存储桶的对象读写权限（含列举、删除）。如需备份结果通知，请在「通知设置」启用 Webhook 并勾选「数据库备份」。</small>
      <div className="notification-actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(async () => {
        const c = await api('/settings/r2-backup', { method: 'PUT', body: { ...config, ...credentials } });
        setConfig(c); setSaved(JSON.stringify(c)); setCredentials({}); setNotice('R2 备份设置已保存。');
      })}>保存备份设置</button>
      <button type="button" className="btn" disabled={busy || dirty} onClick={() => void run(async () => {
        const result = await api('/settings/r2-backup/run', { method: 'POST', body: { version: config.version } });
        setNotice(`备份成功：${result.object_key}${result.warning ? `；${result.warning}` : ""}`);
      })}>{busy ? '处理中…' : '立即备份'}</button></div>
      <small>先保存再立即备份；关闭定时备份后仍可手动执行。</small>
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <p className="notification-help">恢复完整数据库需先停止服务，再替换数据库文件并处理旧 WAL/SHM 文件，详见部署文档。下方 JSON 恢复入口仅支持业务 JSON 备份。</p>
  </section>;
}
