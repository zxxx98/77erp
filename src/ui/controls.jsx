import { t as translate, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ConfigProvider, Button as DesktopButton, Input as DesktopInput, Checkbox as DesktopCheckbox, Radio as DesktopRadio, Tag as DesktopTag, Empty as DesktopEmpty, Spin as DesktopSpin } from 'antd';
import { Button as TouchButton, Input as TouchInput, TextArea, Checkbox as TouchCheckbox, Radio as TouchRadio, Tag as TouchTag, Empty as TouchEmpty, DotLoading } from 'antd-mobile';
import { Eye, EyeOff } from 'lucide-react';
import { mobileDevice } from '../device.js';
import './mobile-controls.css';

// Keep business forms' event contract while choosing the official controls for
// each device. Ant Form remains the shared validation/store implementation.
function useDisabled(disabled) {
  const { componentDisabled } = ConfigProvider.useConfig();
  return disabled ?? componentDisabled;
}

const MobileButton = forwardRef(function MobileButton({ type, htmlType = 'button', danger, loading, icon, children, size, disabled, ...props }, ref) {
  useLocale();
  const inheritedDisabled = useDisabled(disabled);
  const native = useRef(null);
  useImperativeHandle(ref, () => ({
    get nativeElement() { return native.current?.nativeElement; },
    focus: options => native.current?.nativeElement?.focus(options),
    blur: () => native.current?.nativeElement?.blur(),
  }), []);
  useLayoutEffect(() => {
    const element = native.current?.nativeElement;
    if (!element) return;
    for (const key of ['title', 'role', 'name', 'value']) {
      if (props[key] != null) element.setAttribute(key, String(props[key]));
    }
    // Mobile Button deliberately exposes fewer native events than desktop
    // Button. Preserve shared keyboard and touch editor handlers.
    const listeners = [['keydown', props.onKeyDown], ['pointerup', props.onPointerUp], ['dblclick', props.onDoubleClick]];
    for (const [event, handler] of listeners) if (handler) element.addEventListener(event, handler);
    return () => { for (const [event, handler] of listeners) if (handler) element.removeEventListener(event, handler); };
  });
  return <TouchButton {...props} ref={native} type={htmlType} color={danger ? 'danger' : type === 'primary' ? 'primary' : 'default'}
    fill={['text', 'link'].includes(type) ? 'none' : danger ? 'outline' : 'solid'}
    size={size === 'small' ? 'small' : size === 'large' ? 'large' : 'middle'}
    loading={!!loading} loadingIcon={typeof loading === 'object' ? loading.icon : undefined}
    loadingText={children} disabled={inheritedDisabled}>
    {icon}{children}
  </TouchButton>;
});
export const Button = mobileDevice ? MobileButton : DesktopButton;

const MobileInput = forwardRef(function MobileInput({ multiline, password, prefix, suffix, allowClear, bordered, status, size, className = '', onChange, value, defaultValue, min, max, required, disabled, ...props }, ref) {
  useLocale();
  const inheritedDisabled = useDisabled(disabled);
  const native = useRef(null);
  const [visible, setVisible] = useState(false);
  const Control = multiline ? TextArea : TouchInput;
  const nativeAttributes = Object.fromEntries(Object.entries(props).filter(([key]) => key.startsWith('aria-') || key === 'role'));
  const controlProps = Object.fromEntries(Object.entries(props).filter(([key]) => !(key.startsWith('aria-') || key === 'role')));
  // Mobile Input clamps numbers on blur when min/max are passed. Keep native
  // constraints without changing drafts or rounding business quantities.
  useLayoutEffect(() => {
    const element = native.current?.nativeElement;
    if (!element) return;
    for (const [key, val] of Object.entries({ min, max, required: required ? '' : undefined, ...nativeAttributes })) {
      if (val == null) element.removeAttribute(key);
      else element.setAttribute(key, String(val));
    }
  });
  const connect = node => {
    native.current = node;
    const handle = node && {
      ...node,
      input: node.nativeElement,
      nativeElement: node.nativeElement,
      focus: options => node.nativeElement?.focus(options),
      blur: () => node.nativeElement?.blur(),
      select: () => node.nativeElement?.select(),
    };
    if (typeof ref === 'function') ref(handle);
    else if (ref) ref.current = handle;
  };
  return <div className={`erp-mobile-input${multiline ? ' erp-mobile-textarea' : ''} ${className}`}>
    {prefix && <span className="erp-input-addon">{prefix}</span>}
    <Control {...controlProps} ref={connect} disabled={inheritedDisabled} clearable={!!allowClear}
      value={value == null ? value : String(value)} defaultValue={defaultValue == null ? defaultValue : String(defaultValue)}
      type={password ? visible ? 'text' : 'password' : props.type}
      onChange={next => {
        const target = { value: next, name: props.name, id: props.id, type: props.type };
        onChange?.({ target, currentTarget: native.current?.nativeElement || target, type: 'change' });
      }} />
    {suffix}
    {password && <TouchButton fill="none" aria-label={visible ? translate("system.hide.password") : translate("system.show.password")} onClick={() => setVisible(!visible)} disabled={inheritedDisabled}>
      {visible ? <EyeOff size={20} /> : <Eye size={20} />}
    </TouchButton>}
  </div>;
});
export const Input = mobileDevice ? Object.assign(MobileInput, {
  TextArea: forwardRef((props, ref) => <MobileInput {...props} multiline ref={ref} />),
  Password: forwardRef((props, ref) => <MobileInput {...props} password ref={ref} />),
}) : DesktopInput;

function MobileChoice({ radio, onChange, disabled, children, checked, defaultChecked = false, ...props }) {
  useLocale();
  const inheritedDisabled = useDisabled(disabled);
  const host = useRef(null);
  const [internal, setInternal] = useState(defaultChecked);
  const Control = radio ? TouchRadio : TouchCheckbox;
  useLayoutEffect(() => {
    const input = host.current?.querySelector('input');
    if (!input) return;
    for (const key of ['aria-label', 'aria-labelledby', 'aria-describedby', 'name', 'value']) {
      if (props[key] != null) input.setAttribute(key, String(props[key]));
    }
    input.indeterminate = !!props.indeterminate;
  });
  return <span className="erp-mobile-choice" ref={host}><Control {...props} disabled={inheritedDisabled} checked={checked ?? internal} onChange={next => {
    setInternal(next);
    const target = { checked: next, value: props.value };
    onChange?.({ target, currentTarget: target, type: 'change' });
  }}>{children}</Control></span>;
}
export const Checkbox = mobileDevice ? props => <MobileChoice {...props} /> : DesktopCheckbox;
export const Radio = mobileDevice ? props => <MobileChoice {...props} radio /> : DesktopRadio;
export const Tag = mobileDevice ? ({ color, ...props }) => <TouchTag {...props} fill="outline" color={{ error: 'danger', processing: 'primary' }[color] || color} /> : DesktopTag;
export const Empty = mobileDevice ? ({ children, ...props }) => <div className="erp-mobile-empty"><TouchEmpty {...props} />{children}</div> : DesktopEmpty;
function MobileSpin({ children, spinning = true }) {
  useLocale();
  return <>{spinning && <span role="status" aria-label={translate("system.loading.2")}><DotLoading /></span>}{children}</>;
}
export const Spin = mobileDevice ? MobileSpin : DesktopSpin;
