import { localizeError } from '../i18n/errors.js';
import { describeStockExpression } from '../warehouse-format.js';
import { t as translate, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { ProductionGroupManager } from '../ProductionGroups.jsx';
import { ConfigProvider as AntConfigProvider, Form as AntForm } from 'antd';
import { Button as AntButton, Input as AntInput } from '../ui/controls.jsx';

import { FormField } from './../ui/FormField.jsx';


import { Select } from '../Dropdown.jsx';
import { Button, Modal, Badge } from '../components/common.jsx';
import { Trash2, Plus, Settings, Camera, Bell, Warehouse, ShieldCheck, Check } from 'lucide-react';
import { useRef, useState, useEffect } from 'react';
import { api } from '../api.js';
import { WarehouseManager } from '../Warehouses.jsx';
import { version as appVersion } from '../../package.json';
import { CURRENCY_LABELS, CURRENCY_SYMBOLS } from '../currency.js';
import {
  UserManager,
  UserPreferences,
  PositionManager,
  ChangePassword,
  AiSettings,
  ImagebedSettings,
  NotificationSettings,
  R2BackupSettings,
  Backup,
} from '../LazyComponents.jsx';

function StockExpressionEditor({ warehouses, value, onChange, disabled }) {
  useLocale();
  const expression = value && Number.isSafeInteger(value.left) ? value : null;
  const terms = expression?.terms || [];
  const used = new Set([expression?.left, ...terms.map((term) => term.warehouse_id)].filter((id) => id != null));
  const available = warehouses.filter((w) => !used.has(w.id));
  const leftOptions = warehouses.filter((w) => w.id === expression?.left || !terms.some((term) => term.warehouse_id === w.id));
  const update = (next) => onChange(next);
  const setLeft = (id) => update({ left: Number(id), terms: terms.filter((term) => term.warehouse_id !== Number(id)) });
  const addTerm = () => available.length && update({ left: expression?.left, terms: [...terms, { warehouse_id: available[0].id, op: "+" }] });
  const setTerm = (index, patch) => update({ left: expression.left, terms: terms.map((term, i) => i === index ? { ...patch(term) } : term) });
  const removeTerm = (index) => update({ left: expression.left, terms: terms.filter((_, i) => i !== index) });
  const nameById = Object.fromEntries(warehouses.map((w) => [w.id, w.name]));
  const preview = expression ? describeStockExpression(expression, nameById) : "";
  return <section className="stock-expression" aria-label={translate("warehouse.inventory.comparison.expression")}>
    <div className="settings-section-heading"><h3>{translate("warehouse.inventory.comparison.expression")}</h3><p>{translate("warehouse.configure.a.global.expression.to.evaluate.the.inventory.of.each.warehouse")}</p></div>
    <AntConfigProvider componentDisabled={disabled}><fieldset disabled={disabled}>
      <label className="stock-expression-left">{translate("warehouse.starting.warehouse")}<Select aria-label={translate("warehouse.starting.warehouse")} value={expression?.left ?? ""} onChange={(e) => setLeft(e)}>
          <option value="" disabled>{translate("warehouse.please.select")}</option>
          {leftOptions.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
      </label>
      {expression && <div className="stock-expression-terms">
        {terms.map((term, index) => <div className="stock-expression-term" key={index}>
          <Select aria-label={translate("warehouse.th.operator", { v0: index + 1 })} value={term.op} onChange={(e) => setTerm(index, (t) => ({ ...t, op: e }))}>
            <option value="+">+</option>
            <option value="-">−</option>
          </Select>
          <Select aria-label={translate("warehouse.warehouse.2", { v0: index + 1 })} value={term.warehouse_id} onChange={(e) => setTerm(index, (t) => ({ ...t, warehouse_id: Number(e) }))}>
            {warehouses.filter((w) => w.id === term.warehouse_id || !used.has(w.id)).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <Button type="button" icon={Trash2} aria-label={translate("warehouse.delete.item", { v0: index + 1 })} onClick={() => removeTerm(index)} />
        </div>)}
      </div>}
      <div className="stock-expression-actions">
        <Button type="button" icon={Plus} disabled={!expression || !available.length} onClick={addTerm}>{translate("warehouse.add.warehouse.item")}</Button>
        {expression && <Button type="button" onClick={() => update(null)}>{translate("warehouse.clear.expression")}</Button>}
      </div>
      {preview && <p className="stock-expression-preview">{translate("warehouse.current.expression")}<strong>{preview}</strong></p>}
    </fieldset></AntConfigProvider>
  </section>;
}

function SettingsForm({ settings, warehouses, onClose, onSaved, onRefresh, onPasswordChanged, initialSection = "general" }) {
  useLocale();
  // Refresh metadata and validate the session without loading hidden settings panels.
  useEffect(() => { void onRefresh(); }, []);
  const lock = useRef(false);
  const [notificationDirty, setNotificationDirty] = useState(false);
  const [backupDirty, setBackupDirty] = useState(false);
  const closeSettings = () => { if (!(notificationDirty || backupDirty) || window.confirm(translate("warehouse.the.settings.have.not.been.saved.are.you.sure.you.want"))) onClose(); };
  const contentRef = useRef(null);
  const [section, setSection] = useState(initialSection);
  const [visited, setVisited] = useState(() => new Set([initialSection]));
  const [form, setForm] = useState(() => ({ ...settings, units: settings.units || ["个"] })),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [rateBusy, setRateBusy] = useState(false),
    [rateNotice, setRateNotice] = useState("");
  useEffect(() => setForm(current => ({ ...current, warehouse_name: settings.warehouse_name })), [settings.warehouse_name]);
  const submit = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await api("/settings/currency", { method: "PUT", body: { display_currency: form.display_currency, usd_cny_rate: Number(form.usd_cny_rate) } });
      await api("/settings", { method: "PUT", body: form });
      await onSaved(translate("warehouse.workspace.settings.saved"));
    } catch (e) {
      setError(localizeError(e.message));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const syncRate = async () => {
    if (rateBusy || busy) return;
    setRateBusy(true);
    setError("");
    setRateNotice("");
    try {
      const result = await api("/settings/currency/sync-rate", { method: "POST" });
      setForm(current => ({ ...current, usd_cny_rate: result.usd_cny_rate, rate_updated_at: result.rate_updated_at }));
      setRateNotice(translate("warehouse.the.latest.exchange.rate.has.been.synchronized.1.usd.cny", { v0: result.usd_cny_rate }));
    } catch (e) {
      setError(localizeError(e.message));
    } finally {
      setRateBusy(false);
    }
  };
  const reset = async () => {
    if (lock.current || !window.confirm(translate("warehouse.are.you.sure.you.want.to.reset.business.data.all.materials"))) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await api("/settings/reset", { method: "POST", body: { confirmation: "RESET_BUSINESS_DATA" } });
      await onSaved(translate("warehouse.business.data.has.been.cleared.accounts.and.configurations.have.been.retained"));
    } catch (e) {
      setError(localizeError(e.message));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      title={translate("warehouse.workspace.settings")}
      subtitle={translate("warehouse.manage.workspace.account.and.business.backup")}
      className="settings-modal"
      onClose={busy ? () => {} : closeSettings}
    >
      <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }} onFinish={() => { if (section === "general") void submit(); }}>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label={translate("warehouse.set.categories")}>
            {[["general", translate("warehouse.basic.settings"), Settings, translate("warehouse.name.warehouse.and.unit.of.measurement")], ["preferences", translate("warehouse.user.habits"), Settings, translate("warehouse.how.to.close.pop.up.windows.and.drawers")], ["ai", translate("warehouse.ai.assistant"), Settings, translate("warehouse.model.connection.and.operating.scope")], ["imagebed", translate("warehouse.picture.bed.configuration"), Camera, translate("warehouse.material.picture.upload.and.certification")], ["notifications", translate("warehouse.notification.settings"), Bell, translate("warehouse.webhooks.and.notification.types")], ["data", translate("warehouse.backup.and.recovery"), Warehouse, translate("warehouse.business.backup.recovery.and.reset")], ["groups", translate("warehouse.production.team"), ShieldCheck, translate("warehouse.production.team.and.employee.affiliation")], ["positions", translate("warehouse.position.configuration"), ShieldCheck, translate("warehouse.position.authority.and.related.employees")], ["users", translate("warehouse.user.management"), ShieldCheck, translate("warehouse.account.role.and.password")]].map(([id, title, Icon, caption]) => (
              <AntButton type="text" key={id} htmlType="button" disabled={busy} aria-pressed={section === id} onClick={() => { setSection(id); setVisited(current => new Set([...current, id])); contentRef.current?.scrollTo(0, 0); }}>
                <Icon size={19} /><div><strong>{title}</strong><small>{caption}</small></div>
              </AntButton>
            ))}
          </nav>
          <div className="form-body settings-content" ref={contentRef}>
          <div hidden={section !== "general"} className="settings-section">
          <div className="settings-section-heading"><h3>{translate("warehouse.basic.settings")}</h3><p>{translate("warehouse.set.the.merchant.and.warehouse.names.displayed.in.the.business")}</p></div>
          <div className="form-grid">
          <label>{translate("warehouse.business.name")}<span>*</span>
            <FormField label={translate("warehouse.business.name")} value={form.business_name} required maxLength={60}><AntInput

              maxLength={60}
              value={form.business_name}
              onChange={(e) =>
                setForm({ ...form, business_name: e.target.value })
              }
            /></FormField>
          </label>
          <label>{translate("warehouse.warehouse.name")}<span>*</span>
            <FormField label={translate("warehouse.warehouse.name")} value={form.warehouse_name} required maxLength={60}><AntInput

              maxLength={60}
              value={form.warehouse_name}
              onChange={(e) =>
                setForm({ ...form, warehouse_name: e.target.value })
              }
            /></FormField>
          </label>
          </div>
          <section className="currency-settings" aria-label={translate("warehouse.currency.settings")}>
            <div className="settings-section-heading"><h3>{translate("warehouse.currency.and.exchange.rate")}</h3><p>{translate("warehouse.business.data.is.stored.in.the.base.currency.switching.to.other")}</p></div>
            <div className="form-grid">
              <label>{translate("warehouse.base.currency.cannot.be.modified")}<AntInput value={`${CURRENCY_LABELS[form.base_currency] || translate("warehouse.us.dollars")}（${form.base_currency || 'USD'}）`} readOnly disabled />
              </label>
              <label>{translate("warehouse.display.currency")}<Select aria-label={translate("warehouse.display.currency")} value={form.display_currency || form.base_currency || 'USD'} disabled={busy || rateBusy} onChange={(e) => setForm(current => ({ ...current, display_currency: e }))}>
                  {Object.entries(CURRENCY_LABELS).map(([code, label]) => <option key={code} value={code}>{label}（{code}）</option>)}
                </Select>
              </label>
            </div>
            <label>{translate("warehouse.exchange.rate.1.usd.cny")}<FormField label={translate("warehouse.exchange.rate.1.usd.cny")} value={form.usd_cny_rate ?? 7.2} required type="number" min="0.000001" max="1000000"><AntInput
                type="number"
                inputMode="decimal"
                min="0.000001"
                max="1000000"
                step="0.000001"
                value={form.usd_cny_rate ?? 7.2}
                disabled={busy || rateBusy}
                onChange={(e) => setForm(current => ({ ...current, usd_cny_rate: e.target.value }))}
              /></FormField>
            </label>
            <div className="currency-rate-actions">
              <Button type="button" onClick={syncRate} disabled={busy || rateBusy}>{rateBusy ? translate("warehouse.syncing") : translate("warehouse.synchronize.the.latest.exchange.rates")}</Button>
              <small>{form.rate_updated_at ? translate("warehouse.last.sync", { v0: new Date(form.rate_updated_at).toLocaleString(getFormatLocale()) }) : translate("warehouse.the.exchange.rate.has.not.been.synced.from.the.network.yet")}</small>
            </div>
            {rateNotice && <p className="currency-rate-notice">{rateNotice}</p>}
            <p className="currency-rate-hint">{translate("warehouse.currently.showing")}{CURRENCY_LABELS[form.display_currency || form.base_currency || 'USD']}（{CURRENCY_SYMBOLS[form.display_currency || form.base_currency || 'USD']}{translate("warehouse.the.amount.must.be.rounded.to.2.decimal.places.and.the")}</p>
          </section>
          <section className="unit-manager" aria-label={translate("warehouse.measurement.unit.management")}>
            <div className="settings-section-heading"><h3>{translate("warehouse.unit.of.measurement")}</h3><p>{translate("warehouse.shared.by.all.warehouses.the.first.item.is.used.as.the")}</p></div>
            <div className="unit-list">
              {form.units.map((unit, index) => (
                <div className="unit-row" key={index}>
                  <label>{translate("warehouse.unit")}{index + 1}{index === 0 ? translate("warehouse.default") : ""}
                    <FormField label={translate("warehouse.unit")} value={unit} required maxLength={100}><AntInput  maxLength={100} value={unit} disabled={busy} onChange={e => setForm(current => ({ ...current, units: current.units.map((value, i) => i === index ? e.target.value : value) }))} /></FormField>
                  </label>
                  <Button type="button" icon={Trash2} aria-label={translate("warehouse.delete.unit", { v0: index + 1 })} disabled={busy || form.units.length === 1} onClick={() => setForm(current => ({ ...current, units: current.units.filter((_, i) => i !== index) }))} />
                </div>
              ))}
            </div>
            <Button type="button" icon={Plus} disabled={busy || form.units.length >= 100} onClick={() => setForm(current => ({ ...current, units: [...current.units, ""] }))}>{translate("warehouse.add.new.unit")}</Button>
          </section>
          <WarehouseManager warehouses={warehouses} onRefresh={onRefresh} onBusy={setBusy} />
          <StockExpressionEditor warehouses={warehouses} value={form.stock_expression} onChange={(next) => setForm((current) => ({ ...current, stock_expression: next }))} disabled={busy} />
          <div className="settings-version">
            <span className="brand-mark">
              <svg viewBox="0 0 40 40">
                <path d="M8 12h11l-7 17m10-17h10l-7 17" />
              </svg>
            </span>
            <div>
              <strong>77 ERP</strong>
              <p>v{appVersion}{" "}{translate("warehouse.multi.warehouse.version")}</p>
            </div>
            <Badge tone="blue">{translate("warehouse.local.version")}</Badge>
          </div>
          <div className="info-box"><ShieldCheck size={17} /><p>{translate("warehouse.materials.and.documents.are.stored.in.the.server.database.allowing.a")}</p></div>
          </div>
          {section === 'preferences' && <UserPreferences disabled={busy} />}
          {section === "groups" && <div className="settings-section"><ProductionGroupManager onChanged={onRefresh} /></div>}
          {section === "positions" && <div className="settings-section"><PositionManager Modal={Modal} onChanged={onRefresh} /></div>}
          {section === "users" && <div className="settings-section"><UserManager Modal={Modal} onChanged={onRefresh} /><ChangePassword onChanged={onPasswordChanged} /></div>}
          {section === 'ai' && <div className="settings-section"><AiSettings onBusy={setBusy} /></div>}
          <div hidden={section !== 'imagebed'} className="settings-section">{visited.has('imagebed') && <ImagebedSettings active={section === 'imagebed'} onBusy={setBusy} />}</div>
          <div hidden={section !== 'notifications'} className="settings-section">{visited.has('notifications') && <NotificationSettings warehouses={warehouses} active={section === 'notifications'} onBusy={setBusy} onDirty={setNotificationDirty} />}</div>
          <div hidden={section !== "data"} className="settings-section">
          {visited.has("data") && <R2BackupSettings active={section === "data"} onBusy={setBusy} onDirty={setBackupDirty} />}
          {section === "data" && <Backup onSaved={onSaved} />}
          <section className="settings-danger">
          <h3>{translate("warehouse.reset.business.data")}</h3>
          <div className="info-box">
            <Trash2 size={17} />
            <p>{translate("warehouse.resetting.will.permanently.clear.all.materials.inventory.documents.dealing.units.templates")}</p>
          </div>
          <Button type="button" icon={Trash2} onClick={reset} busy={busy}>{translate("warehouse.reset.business.data")}</Button>
          </section>
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
        </div>
        </div>
        <div className="modal-footer">
          <span className="settings-footer-note">{section === "general" ? translate("warehouse.after.modifying.the.name.or.unit.of.measurement.click.save.settings") : section === 'preferences' ? translate("warehouse.modifications.to.user.habits.take.effect.immediately.and.are.automatically.saved") : translate("warehouse.each.operation.is.confirmed.individually.in.the.corresponding.area")}</span>
          <Button type="button" onClick={closeSettings} disabled={busy}>
            {section === 'preferences' ? translate("warehouse.complete") : translate("warehouse.cancel")}
          </Button>
          {section === "general" && <Button kind="primary" type="submit" icon={Check} busy={busy} disabled={notificationDirty}>
            {busy ? translate("warehouse.saving.2") : translate("warehouse.save.settings")}
          </Button>}
        </div>
      </AntForm>
    </Modal>
  );
}

export { SettingsForm };
