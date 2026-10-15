import { LoadingStatus } from './Loading.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Select } from './Dropdown.jsx';
import { notificationEvents, notificationFormats, notificationStatuses } from '../shared/notifications.js';
import './notifications.css';

export function NotificationSettings({ warehouses = [], active, onBusy, onDirty }) {
  const [config, setConfig] = useState(null), [saved, setSaved] = useState('');
  const [url, setUrl] = useState(''), [secret, setSecret] = useState('');
  const [clearUrl, setClearUrl] = useState(false), [clearSecret, setClearSecret] = useState(false);
  const [logs, setLogs] = useState([]), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const lock = useRef(false);
  const dirty = !!config && (JSON.stringify(config) !== saved || !!url || !!secret || clearUrl || clearSecret);
  const keepsSecret = config?.has_secret && config.format === (saved ? JSON.parse(saved).format : '');
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    if (!active || config) return;
    let live = true;
    api('/settings/notifications').then(value => { if (live) { setConfig(value); setSaved(JSON.stringify(value)); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [active, config]);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const load = () => api('/settings/notifications/deliveries').then(value => { if (live) setLogs(value); }).catch(e => { if (live) setError(e.message); });
    void load(); const timer = setInterval(load, 5000);
    return () => { live = false; clearInterval(timer); };
  }, [active]);
  const run = async action => {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy?.(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(false); onBusy?.(false); }
  };
  const field = (key, value) => { setConfig(c => ({ ...c, [key]: value })); setNotice(''); };
  const toggle = (key, value) => field(key, config[key].includes(value) ? config[key].filter(v => v !== value) : [...config[key], value]);
  const refreshLogs = async () => setLogs(await api('/settings/notifications/deliveries'));
  return <section className="notification-settings" aria-label="通知设置">
    <div className="settings-section-heading"><h3>Webhook 通知</h3><p>选择需要接收的通知类型。配置由所有设备共用，仅管理员可修改。</p></div>
    {config ? <>
      <div className="notification-fields">
        <label className="notification-choice"><input type="checkbox" checked={config.enabled} disabled={busy} onChange={e => field('enabled', e.target.checked)} /><span><strong>启用 Webhook 通知</strong><small>取消勾选并保存后停止发送业务通知。</small></span></label>
        <label>通知格式<Select value={config.format} disabled={busy} onChange={e => { field('format', e.target.value); setSecret(''); setClearSecret(false); }}>{notificationFormats.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</Select></label>
        <label>Webhook 地址<input type="password" autoComplete="new-password" placeholder={config.has_url ? `已保存（${config.destination}），留空保留` : 'https://…'} maxLength={4096} value={url} disabled={busy || clearUrl} onChange={e => setUrl(e.target.value)} /></label>
        <small>填写公网 HTTPS 地址。已保存的完整地址和密钥不会显示在页面或业务备份中。</small>
        {config.has_url && <label className="notification-choice"><input type="checkbox" checked={clearUrl} disabled={busy || config.enabled} onChange={e => setClearUrl(e.target.checked)} /><span>清除已保存地址（需先取消启用）</span></label>}
        {config.format !== 'wecom' && <>
          <label>签名密钥（选填）<input type="password" autoComplete="new-password" maxLength={4096} value={secret} disabled={busy || clearSecret} placeholder={keepsSecret ? '已保存，留空保留' : '机器人开启加签时填写密钥'} onChange={e => setSecret(e.target.value)} /></label>
          <small>更换通知格式后，需重新填写签名密钥。</small>
          {config.has_secret && <label className="notification-choice"><input type="checkbox" checked={clearSecret} disabled={busy} onChange={e => setClearSecret(e.target.checked)} /><span>清除已保存密钥</span></label>}
        </>}
        <fieldset disabled={busy}><legend>通知类型</legend><div className="notification-choices">{notificationEvents.map(e => <label key={e.key} className="notification-choice"><input type="checkbox" checked={config.events.includes(e.key)} onChange={() => toggle('events', e.key)} /><span><strong>{e.label}</strong><small>{e.description}</small></span></label>)}</div></fieldset>
        <fieldset disabled={busy}><legend>通知仓库</legend>
          <label className="notification-choice"><input type="checkbox" checked={!config.warehouse_ids.length} onChange={e => field('warehouse_ids', e.target.checked ? [] : warehouses.length ? [warehouses[0].id] : [])} /><span>全部仓库（包含以后新增的仓库）</span></label>
          <div className="notification-choices">{warehouses.map(w => <label key={w.id} className="notification-choice"><input type="checkbox" checked={config.warehouse_ids.includes(w.id)} onChange={() => toggle('warehouse_ids', w.id)} /><span>{w.name}</span></label>)}</div>
          <small>未指定仓库时通知全部仓库。关键管理操作不受仓库筛选限制。</small>
        </fieldset>
        <label className="notification-choice"><input type="checkbox" checked={config.include_amounts} disabled={busy} onChange={e => field('include_amounts', e.target.checked)} /><span><strong>通知中显示金额</strong><small>包含单据金额、收付款和每日汇总金额；请发往适合查看这些信息的渠道。</small></span></label>
        {config.events.includes('daily_summary') && <div className="notification-schedule"><label>每日汇总时间<input type="time" value={config.daily_time} disabled={busy} onChange={e => field('daily_time', e.target.value)} /></label><label>汇总时区<input value={config.timezone} maxLength={100} placeholder="Asia/Shanghai" disabled={busy} onChange={e => field('timezone', e.target.value)} /></label><small>汇总当天零点至发送时的数据，每天一次。服务需运行；当天错过时间会在启动后补发，之前日期不补发。</small></div>}
        <small>每次保存会取消旧配置尚未完成的通知。正在发送的请求可能已到达接收方。</small>
        <div className="notification-actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(async () => {
          const value = await api('/settings/notifications', { method: 'PUT', body: { ...config, url, secret, clear_url: clearUrl, clear_secret: clearSecret } });
          setConfig(value); setSaved(JSON.stringify(value)); setUrl(''); setSecret(''); setClearUrl(false); setClearSecret(false); setNotice('通知设置已保存。'); await refreshLogs();
        })}>{busy ? <LoadingStatus size={20}>处理中…</LoadingStatus> : '保存通知设置'}</button>
        <button type="button" className="btn" disabled={busy || dirty || !config.has_url} onClick={() => void run(async () => { await api('/settings/notifications/test', { method: 'POST', body: { version: config.version } }); setNotice('测试通知已加入发送队列，请查看发送记录。'); await refreshLogs(); })}>发送测试通知</button></div>
        <small>先保存再测试；测试通知不受总开关、类型和仓库筛选限制。机器人关键词可配置为「77 ERP」。</small>
      </div>
      <div className="notification-log-heading"><h3>最近发送记录</h3><button type="button" className="btn" disabled={busy} onClick={() => void run(refreshLogs)}>刷新记录</button></div>
      <p className="notification-help">失败后自动重试，最多发送 5 次。显示最近 50 条，已发送及已取消记录保留 30 天。</p>
      <div className="notification-logs">{logs.length ? logs.map(log => <article key={log.id} data-delivery-id={log.id}>
        <div><strong>{labelsFor(log.event)}</strong><span>{notificationStatuses[log.status] || log.status}</span></div>
        <small>{new Date(log.created_at).toLocaleString('zh-CN')} · 已尝试 {log.attempts} 次</small>
        {log.last_error && <p>{log.last_error}</p>}
        {['failed', 'retry'].includes(log.status) && <button type="button" className="btn" disabled={busy} onClick={() => void run(async () => { await api(`/settings/notifications/deliveries/${log.id}/retry`, { method: 'POST', body: {} }); await refreshLogs(); })}>重试发送</button>}
      </article>) : <p>暂无发送记录</p>}</div>
    </> : !error && <p><LoadingStatus>正在读取通知设置…</LoadingStatus></p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
function labelsFor(event) { return notificationEvents.find(e => e.key === event)?.label || '测试通知'; }
