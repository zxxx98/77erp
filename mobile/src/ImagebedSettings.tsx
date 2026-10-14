import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { api, device, uploadProductImage } from './native';
import { Button, Card, Field, s } from './ui';
import { ProductImage } from './ProductImage';

type Config = { base_url: string; auth_type: 'token' | 'authCode' | 'none'; upload_folder: string; channel_name: string; has_secret: boolean };
export function ImagebedSettings({ onBusy, onDirty }: { onBusy: (busy: boolean) => void; onDirty: (dirty: boolean) => void }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [saved, setSaved] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [testImage, setTestImage] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    let live = true;
    api<Config>('/settings/imagebed').then(value => { if (live) { setConfig(value); setSaved(JSON.stringify(value)); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);
  useEffect(() => { onDirty(!!config && (JSON.stringify(config) !== saved || !!secret)); }, [config, saved, secret, onDirty]);
  const field = <K extends keyof Config>(key: K, value: Config[K]) => setConfig(current => current ? { ...current, [key]: value } : current);
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); onBusy(false); }
  };
  return <Card>
    <Text style={s.subtitle}>图床配置</Text>
    <Text style={s.caption}>Cloudflare ImgBed · Cloudflare R2（cfr2）。所有仓库共用，物料仅保存图片 URL。</Text>
    {config ? <>
      <Field label="图床地址" value={config.base_url} placeholder="https://img.example.com" autoCapitalize="none" autoCorrect={false} maxLength={2048} editable={!busy} onChangeText={value => field('base_url', value)} />
      <Text style={s.caption}>填写 HTTPS 图床域名，不包含 /upload。留空并保存可停用新图片上传。</Text>
      <Field label="渠道名称（选填）" value={config.channel_name} maxLength={100} placeholder="留空使用默认 R2 渠道" editable={!busy} onChangeText={value => field('channel_name', value)} />
      <Field label="上传目录" value={config.upload_folder} maxLength={200} autoCapitalize="none" editable={!busy} onChangeText={value => field('upload_folder', value)} />
      <Text style={s.label}>认证方式</Text>
      {([['token', 'API Token（推荐）'], ['authCode', '上传认证码（authCode）'], ['none', '无需认证']] as const).map(([value, title]) => <Button key={value} title={`${config.auth_type === value ? '已选：' : ''}${title}`} kind="secondary" disabled={busy} onPress={() => { field('auth_type', value); setSecret(''); }} />)}
      {config.auth_type !== 'none' && <Field label="上传凭据" value={secret} secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={4096} editable={!busy} placeholder={config.has_secret ? '已保存，留空保留现有凭据' : '填写有上传权限的凭据'} onChangeText={setSecret} />}
      <Text style={s.caption}>图床配置通过「保存图床配置」单独保存。凭据仅保存在服务器，不包含在物料数据或业务备份中。改为无需认证或停用上传并选择清除，可移除凭据。</Text>
      <Button title="保存图床配置" busy={busy} onPress={() => void run(async () => {
        const value = await api<Config>('/settings/imagebed', 'PUT', { ...config, secret });
        setConfig(value); setSaved(JSON.stringify(value)); setSecret(''); setNotice('图床配置已保存。');
      })} />
      {config.has_secret && !config.base_url.trim() && <Button title="停用上传并清除凭据" kind="secondary" disabled={busy} onPress={() => void run(async () => {
        const value = await api<Config>('/settings/imagebed', 'PUT', { ...config, secret: '', clear_secret: true });
        setConfig(value); setSaved(JSON.stringify(value)); setSecret(''); setNotice('上传已停用，凭据已清除。');
      })} />}
      <Button title="选择图片测试上传" kind="secondary" disabled={busy || !config.base_url} onPress={() => void run(async () => {
        const uri = await device.pickImage();
        if (uri) { setTestImage(await uploadProductImage(uri)); setNotice('测试上传成功，图片已写入图床。'); }
      })} />
      <Text style={s.caption}>先保存配置再测试。测试图片会保留在图床中。</Text>
      {!!testImage && <ProductImage uri={testImage} label="图床测试图片" style={{ width: '100%', height: 160 }} />}
    </> : !error && <Text style={s.caption}>正在读取图床配置…</Text>}
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {!!notice && <Text style={s.caption}>{notice}</Text>}
  </Card>;
}
