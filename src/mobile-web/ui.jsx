import React from 'react';
import { Box, ChevronRight, LoaderCircle, Search, TriangleAlert, X } from 'lucide-react';
import { usePermissions } from '../permissions.jsx';
import { ProductImage } from '../ProductImage.jsx';

export const money = value => `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const count = value => Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 6 });
export const dateTime = value => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export const stockLabel = p => p.stock === 0 ? '缺货' : p.stock <= p.threshold ? '库存偏低' : '库存充足';
export const matchesProduct = (product, query) => [product.name, product.barcode, product.category, product.specification || '', product.note || ''].some(value => value.toLowerCase().includes(query.trim().toLowerCase()));

export function MobileButton({ children, icon: Icon, primary = false, danger = false, permission, busy, ...props }) {
  const { can } = usePermissions();
  if (permission && !can(permission)) return null;
  return <button type="button" className={`mw-button${primary ? ' mw-primary' : ''}${danger ? ' mw-danger' : ''}`} {...props} disabled={props.disabled || busy} aria-busy={busy || undefined}>
    {busy ? <LoaderCircle size={19} className="spin" /> : Icon ? <Icon size={19} /> : null}{children}
  </button>;
}
export function MobileIcon({ icon: Icon, label, ...props }) {
  return <button type="button" className="mw-icon" aria-label={label} {...props}><Icon size={22} /></button>;
}
export function Notice({ children }) {
  return children ? <div className="mw-error" role="alert"><TriangleAlert size={18} /><span>{children}</span></div> : null;
}
export function Chips({ value, options, onChange, label }) {
  return <div className="mw-chips" role="group" aria-label={label}>
    {options.map(([id, text]) => <button type="button" key={id} className={`mw-chip${value === id ? ' selected' : ''}`} aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>)}
  </div>;
}
export function SearchField({ value, onChange, label = '搜索物料名称、条码或分类' }) {
  return <div className="mw-search"><Search size={19} /><input type="search" aria-label={label} placeholder={label} value={value} onChange={e => onChange(e.target.value)} autoCapitalize="none" />
    {value && <MobileIcon icon={X} label="清空搜索" onClick={() => onChange('')} />}
  </div>;
}
export function StockBadge({ product }) {
  return <span className={`mw-badge ${product.stock === 0 ? 'red' : product.stock <= product.threshold ? 'orange' : 'green'}`}>{stockLabel(product)}</span>;
}
export function ProductRow({ product, onOpen }) {
  return <article className="mw-product-row">
    <div className="mw-product-icon">{product.image ? <ProductImage src={product.image} alt={product.name} thumbnailSize={100} className="mw-product-image" /> : <Box size={24} />}</div>
    <button type="button" className="mw-product-copy" aria-label={`${product.name}，库存 ${count(product.stock)} ${product.unit}`} onClick={() => onOpen(product)}>
      <span className="mw-product-title"><strong>{product.name}{product.active === 0 ? '（已停用）' : ''}</strong><ChevronRight size={16} /></span>
      <span className="mw-muted">{product.barcode}</span>
      {product.specification && <span className="mw-muted">{product.specification}</span>}
      <span className="mw-product-state"><span className="mw-muted">{product.category}</span><StockBadge product={product} /></span>
      <span className="mw-product-facts"><span>库存 {count(product.stock)} {product.unit}</span><span>参考销售价 {money(product.price)}</span></span>
    </button>
  </article>;
}
export function Empty({ title = '暂无记录', children }) {
  return <div className="mw-empty"><Box size={34} /><h2>{title}</h2>{children && <p className="mw-muted">{children}</p>}</div>;
}
export function DetailRow({ label, children }) {
  return <div className="mw-detail-row"><span className="mw-muted">{label}</span><strong>{children ?? '—'}</strong></div>;
}
