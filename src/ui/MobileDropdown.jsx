import { t as translate, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { CheckList, SearchBar } from 'antd-mobile';
import { ChevronDown } from 'lucide-react';
import { Modal } from '../components/common.jsx';
import { FormField } from './FormField.jsx';
import { Empty, Input, Spin } from './controls.jsx';

export function MobileDropdown({ options, value, displayValue, onSelect, onChange, label, listLabel,
  placeholder = translate("extra.please.select"), searchable, loading, disabled, required, className = '', id,
  emptyText = translate("extra.no.options.available.yet"), noMatchesText, loadingText = translate("extra.loading"), ...props }) {
  useLocale();
  const generated = useId();
  const inputId = id || generated;
  const listId = `${inputId}-options`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const search = useRef(null);
  const selected = options.find(option => String(option.value) === String(value));
  const editable = searchable && !!onChange;
  const name = props['aria-label'] || label || placeholder;
  const current = editable ? displayValue ?? '' : selected?.label || displayValue || '';
  const fieldValue = editable ? current || undefined : selected ? String(selected.value) || undefined : displayValue || undefined;
  const filtered = options.filter(option => String(option.searchText || option.label).toLowerCase().includes(query.trim().toLowerCase()));
  const show = () => { if (!disabled) { setQuery(''); setOpen(true); } };
  useLayoutEffect(() => {
    search.current?.nativeElement?.setAttribute('aria-label', translate("extra.search", { v0: listLabel || label || translate("extra.options") }));
  });
  const attributes = {
    id: inputId, disabled, role: 'combobox', 'aria-label': name,
    'aria-controls': listId, 'aria-expanded': open, 'aria-haspopup': 'listbox',
    'aria-required': required || undefined,
  };
  const control = editable
    ? <Input {...props} {...attributes} value={current} placeholder={placeholder} autoComplete="off"
        onClick={show} onChange={event => { onChange(event.target.value); setQuery(event.target.value); setOpen(true); }} />
    : <button {...props} {...attributes} type="button" className="erp-mobile-select-trigger" onClick={show}>
        <span className={current ? '' : 'mw-muted'}>{current || placeholder}</span><ChevronDown size={18} />
      </button>;
  return <div className={`dropdown erp-mobile-select ${label ? 'dropdown-field' : ''} ${className}`}>
    {label && <label htmlFor={inputId}>{label}{required && <span> *</span>}</label>}
    {required ? <FormField value={fieldValue} required label={name}>{control}</FormField> : control}
    {open && <Modal title={listLabel || label || translate("extra.please.select")} className="erp-select-sheet" onClose={() => setOpen(false)}>
      <div className="form-body mw-stack">
        {searchable && <SearchBar ref={search} placeholder={translate("extra.search", { v0: listLabel || label || translate("extra.options") })} value={query} onChange={setQuery} clearable />}
        {loading ? <div role="status"><Spin />{loadingText}</div> : <div id={listId} role="listbox" aria-label={listLabel || name}>
          <CheckList value={selected ? [String(selected.value)] : []}>
            {filtered.map(option => <div key={option.value} role="option" data-value={String(option.value)}
              aria-selected={String(option.value) === String(value)} aria-disabled={option.disabled || undefined}>
              <CheckList.Item value={String(option.value)} disabled={option.disabled} onClick={() => {
                if (option.disabled) return;
                onSelect?.(option);
                setOpen(false);
              }}>{option.content || option.label}</CheckList.Item>
            </div>)}
          </CheckList>
          {!filtered.length && <Empty description={query ? noMatchesText || emptyText : emptyText} />}
        </div>}
      </div>
    </Modal>}
  </div>;
}
