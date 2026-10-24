import { Form } from 'antd';
import { useEffect, useId } from 'react';

// Bind existing controlled business drafts to Ant Form's store and rule engine.
export function FormField({ children, value, label = '此项', required, minLength, maxLength, pattern, type, min, max }) {
  const name = useId();
  const form = Form.useFormInstance();
  useEffect(() => { form?.setFieldValue(name, value); }, [form, name, value]);
  const rules = children.props.disabled ? [] : [
    required && { required: true, message: `请填写${label}` },
    minLength != null && { min: minLength, transform: value => value == null ? value : String(value), message: `${label}至少需要 ${minLength} 个字符` },
    maxLength != null && { max: maxLength, transform: value => value == null ? value : String(value), message: `${label}最多允许 ${maxLength} 个字符` },
    pattern && { pattern: new RegExp(`^(?:${pattern})$`), message: `${label}格式不正确` },
    type === 'email' && { type: 'email', message: '请输入有效的邮箱地址' },
    type === 'url' && { type: 'url', message: '请输入有效的网址' },
    type === 'number' && { type: 'number', transform: v => v === '' || v == null ? undefined : Number(v),
      ...(min != null ? { min: Number(min) } : {}), ...(max != null ? { max: Number(max) } : {}), message: `${label}超出允许范围` },
  ].filter(Boolean);
  if (!form) return children;
  return <Form.Item name={name} rules={rules} initialValue={value} className="erp-form-field">{children}</Form.Item>;
}
