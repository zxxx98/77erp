import { LoadingIndicator } from './Loading.jsx';
import React, { Children, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import "./dropdown.css";

// Static selects and editable contact fields share the same trigger and menu.
export function Dropdown({ options, value, displayValue, onSelect, onChange, label, listLabel = label,
  placeholder = "请选择", searchable = false, loading = false, disabled = false, required = false,
  className = "", id, name, nativeSelect, error = "", emptyText = "暂无可选项", noMatchesText = "没有匹配的选项", loadingText = "正在加载…", ...inputProps }) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const listId = `${inputId}-options`;
  const root = useRef(null), input = useRef(null), menu = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [position, setPosition] = useState(null);
  const selected = options.find(option => String(option.value) === String(value));
  const text = displayValue ?? selected?.label ?? "";
  const matches = options.filter(option => !searchable || (option.searchText || option.label).toLowerCase().includes(query.trim().toLowerCase()));
  const enabled = matches.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
  const isDisabled = () => disabled || input.current?.matches(":disabled");
  const expand = () => {
    if (isDisabled()) return;
    setQuery("");
    setHighlighted(Math.max(0, options.findIndex(option => !option.disabled && String(option.value) === String(value))));
    setOpen(true);
  };
  const choose = option => {
    if (isDisabled() || loading || option.disabled) return;
    onSelect(option);
    setQuery("");
    input.current?.focus();
    setOpen(false);
  };
  useLayoutEffect(() => {
    if (!open || disabled) return;
    const place = () => {
      const rect = root.current.querySelector(".dropdown-control").getBoundingClientRect();
      const viewport = window.visualViewport;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      const offsetTop = viewport?.offsetTop || 0;
      const offsetLeft = viewport?.offsetLeft || 0;
      const menuWidth = Math.min(Math.max(rect.width, 200), width - 16);
      const below = height + offsetTop - rect.bottom - 14;
      const above = rect.top - offsetTop - 14;
      const upwards = below < 200 && above > below;
      setPosition({ left: Math.max(offsetLeft + 8, Math.min(rect.left, width + offsetLeft - menuWidth - 8)),
        width: menuWidth, maxHeight: Math.max(80, Math.min(280, upwards ? above : below)),
        ...(upwards ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open, disabled]);
  useEffect(() => {
    if (!open) return;
    const closeOutside = event => {
      if (!root.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  useEffect(() => {
    if (open) menu.current?.querySelector(`[data-index="${highlighted}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, highlighted, query]);
  return (
    <div ref={root} className={`dropdown ${label ? "dropdown-field" : ""} ${className}`} onBlur={event => {
      if (!root.current.contains(event.relatedTarget) && !menu.current?.contains(event.relatedTarget)) setOpen(false);
    }}>
      {label && <label htmlFor={inputId}>{label}{required && <span> *</span>}</label>}
      <div className="dropdown-control" data-disabled={disabled || undefined} data-invalid={!!error || undefined}>
        {searchable && onChange == null && <Search size={16} aria-hidden="true" className="dropdown-search-icon" />}
        <input {...inputProps} ref={input} id={inputId} name={name} className="dropdown-input"
          role="combobox" aria-label={inputProps["aria-label"] || label} aria-expanded={open && !disabled} aria-controls={listId}
          aria-invalid={!!error || undefined} aria-describedby={error ? `${inputId}-error` : inputProps["aria-describedby"]}
          aria-autocomplete={searchable ? "list" : "none"}
          aria-activedescendant={open && !disabled && !loading && matches[highlighted] ? `${listId}-${highlighted}` : undefined}
          autoComplete="off" readOnly={!searchable} disabled={disabled}
          required={required && !nativeSelect} maxLength={onChange ? 100 : undefined}
          placeholder={placeholder} value={onChange ? text : searchable && open ? query : text}
          onFocus={() => { if (searchable && !open) expand(); }}
          onClick={() => { if (!open) expand(); else if (!searchable) setOpen(false); }}
          onChange={event => { setQuery(event.target.value); onChange?.(event.target.value); setHighlighted(0); setOpen(true); }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              if (!open && searchable && ["Home", "End"].includes(event.key)) return;
              event.preventDefault();
              if (!open) expand();
              if (enabled.length) {
                if (event.key === "Home") setHighlighted(enabled[0]);
                else if (event.key === "End") setHighlighted(enabled.at(-1));
                else setHighlighted(current => {
                  if (!open) return event.key === "ArrowDown" ? enabled[0] : enabled.at(-1);
                  const next = (enabled.indexOf(current) + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
                  return enabled[next];
                });
              }
            } else if (event.key === "Enter" || (!searchable && event.key === " ")) {
              event.preventDefault();
              if (open && matches[highlighted]) choose(matches[highlighted]); else expand();
            } else if (event.key === "Escape" && open) {
              event.preventDefault(); event.stopPropagation(); setOpen(false);
            } else if (!searchable && event.key.length === 1) {
              const index = matches.findIndex(option => !option.disabled && option.label.toLowerCase().startsWith(event.key.toLowerCase()));
              if (index >= 0) { if (!open) expand(); setHighlighted(index); }
            }
          }} />
        <button type="button" className="dropdown-toggle" tabIndex={-1}
          aria-label={`${open ? "收起" : "展开"}${listLabel || inputProps["aria-label"] || "选项"}列表`}
          aria-expanded={open && !disabled} aria-controls={listId} disabled={disabled}
          onMouseDown={event => event.preventDefault()}
          onClick={() => { input.current?.focus(); if (open) setOpen(false); else expand(); }}>
          <ChevronDown size={18} aria-hidden="true" />
        </button>
      </div>
      {nativeSelect}
      {error && <p id={`${inputId}-error`} className="dropdown-error" role="alert">{error}</p>}
      {open && !disabled && position && createPortal(
        <div ref={menu} className="dropdown-menu" style={position}>
          <div id={listId} className="dropdown-options" role="listbox" aria-label={listLabel || inputProps["aria-label"]} aria-busy={loading}>
            {!loading && matches.map((option, index) => (
              <button key={option.value} type="button" role="option" id={`${listId}-${index}`}
                data-value={option.value} data-index={index} disabled={option.disabled}
                aria-selected={String(value) === String(option.value)} tabIndex={-1}
                className={`dropdown-option${index === highlighted ? " is-highlighted" : ""}`}
                onMouseDown={event => event.preventDefault()} onMouseEnter={() => setHighlighted(index)}
                onClick={() => choose(option)}>
                <span className="dropdown-option-content">{option.content || option.label}</span>
                {String(value) === String(option.value) && <Check size={16} className="dropdown-check" aria-hidden="true" />}
              </button>
            ))}
          </div>
          {(loading || !matches.length) && <p className="dropdown-empty" role="status">{loading ? <span className="loading-status"><LoadingIndicator />{loadingText}</span> : query.trim() ? noMatchesText : emptyText}</p>}
        </div>, document.body,
      )}
    </div>
  );
}

const optionText = node => typeof node === "string" || typeof node === "number" ? String(node)
  : Children.toArray(node?.props?.children ?? node).map(optionText).join("");

// Keep native form validation and submission while displaying the shared menu.
export function Select({ children, value, onChange, required, disabled, name, ...props }) {
  const [error, setError] = useState("");
  useEffect(() => { setError(""); }, [value]);
  const options = Children.toArray(children).map(option => ({ value: String(option.props.value ?? optionText(option.props.children)),
    label: optionText(option.props.children).trim(), disabled: option.props.disabled }));
  return <Dropdown {...props} options={options} value={value} required={required} disabled={disabled} error={error}
    onSelect={option => { setError(""); onChange?.({ target: { value: option.value }, currentTarget: { value: option.value } }); }}
    nativeSelect={<select className="dropdown-native" aria-hidden="true" tabIndex={-1} name={name}
      value={value} required={required} disabled={disabled} onChange={onChange}
      onInvalid={event => { event.preventDefault(); setError("请选择一个选项。"); event.currentTarget.parentElement.querySelector(".dropdown-input")?.focus(); }}>
      {children}
    </select>} />;
}

export function ContactPicker({ contacts, value = "", selectedId, onSelect, onChange, searchable = false, label = "往来单位",
  placeholder = "选择往来单位，或输入名称、联系人、电话搜索", ...props }) {
  const options = contacts.map(contact => ({ value: contact.id, label: contact.name,
    searchText: `${contact.name} ${contact.person} ${contact.phone}`, contact,
    content: <><span className={`dropdown-role dropdown-role-${contact.role}`}>{contact.role === "supplier" ? "供应商" : "客户"}</span>
      <span className="dropdown-contact-copy"><strong>{contact.name}{!contact.active && <small>已停用</small>}</strong>
        {(contact.person || contact.phone) && <span>{[contact.person, contact.phone].filter(Boolean).join(" · ")}</span>}
      </span></> }));
  return <Dropdown {...props} className="contact-picker" options={options} value={selectedId} displayValue={value}
    label={label} listLabel={label === "搜索往来单位" ? "往来单位" : label} placeholder={placeholder}
    searchable={searchable} emptyText="暂无可选往来单位" noMatchesText="没有匹配的往来单位" loadingText="正在加载往来单位…"
    onChange={searchable ? onChange : undefined} onSelect={option => onSelect(option.contact)} />;
}
