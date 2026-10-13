import { Select } from "./Dropdown.jsx";
import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { readProductImage } from './catalog.js';
import { ProductImage } from './ProductImage.jsx';
import './imagebed.css';

export function ImagebedSettings({ onBusy, active }) {
  const [config, setConfig] = useState(null);
  const [secret, setSecret] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [testImage, setTestImage] = useState('');
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    api('/settings/imagebed').then(value => { if (mounted.current) setConfig(value); }).catch(e => { if (mounted.current) setError(e.message); });
    return () => { mounted.current = false; };
  }, []);
  const run = async action => {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy?.(true); setError(''); setNotice('');
    try { await action(); }
    catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(false); onBusy?.(false); }
  };
  const field = (key, value) => { setConfig(current => ({ ...current, [key]: value })); setNotice(''); };
  const save = () => run(async () => {
    const saved = await api('/settings/imagebed', { method: 'PUT', body: { ...config, secret, clear_secret: clearSecret } });
    setConfig(saved); setSecret(''); setClearSecret(false); setNotice('图床配置已保存，所有仓库共用。');
  });
  return <section aria-label="图床配置">
    <div className="settings-section-heading"><h3>图床配置</h3><p>使用 Cloudflare ImgBed 存储商品图片，商品档案只保存图片 URL。所有仓库共用此配置。</p></div>
    {config ? <div className="account-fields">
      <label>图床地址<input type="url" placeholder="https://img.example.com" maxLength={2048} value={config.base_url} disabled={busy || !active} onChange={e => field('base_url', e.target.value)} /></label>
      <small>填写 HTTPS 图床域名，不包含 /upload。留空并保存可停用新图片上传。</small>
      <label>上传渠道<input value="Cloudflare R2（cfr2）" disabled /></label>
      <label>渠道名称（选填）<input maxLength={100} value={config.channel_name} placeholder="留空使用图床默认的 R2 渠道" disabled={busy} onChange={e => field('channel_name', e.target.value)} /></label>
      <label>上传目录<input maxLength={200} value={config.upload_folder} placeholder="77erp/products" disabled={busy} onChange={e => field('upload_folder', e.target.value)} /></label>
      <label>认证方式<Select value={config.auth_type} disabled={busy} onChange={e => { field('auth_type', e.target.value); setSecret(''); setClearSecret(false); }}><option value="token">API Token（推荐）</option><option value="authCode">上传认证码（authCode）</option><option value="none">无需认证</option></Select></label>
      {config.auth_type !== 'none' && <>
        <label>上传凭据<input type="password" autoComplete="new-password" maxLength={4096} value={secret} placeholder={config.has_secret ? '已保存，留空保留现有凭据' : '填写有上传权限的 Token 或认证码'} disabled={busy || clearSecret} onChange={e => setSecret(e.target.value)} /></label>
        <small>凭据仅保存在服务器，不会随商品数据或业务备份返回。</small>
        {config.has_secret && <label className="imagebed-clear-secret"><input type="checkbox" checked={clearSecret} disabled={busy} onChange={e => setClearSecret(e.target.checked)} /><span>清除已保存凭据（需同时停用上传或改为无需认证）</span></label>}
      </>}
      <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? '处理中…' : '保存图床配置'}</button>
      <label>上传测试图片<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || !config.base_url} onChange={e => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (file) void run(async () => { const url = await readProductImage(file); setTestImage(url); setNotice('测试上传成功，图片已写入图床。'); });
      }} /></label>
      <small>先保存配置，再选择图片测试。测试图片会保留在图床中。</small>
      {testImage && <ProductImage src={testImage} alt="图床测试图片" className="product-image-thumbnail" />}
    </div> : !error && <p role="status">正在读取图床配置…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
