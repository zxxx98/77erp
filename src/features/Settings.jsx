import { ProductionGroupManager } from '../ProductionGroups.jsx';
import { ConfigProvider as AntConfigProvider, Form as AntForm } from 'antd';
import { Button as AntButton, Input as AntInput } from '../ui/controls.jsx';

import { FormField } from './../ui/FormField.jsx';

import { describeStockExpression } from '../../shared/stock-compare.js';
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
  PositionManager,
  ChangePassword,
  AiSettings,
  ImagebedSettings,
  NotificationSettings,
  R2BackupSettings,
  Backup,
} from '../LazyComponents.jsx';

function StockExpressionEditor({ warehouses, value, onChange, disabled }) {
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
  return <section className="stock-expression" aria-label="库存对比表达式">
    <div className="settings-section-heading"><h3>库存对比表达式</h3><p>配置一个全局表达式，在物料详情中按各仓库库存求值并显示对比结果。左侧为起始仓库，右侧可添加带加减符号的仓库项。留空则不显示对比。</p></div>
    <AntConfigProvider componentDisabled={disabled}><fieldset disabled={disabled}>
      <label className="stock-expression-left">起始仓库
        <Select aria-label="起始仓库" value={expression?.left ?? ""} onChange={(e) => setLeft(e)}>
          <option value="" disabled>请选择</option>
          {leftOptions.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
      </label>
      {expression && <div className="stock-expression-terms">
        {terms.map((term, index) => <div className="stock-expression-term" key={index}>
          <Select aria-label={`第 ${index + 1} 项运算符`} value={term.op} onChange={(e) => setTerm(index, (t) => ({ ...t, op: e }))}>
            <option value="+">+</option>
            <option value="-">−</option>
          </Select>
          <Select aria-label={`第 ${index + 1} 项仓库`} value={term.warehouse_id} onChange={(e) => setTerm(index, (t) => ({ ...t, warehouse_id: Number(e) }))}>
            {warehouses.filter((w) => w.id === term.warehouse_id || !used.has(w.id)).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <Button type="button" icon={Trash2} aria-label={`删除第 ${index + 1} 项`} onClick={() => removeTerm(index)} />
        </div>)}
      </div>}
      <div className="stock-expression-actions">
        <Button type="button" icon={Plus} disabled={!expression || !available.length} onClick={addTerm}>添加仓库项</Button>
        {expression && <Button type="button" onClick={() => update(null)}>清除表达式</Button>}
      </div>
      {preview && <p className="stock-expression-preview">当前表达式：<strong>{preview}</strong></p>}
    </fieldset></AntConfigProvider>
  </section>;
}

function SettingsForm({ settings, warehouses, onClose, onSaved, onRefresh, onPasswordChanged, initialSection = "general" }) {
  // Refresh metadata and validate the session without loading hidden settings panels.
  useEffect(() => { void onRefresh(); }, []);
  const lock = useRef(false);
  const [notificationDirty, setNotificationDirty] = useState(false);
  const [backupDirty, setBackupDirty] = useState(false);
  const closeSettings = () => { if (!(notificationDirty || backupDirty) || window.confirm('设置尚未保存，确定放弃修改并关闭？')) onClose(); };
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
      await onSaved("工作空间设置已保存");
    } catch (e) {
      setError(e.message);
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
      setRateNotice(`已同步最新汇率：1 USD = ${result.usd_cny_rate} CNY`);
    } catch (e) {
      setError(e.message);
    } finally {
      setRateBusy(false);
    }
  };
  const reset = async () => {
    if (lock.current || !window.confirm("确定重置业务数据？所有物料、库存、入出库单据、往来单位、模板及收付款/盘点记录（包括正式数据）将永久删除，无法恢复。管理员账户、登录信息、服务器配置及已保存的商户和仓库名称会保留。")) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await api("/settings/reset", { method: "POST", body: { confirmation: "RESET_BUSINESS_DATA" } });
      await onSaved("业务数据已清空，账户和配置已保留");
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      title="工作空间设置"
      subtitle="管理工作空间、账号与业务备份"
      className="settings-modal"
      onClose={busy ? () => {} : closeSettings}
    >
      <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }} onFinish={() => { if (section === "general") void submit(); }}>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="设置分类">
            {[["general", "基础设置", Settings, "名称、仓库与计量单位"], ["ai", "AI 助手", Settings, "模型连接与操作范围"], ["imagebed", "图床配置", Camera, "物料图片上传与认证"], ["notifications", "通知设置", Bell, "Webhook 与通知类型"], ["data", "备份与恢复", Warehouse, "业务备份、恢复与重置"], ["groups", "生产小组", ShieldCheck, "生产班组与员工归属"], ["positions", "岗位配置", ShieldCheck, "岗位权限与关联员工"], ["users", "用户管理", ShieldCheck, "账号、角色与密码"]].map(([id, title, Icon, caption]) => (
              <AntButton type="text" key={id} htmlType="button" disabled={busy} aria-pressed={section === id} onClick={() => { setSection(id); setVisited(current => new Set([...current, id])); contentRef.current?.scrollTo(0, 0); }}>
                <Icon size={19} /><div><strong>{title}</strong><small>{caption}</small></div>
              </AntButton>
            ))}
          </nav>
          <div className="form-body settings-content" ref={contentRef}>
          <div hidden={section !== "general"} className="settings-section">
          <div className="settings-section-heading"><h3>基础设置</h3><p>设置业务中显示的商户和仓库名称。</p></div>
          <div className="form-grid">
          <label>
            商户名称 <span>*</span>
            <FormField label="商户名称" value={form.business_name} required maxLength={60}><AntInput

              maxLength={60}
              value={form.business_name}
              onChange={(e) =>
                setForm({ ...form, business_name: e.target.value })
              }
            /></FormField>
          </label>
          <label>
            仓库名称 <span>*</span>
            <FormField label="仓库名称" value={form.warehouse_name} required maxLength={60}><AntInput

              maxLength={60}
              value={form.warehouse_name}
              onChange={(e) =>
                setForm({ ...form, warehouse_name: e.target.value })
              }
            /></FormField>
          </label>
          </div>
          <section className="currency-settings" aria-label="币种设置">
            <div className="settings-section-heading"><h3>币种与汇率</h3><p>业务数据以基准币种存储。切换到其他币种只用于参考展示，不改变账务数据。</p></div>
            <div className="form-grid">
              <label>
                基准币种（不可修改）
                <AntInput value={`${CURRENCY_LABELS[form.base_currency] || '美元'}（${form.base_currency || 'USD'}）`} readOnly disabled />
              </label>
              <label>
                显示币种
                <Select aria-label="显示币种" value={form.display_currency || form.base_currency || 'USD'} disabled={busy || rateBusy} onChange={(e) => setForm(current => ({ ...current, display_currency: e }))}>
                  {Object.entries(CURRENCY_LABELS).map(([code, label]) => <option key={code} value={code}>{label}（{code}）</option>)}
                </Select>
              </label>
            </div>
            <label>
              汇率（1 USD = ? CNY）
              <FormField label="汇率（1 USD = ? CNY）" value={form.usd_cny_rate ?? 7.2} required type="number" min="0.000001" max="1000000"><AntInput
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
              <Button type="button" onClick={syncRate} disabled={busy || rateBusy}>{rateBusy ? '正在同步…' : '同步最新汇率'}</Button>
              <small>{form.rate_updated_at ? `上次同步：${new Date(form.rate_updated_at).toLocaleString('zh-CN')}` : '尚未从网络同步过汇率'}</small>
            </div>
            {rateNotice && <p className="currency-rate-notice">{rateNotice}</p>}
            <p className="currency-rate-hint">当前显示：{CURRENCY_LABELS[form.display_currency || form.base_currency || 'USD']}（{CURRENCY_SYMBOLS[form.display_currency || form.base_currency || 'USD']}）。金额保留 2 位小数，单价最多 4 位小数。</p>
          </section>
          <section className="unit-manager" aria-label="计量单位管理">
            <div className="settings-section-heading"><h3>计量单位</h3><p>各仓库共用，第一项作为新增物料的默认单位。修改列表不会改变已有物料的单位。</p></div>
            <div className="unit-list">
              {form.units.map((unit, index) => (
                <div className="unit-row" key={index}>
                  <label>
                    单位 {index + 1}{index === 0 ? "（默认）" : ""}
                    <FormField label="单位" value={unit} required maxLength={100}><AntInput  maxLength={100} value={unit} disabled={busy} onChange={e => setForm(current => ({ ...current, units: current.units.map((value, i) => i === index ? e.target.value : value) }))} /></FormField>
                  </label>
                  <Button type="button" icon={Trash2} aria-label={`删除单位 ${index + 1}`} disabled={busy || form.units.length === 1} onClick={() => setForm(current => ({ ...current, units: current.units.filter((_, i) => i !== index) }))} />
                </div>
              ))}
            </div>
            <Button type="button" icon={Plus} disabled={busy || form.units.length >= 100} onClick={() => setForm(current => ({ ...current, units: [...current.units, ""] }))}>新增单位</Button>
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
              <p>v{appVersion} · 多仓库版</p>
            </div>
            <Badge tone="blue">本地版本</Badge>
          </div>
          <div className="info-box"><ShieldCheck size={17} /><p>物料和单据保存在服务端数据库中，支持单商户管理多个仓库。</p></div>
          </div>
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
          <h3>重置业务数据</h3>
          <div className="info-box">
            <Trash2 size={17} />
            <p>重置将永久清空所有物料、库存、单据、往来单位、模板及收付款/盘点记录，包括正式数据。保留账户、登录信息、服务器配置及已保存的商户和仓库名称。</p>
          </div>
          <Button type="button" icon={Trash2} onClick={reset} busy={busy}>
            重置业务数据
          </Button>
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
          <span className="settings-footer-note">{section === "general" ? "修改名称或计量单位后，点击保存设置。" : "各项操作在对应区域单独确认。"}</span>
          <Button type="button" onClick={closeSettings} disabled={busy}>
            取消
          </Button>
          {section === "general" && <Button kind="primary" type="submit" icon={Check} busy={busy} disabled={notificationDirty}>
            {busy ? "保存中…" : "保存设置"}
          </Button>}
        </div>
      </AntForm>
    </Modal>
  );
}

export { SettingsForm };
