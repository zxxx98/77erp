import { localizeError } from './i18n/errors.js';
import { t as translate, getFormatLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { Input as AntInput, Checkbox as AntCheckbox, Button as AntButton } from './ui/controls.jsx';

import { LoadingStatus } from './Loading.jsx';
import { Select } from "./Dropdown.jsx";
import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { readProductImage } from './catalog.js';
import { ProductImage } from './ProductImage.jsx';
import './imagebed.css';

export function ImagebedSettings({ onBusy, active }) {
  useLocale();
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
    api('/settings/imagebed').then(value => { if (mounted.current) setConfig(value); }).catch(e => { if (mounted.current) setError(localizeError(e.message)); });
    return () => { mounted.current = false; };
  }, []);
  const run = async action => {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy?.(true); setError(''); setNotice('');
    try { await action(); }
    catch (e) { setError(localizeError(e.message)); }
    finally { lock.current = false; setBusy(false); onBusy?.(false); }
  };
  const field = (key, value) => { setConfig(current => ({ ...current, [key]: value })); setNotice(''); };
  const save = () => run(async () => {
    const saved = await api('/settings/imagebed', { method: 'PUT', body: { ...config, secret, clear_secret: clearSecret } });
    setConfig(saved); setSecret(''); setClearSecret(false); setNotice(translate("system.the.image.bed.configuration.has.been.saved.and.is.shared.by"));
  });
  return <section aria-label={translate("system.picture.bed.configuration")}>
    <div className="settings-section-heading"><h3>{translate("system.picture.bed.configuration")}</h3><p>{translate("system.use.cloudflare.imgbed.to.store.material.images.and.the.material.file")}</p></div>
    {config ? <div className="account-fields">
      <label>{translate("system.picture.bed.address")}<AntInput type="url" placeholder="https://img.example.com" maxLength={2048} value={config.base_url} disabled={busy || !active} onChange={e => field('base_url', e.target.value)} /></label>
      <small>{translate("system.fill.in.the.https.image.bed.domain.name.excluding.upload.leave")}</small>
      <label>{translate("system.upload.channel")}<AntInput value="Cloudflare R2（cfr2）" disabled /></label>
      <label>{translate("system.channel.name.optional")}<AntInput maxLength={100} value={config.channel_name} placeholder={translate("system.leave.this.blank.to.use.the.default.r2.channel.of.the")} disabled={busy} onChange={e => field('channel_name', e.target.value)} /></label>
      <label>{translate("system.upload.directory")}<AntInput maxLength={200} value={config.upload_folder} placeholder="77erp/products" disabled={busy} onChange={e => field('upload_folder', e.target.value)} /></label>
      <label>{translate("system.authentication.method")}<Select aria-label={translate("system.authentication.method")} value={config.auth_type} disabled={busy} onChange={e => { field('auth_type', e); setSecret(''); setClearSecret(false); }}><option value="token">{translate("system.api.token.recommended")}</option><option value="authCode">{translate("system.upload.authentication.code.authcode")}</option><option value="none">{translate("system.no.certification.required")}</option></Select></label>
      {config.auth_type !== 'none' && <>
        <label>{translate("system.upload.credentials")}<AntInput type="password" autoComplete="new-password" maxLength={4096} value={secret} placeholder={config.has_secret ? translate("system.saved.leave.blank.to.retain.existing.credentials") : translate("system.fill.in.the.token.or.verification.code.with.upload.permission")} disabled={busy || clearSecret} onChange={e => setSecret(e.target.value)} /></label>
        <small>{translate("system.credentials.are.only.saved.on.the.server.and.will.not.be")}</small>
        {config.has_secret && <AntCheckbox className="imagebed-clear-secret" checked={clearSecret} disabled={busy} onChange={e => setClearSecret(e.target.checked)}><span>{translate("system.clear.saved.credentials.you.need.to.disable.uploading.at.the.same")}</span></AntCheckbox>}
      </>}
      <AntButton type="primary" htmlType="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? <LoadingStatus size={20}>{translate("system.processing")}</LoadingStatus> : translate("system.save.image.bed.configuration")}</AntButton>
      <label>{translate("system.upload.test.image")}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || !config.base_url} onChange={e => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (file) void run(async () => { const url = await readProductImage(file); setTestImage(url); setNotice(translate("system.the.test.upload.was.successful.and.the.image.has.been.written")); });
      }} /></label>
      <small>{translate("system.save.the.configuration.first.then.select.the.image.to.test.test")}</small>
      {testImage && <ProductImage src={testImage} alt={translate("system.picture.bed.test.pictures")} className="product-image-thumbnail" />}
    </div> : !error && <p><LoadingStatus>{translate("system.reading.image.bed.configuration")}</LoadingStatus></p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
