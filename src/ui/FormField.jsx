import { t as translate, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Form } from 'antd';
import { useEffect, useId } from 'react';

// Bind existing controlled business drafts to Ant Form's store and rule engine.
export function FormField({ children, value, label = translate("system.this.item"), required, minLength, maxLength, pattern, type, min, max }) {
  useLocale();
  const name = useId();
  const form = Form.useFormInstance();
  useEffect(() => { form?.setFieldValue(name, value); }, [form, name, value]);
  const rules = children.props.disabled ? [] : [
    required && { required: true, message: translate("system.please.fill.in", { v0: label }) },
    minLength != null && { min: minLength, transform: value => value == null ? value : String(value), message: translate("system.requires.at.least.characters", { v0: label, v1: minLength }) },
    maxLength != null && { max: maxLength, transform: value => value == null ? value : String(value), message: translate("system.allows.up.to.characters", { v0: label, v1: maxLength }) },
    pattern && { pattern: new RegExp(`^(?:${pattern})$`), message: translate("system.format.is.incorrect", { v0: label }) },
    type === 'email' && { type: 'email', message: translate("system.please.enter.a.valid.email.address") },
    type === 'url' && { type: 'url', message: translate("system.please.enter.a.valid.url") },
    type === 'number' && { type: 'number', transform: v => v === '' || v == null ? undefined : Number(v),
      ...(min != null ? { min: Number(min) } : {}), ...(max != null ? { max: Number(max) } : {}), message: translate("system.exceeds.allowed.range", { v0: label }) },
  ].filter(Boolean);
  if (!form) return children;
  return <Form.Item name={name} rules={rules} initialValue={value} className="erp-form-field">{children}</Form.Item>;
}
