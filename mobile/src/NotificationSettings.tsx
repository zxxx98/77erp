import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api } from './native';
import { Button, Card, Field, s } from './ui';
import { Warehouse } from './model';
import { notificationEvents, notificationFormats, notificationStatuses, NotificationConfig, NotificationLog } from '../../shared/notifications';

type Props = { warehouses: Warehouse[]; onBusy: (busy: boolean) => void; onDirty: (dirty: boolean) => void };
export function NotificationSettings(props: Props) {
  const [open, setOpen] = useState(false);
  return <Card><Text style={s.subtitle}>Webhook 通知</Text><Text style={s.caption}>按类型选择库存、单据、财务及管理通知，所有设备共用。</Text>
    {open ? <NotificationForm {...props} /> : <Button title="打开通知设置" kind="secondary" onPress={() => setOpen(true)} />}
  </Card>;
}
function Check({ title, description, checked, disabled, onChange }: { title: string; description?: string; checked: boolean; disabled: boolean; onChange: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={title} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onChange} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10 }}>
    <Text style={s.label}>{checked ? '☑' : '☐'}</Text><View style={{ flex: 1 }}><Text style={s.label}>{title}</Text>{!!description && <Text style={s.caption}>{description}</Text>}</View>
  </Pressable>;
}
function NotificationForm({ warehouses, onBusy, onDirty }: Props) {
  const [config, setConfig] = useState<NotificationConfig | null>(null), [saved, setSaved] = useState('');
  const [url, setUrl] = useState(''), [secret, setSecret] = useState('');
  const [clearUrl, setClearUrl] = useState(false), [clearSecret, setClearSecret] = useState(false);
  const [logs, setLogs] = useState<NotificationLog[]>([]), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const lock = useRef(false);
  const dirty = !!config && (JSON.stringify(config) !== saved || !!url || !!secret || clearUrl || clearSecret);
  const keepsSecret = config?.has_secret && config.format === (saved ? JSON.parse(saved).format : '');
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    let live = true;
    api<NotificationConfig>('/settings/notifications').then(value => { if (live) { setConfig(value); setSaved(JSON.stringify(value)); } }).catch(e => { if (live) setError(e.message); });
    const load = () => api<NotificationLog[]>('/settings/notifications/deliveries').then(value => { if (live) setLogs(value); }).catch(e => { if (live) setError(e.message); });
    void load(); const timer = setInterval(load, 5000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  const field = <K extends keyof NotificationConfig>(key: K, value: NotificationConfig[K]) => { setConfig(c => c ? { ...c, [key]: value } : c); setNotice(''); };
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); onBusy(false); }
  };
  const refresh = async () => setLogs(await api<NotificationLog[]>('/settings/notifications/deliveries'));
  return <>
    {config ? <>
      <Check title="启用 Webhook 通知" checked={config.enabled} disabled={busy} onChange={() => field('enabled', !config.enabled)} />
      <Text style={s.label}>通知格式</Text>
      {notificationFormats.map(f => <Button key={f.key} title={`${config.format === f.key ? '已选：' : ''}${f.label}`} kind="secondary" disabled={busy} onPress={() => { field('format', f.key); setSecret(''); setClearSecret(false); }} />)}
      <Field label="Webhook 地址" value={url} secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={4096} editable={!busy && !clearUrl} placeholder={config.has_url ? '已保存，留空保留' : 'https://…'} onChangeText={setUrl} />
      <Text style={s.caption}>{config.destination ? `当前接收方：${config.destination}。` : ''}填写公网 HTTPS 地址。完整地址和密钥不显示在页面或业务备份中。</Text>
      {config.has_url && <Check title="清除已保存地址" description="需先取消启用。" checked={clearUrl} disabled={busy || config.enabled} onChange={() => setClearUrl(!clearUrl)} />}
      {config.format !== 'wecom' && <>
        <Field label="签名密钥（选填）" value={secret} secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={4096} editable={!busy && !clearSecret} placeholder={keepsSecret ? '已保存，留空保留' : '机器人开启加签时填写'} onChangeText={setSecret} />
        <Text style={s.caption}>更换通知格式后，需重新填写签名密钥。</Text>
        {config.has_secret && <Check title="清除已保存密钥" checked={clearSecret} disabled={busy} onChange={() => setClearSecret(!clearSecret)} />}
      </>}
      <Text style={s.subtitle}>通知类型</Text>
      {notificationEvents.map(e => <Check key={e.key} title={e.label} description={e.description} checked={config.events.includes(e.key)} disabled={busy} onChange={() => field('events', config.events.includes(e.key) ? config.events.filter(k => k !== e.key) : [...config.events, e.key])} />)}
      <Text style={s.subtitle}>通知仓库</Text>
      <Check title="全部仓库（包含以后新增的仓库）" checked={!config.warehouse_ids.length} disabled={busy} onChange={() => field('warehouse_ids', config.warehouse_ids.length ? [] : warehouses[0] ? [warehouses[0].id] : [])} />
      {warehouses.map(w => <Check key={w.id} title={w.name} checked={config.warehouse_ids.includes(w.id)} disabled={busy} onChange={() => field('warehouse_ids', config.warehouse_ids.includes(w.id) ? config.warehouse_ids.filter(id => id !== w.id) : [...config.warehouse_ids, w.id])} />)}
      <Text style={s.caption}>未指定仓库时通知全部仓库。关键管理操作不受仓库筛选限制。</Text>
      <Check title="通知中显示金额" description="包含单据、收付款及汇总金额，请选择适合查看这些信息的渠道。" checked={config.include_amounts} disabled={busy} onChange={() => field('include_amounts', !config.include_amounts)} />
      {config.events.includes('daily_summary') && <>
        <Field label="每日汇总时间" value={config.daily_time} maxLength={5} placeholder="18:00" editable={!busy} onChangeText={v => field('daily_time', v)} />
        <Field label="汇总时区" value={config.timezone} maxLength={100} placeholder="Asia/Shanghai" autoCapitalize="none" editable={!busy} onChangeText={v => field('timezone', v)} />
        <Text style={s.caption}>汇总当天零点至发送时的数据，每天一次。当天错过时间会在服务启动后补发，之前日期不补发。</Text>
      </>}
      <Text style={s.caption}>每次保存会取消旧配置尚未完成的通知。正在发送的请求可能已到达接收方。</Text>
      <Button title="保存通知设置" busy={busy} onPress={() => void run(async () => {
        const value = await api<NotificationConfig>('/settings/notifications', 'PUT', { ...config, url, secret, clear_url: clearUrl, clear_secret: clearSecret });
        setConfig(value); setSaved(JSON.stringify(value)); setUrl(''); setSecret(''); setClearUrl(false); setClearSecret(false); setNotice('通知设置已保存。'); await refresh();
      })} />
      <Button title="发送测试通知" kind="secondary" disabled={busy || dirty || !config.has_url} onPress={() => void run(async () => { await api('/settings/notifications/test', 'POST', { version: config.version }); setNotice('测试通知已加入发送队列，请查看发送记录。'); await refresh(); })} />
      <Text style={s.caption}>先保存再测试。测试通知不受总开关、类型和仓库筛选限制。机器人关键词可配置为「77 ERP」。</Text>
      <Text style={s.subtitle}>最近发送记录</Text>
      <Text style={s.caption}>失败后自动重试，最多发送 5 次。显示最近 50 条，已发送及已取消记录保留 30 天。</Text>
      <Button title="刷新记录" kind="secondary" disabled={busy} onPress={() => void run(refresh)} />
      {logs.length ? logs.map(log => <View key={log.id} style={{ paddingVertical: 8 }}>
        <Text style={s.label}>{notificationEvents.find(e => e.key === log.event)?.label || '测试通知'} · {notificationStatuses[log.status]}</Text>
        <Text style={s.caption}>{new Date(log.created_at).toLocaleString('zh-CN')} · 已尝试 {log.attempts} 次</Text>
        {!!log.last_error && <Text style={s.caption}>{log.last_error}</Text>}
        {['failed', 'retry'].includes(log.status) && <Button title="重试发送" kind="secondary" disabled={busy} onPress={() => void run(async () => { await api(`/settings/notifications/deliveries/${log.id}/retry`, 'POST', {}); await refresh(); })} />}
      </View>) : <Text style={s.caption}>暂无发送记录</Text>}
    </> : !error && <Text style={s.caption}>正在读取通知设置…</Text>}
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {!!notice && <Text style={s.caption}>{notice}</Text>}
  </>;
}
