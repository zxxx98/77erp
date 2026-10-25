import { t as translate, getFormatLocale, translateText } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Spin, Button as AntButton, Checkbox as AntCheckbox, Tag, Empty as AntEmpty } from '../ui/controls.jsx';

import { stockStatus, stockTone, money as formatMoney, moneyBase as formatMoneyBase, price as formatPrice, currencySymbol, baseCurrencySymbol } from '../app/format.js';
import React, { useLayoutEffect, useRef } from 'react';
import { SearchBar } from 'antd-mobile';
import { Box, ChevronRight, Search, TriangleAlert } from 'lucide-react';
import { usePermissions } from '../permissions.jsx';
import { ProductImage } from '../ProductImage.jsx';

export const money = value => `${currencySymbol()}${formatMoney(value)}`;
export const moneyBase = value => `${baseCurrencySymbol()}${formatMoneyBase(value)}`;
export const price = value => `${currencySymbol()}${formatPrice(value)}`;
export const count = value => Number(value || 0).toLocaleString(getFormatLocale(), { maximumFractionDigits: 4 });
export const dateTime = value => new Date(value).toLocaleString(getFormatLocale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export const stockLabel = stockStatus;
export const matchesProduct = (product, query) => [product.name, product.barcode, product.category, product.specification || '', product.note || ''].some(value => value.toLowerCase().includes(query.trim().toLowerCase()));

export function MobileButton({ children, icon: Icon, primary = false, danger = false, permission, busy, type: htmlType = "button", ...props }) {
  useLocale();
  const { can } = usePermissions();
  if (permission && !can(permission)) return null;
  return <AntButton type={primary ? "primary" : "default"} danger={danger} loading={busy && { icon: <span aria-hidden="true"><Spin size="small" /></span> }} htmlType={htmlType} className={`mw-button${primary ? ' mw-primary' : ''}${danger ? ' mw-danger' : ''}`} {...props} disabled={props.disabled || busy} aria-busy={busy || undefined}>
    {Icon ? <Icon size={19} /> : null}{children}
  </AntButton>;
}
export function MobileIcon({ icon: Icon, label, ...props }) {
  useLocale();
  return <AntButton type="text" htmlType="button" className="mw-icon" aria-label={label} {...props}><Icon size={22} /></AntButton>;
}
export function Notice({ children }) {
  useLocale();
  return children ? <div className="mw-error" role="alert"><TriangleAlert size={18} /><span>{children}</span></div> : null;
}
export function Chips({ value, options, onChange, label }) {
  useLocale();
  return <div className="mw-chips" role="group" aria-label={label}>
    {options.map(([id, text]) => <AntButton type="text" htmlType="button" key={id} className={`mw-chip${value === id ? ' selected' : ''}`} aria-pressed={value === id} onClick={() => onChange(id)}>{text}</AntButton>)}
  </div>;
}
export function SearchField({ value, onChange, label = translate("warehouse.search.for.material.name.barcode.or.classification") }) {
  useLocale();
  const input = useRef(null);
  useLayoutEffect(() => {
    input.current?.nativeElement?.setAttribute('aria-label', label);
    input.current?.nativeElement?.setAttribute('autoCapitalize', 'none');
  }, [label]);
  return <SearchBar ref={input} className="mw-search" searchIcon={<Search size={19} />} clearable placeholder={label} value={value} onChange={onChange} />;
}
export function StockBadge({ product }) {
  useLocale();
  return <Tag color={{ green: 'success', orange: 'warning', red: 'error' }[stockTone(product)]}>{stockLabel(product)}</Tag>;
}
export function ProductRow({ product, onOpen, selectable = false, selected = false, onToggle }) {
  useLocale();
  return <article className={`mw-product-row${selected ? ' mw-product-row-selected' : ''}`}>
    {selectable && (
      <AntCheckbox

        className="mw-product-checkbox"
        aria-label={translate("warehouse.select", { v0: product.name })}
        checked={selected}
        onChange={() => onToggle(product)}
      />
    )}
    <div className="mw-product-icon">{product.image ? <ProductImage src={product.image} alt={product.name} thumbnailSize={100} className="mw-product-image" /> : <Box size={24} />}</div>
    <AntButton type="text" htmlType="button" className="mw-product-copy" aria-label={translate("warehouse.inventory", { v0: product.name, v1: count(product.stock), v2: product.unit })} onClick={() => selectable ? onToggle(product) : onOpen(product)}>
      <span className="mw-product-title"><strong>{product.name}{product.active === 0 ? translate("warehouse.deactivated.2") : ''}</strong><ChevronRight size={16} /></span>
      <span className="mw-muted">{product.barcode}</span>
      {product.production_type && <span className="mw-muted">{translate("warehouse.production.type.2")}{translateText(product.production_type)}</span>}
      {product.specification && <span className="mw-muted">{product.specification}</span>}
      <span className="mw-product-state"><span className="mw-muted">{product.category}</span><StockBadge product={product} /></span>
      <span className="mw-product-facts"><span>{translate("warehouse.stock")}{" "}{count(product.stock)} {product.unit}</span><span>{translate("warehouse.reference.sales.price")}{" "}{price(product.price)}</span></span>
    </AntButton>
  </article>;
}
export function Empty({ title = translate("warehouse.no.records"), children }) {
  useLocale();
  return <AntEmpty description={<><h2>{title}</h2>{children && <p className="mw-muted">{children}</p>}</>} />;
}
export function DetailRow({ label, children }) {
  useLocale();
  return <div className="mw-detail-row"><span className="mw-muted">{label}</span><strong>{children ?? '—'}</strong></div>;
}
