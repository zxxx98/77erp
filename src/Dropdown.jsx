import { t as translate, getFormatLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { AutoComplete, Select as AntSelect } from 'antd';
import { Input, Spin } from './ui/controls.jsx';
import { Children, useId, useState } from 'react';
import { FormField } from './ui/FormField.jsx';
import { contactRoleLabels } from './i18n/display.js';
import './dropdown.css';
import { mobileDevice } from './device.js';
import { MobileDropdown } from './ui/MobileDropdown.jsx';

// Business option rendering only; filtering, keyboard navigation and popups are Ant Design's.
export function Dropdown({ options, value, displayValue, onSelect, onChange, label,
  listLabel, placeholder = translate("system.please.select"), searchable = false, loading = false, disabled = false, required = false,
  className = '', id, emptyText = translate("system.no.options.available.yet"), noMatchesText, loadingText = translate("system.loading"), ...props }) {
  useLocale();
  const generatedId = useId();
  const inputId = id || generatedId;
  if (mobileDevice) return <MobileDropdown {...props} id={inputId} options={options} value={value} displayValue={displayValue}
    onSelect={onSelect} onChange={onChange} label={label} listLabel={listLabel} placeholder={placeholder} searchable={searchable}
    loading={loading} disabled={disabled} required={required} className={className} emptyText={emptyText} noMatchesText={noMatchesText} loadingText={loadingText} />;
  const selected = options.find(option => String(option.value) === String(value));
  const editable = searchable && !!onChange;
  const items = options.map(option => ({ ...option, value: String(option.value),
    searchText: option.searchText || option.label,
    'data-value': String(option.value),
  }));
  const choose = next => {
    const option = options.find(item => String(item.value) === next);
    if (option && !option.disabled) onSelect?.(option);
  };
  const common = {
    ...props, id: inputId, disabled, options: items, virtual: false,
    placeholder, 'aria-label': props['aria-label'] || label,
    className: 'dropdown-control',
    classNames: { popup: { root: 'dropdown-menu' } },
    styles: { popup: { root: { maxWidth: 'calc(100vw - 16px)' } } },
    onSelect: choose,
    optionRender: option => <span className="dropdown-option-content">{option.data.content || option.label}</span>,
    notFoundContent: loading ? <span role="status"><Spin size="small" /> {loadingText}</span> : noMatchesText || emptyText,
  };
  const current = editable ? displayValue ?? '' : selected ? String(selected.value) : displayValue || undefined;
  const control = editable
    ? <AutoComplete {...common} value={current} onChange={onChange}
        filterOption={(query, option) => option.searchText.toLowerCase().includes(query.trim().toLowerCase())}>
        <Input autoComplete="off" maxLength={100} />
      </AutoComplete>
    : <AntSelect {...common} value={current} loading={loading}
        showSearch={searchable ? { optionFilterProp: 'searchText' } : false} />;
  return <div className={`dropdown ${label ? 'dropdown-field' : ''} ${className}`}>
    {label && <label htmlFor={inputId}>{label}{required && <span> *</span>}</label>}
    {required ? <FormField value={current || undefined} required label={label || props['aria-label'] || translate("system.options")}>{control}</FormField> : control}
  </div>;
}

const optionText = node => typeof node === 'string' || typeof node === 'number' ? String(node)
  : Children.toArray(node?.props?.children ?? node).map(optionText).join('');

// Translate legacy option children at business call sites into Ant Design options.
export function Select({ children, value, defaultValue, onChange, ...props }) {
  useLocale();
  const options = Children.toArray(children).map(option => ({ value: String(option.props.value ?? optionText(option.props.children)),
    label: optionText(option.props.children).trim(), disabled: option.props.disabled }));
  const [internal, setInternal] = useState(defaultValue ?? options[0]?.value);
  return <Dropdown {...props} options={options} value={value ?? internal}
    onSelect={option => { setInternal(option.value); onChange?.(option.value); }} />;
}

export function ContactPicker({ contacts, value = "", selectedId, onSelect, onChange, searchable = false, label = translate("system.business.partner"),
  placeholder = translate("system.select.the.organization.you.are.communicating.with.or.search.by.entering"), ...props }) {
  useLocale();
  const options = contacts.map(contact => ({ value: contact.id, label: contact.name,
    searchText: `${contact.name} ${contact.person} ${contact.phone}`, contact,
    content: <><span className={`dropdown-role dropdown-role-${contact.role}`}>{contactRoleLabels[contact.role]}</span>
      <span className="dropdown-contact-copy"><strong>{contact.name}{!contact.active && <small>{translate("system.deactivated")}</small>}</strong>
        {(contact.person || contact.phone) && <span>{[contact.person, contact.phone].filter(Boolean).join(" · ")}</span>}
      </span></> }));
  return <Dropdown {...props} className="contact-picker" options={options} value={selectedId} displayValue={value}
    label={label} listLabel={label} placeholder={placeholder}
    searchable={searchable} emptyText={translate("system.there.is.currently.no.alternative.unit.to.choose.from")} noMatchesText={translate("system.no.matching.correspondent.unit")} loadingText={translate("system.loading.correspondence.units")}
    onChange={searchable ? onChange : undefined} onSelect={option => onSelect(option.contact)} />;
}
