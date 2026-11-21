import { t as translate, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Pagination as AntPagination } from 'antd';
import { Spin, Button as AntButton, Tag, Empty as AntEmpty } from '../ui/controls.jsx';
import { Popup } from 'antd-mobile';

import { usePermissions } from '../permissions.jsx';
import { LoadingIndicator, LoadingStatus } from '../Loading.jsx';
import { ProductImage } from '../ProductImage.jsx';
import { useId, useRef, useEffect, useState } from 'react';
import { mobileDevice } from '../device.js';
import { usePreferences } from '../preferences.jsx';
import { X, Package, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { categoryBranch } from '../catalog.js';

function Button({
  children,
  icon: Icon,
  kind = "secondary",
  className = "",
  permission,
  busy = false,
  type: htmlType = "button",
  ...props
}) {
  useLocale();
  const { can } = usePermissions();
  if (permission && !can(permission)) return null;
  return (
    <AntButton type={kind === "primary" ? "primary" : (!children && Icon) ? "text" : "default"} danger={kind === "danger"} htmlType={htmlType} loading={busy && { icon: <span aria-hidden="true"><Spin size="small" /></span> }} className={`btn btn-${kind} ${className}`} {...props} disabled={props.disabled || busy} aria-busy={busy || undefined}>
      {Icon && <Icon size={16} strokeWidth={1.8} />}
      {children}
    </AntButton>
  );
}

function Badge({ children, tone = 'green' }) {
  useLocale();
  const colors = { green: 'success', orange: 'warning', red: 'error', blue: 'processing', gray: 'default' };
  return <Tag color={colors[tone] || tone}>{children}</Tag>;
}

function ProductArt({ product, size = "normal", preview = true }) {
  useLocale();
  if (product.image) return <ProductImage src={product.image} alt={product.name} preview={preview} thumbnailSize={size === 'large' ? 200 : 100} className={`product-art art-${size}`} />;
  const iconSize = size === 'large' ? 26 : size === 'small' ? 15 : 18;
  return (
    <span className={`product-art product-art-placeholder art-${size}`} aria-hidden="true">
      <Package size={iconSize} strokeWidth={1.65} />
    </span>
  );
}

function Modal({ title, subtitle, children, onClose, wide = false, className = "", headerActions, closeLabel = translate("system.close.dialog"),
  presentation = 'dialog', drawerSize = 'standard', headerNavigation, footer }) {
  useLocale();
  const drawer = presentation === 'drawer' && !mobileDevice;
  const { preferences } = usePreferences();
  const closeOnBackdrop = mobileDevice || drawer ? preferences.closeDrawerOnBackdrop : preferences.closeModalOnBackdrop;
  const pressedBackdrop = useRef(false);
  const titleId = useId();
  const ref = useRef();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const closeBackdrop = () => {
    if (!closeOnBackdrop || document.querySelector('.image-viewer, .camera-scanner-immersive')) return;
    if ([...document.querySelectorAll('.modal[role="dialog"]')].at(-1) !== ref.current) return;
    closeRef.current();
  };
  const backdropEvents = {
    onPointerDown: event => { pressedBackdrop.current = event.target === event.currentTarget && event.button === 0; },
    onPointerCancel: () => { pressedBackdrop.current = false; },
    onClick: event => {
      const pressed = pressedBackdrop.current;
      pressedBackdrop.current = false;
      if (event.target !== event.currentTarget) return;
      event.stopPropagation();
      if (pressed) closeBackdrop();
    },
  };
  useEffect(() => {
    const old = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Disable the page without disabling portals opened above this drawer.
    const backgrounds = [];
    if (drawer) {
      let branch = ref.current.parentElement;
      while (branch && branch !== document.body) {
        for (const sibling of branch.parentElement.children) {
          if (sibling === branch || !(sibling instanceof HTMLElement) || sibling.matches('script, style, link')) continue;
          backgrounds.push([sibling, sibling.inert]);
          sibling.inert = true;
        }
        branch = branch.parentElement;
      }
    }
    // Focusing the dialog keeps mobile keyboards closed until a field is tapped.
    const first = mobileDevice ? ref.current : drawer ?
      ref.current.querySelector('[data-autofocus]') || ref.current :
      ref.current.querySelector("[data-autofocus]") ||
      [...ref.current.querySelectorAll("input:not(:disabled)")].find((el) => el.offsetParent !== null) ||
      ref.current.querySelector("button:not(:disabled)");
    first?.focus({ preventScroll: mobileDevice || drawer });
    const key = (e) => {
      if (e.defaultPrevented || document.querySelector('.image-viewer, .camera-scanner-immersive')) return;
      if ([...document.querySelectorAll('.modal[role="dialog"]')].at(-1) !== ref.current) return;
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const targets = [
          ...ref.current.querySelectorAll(
            "button, input, select, textarea, a[href]",
          ),
        ].filter((el) => !el.matches(":disabled") && el.tabIndex >= 0 && el.offsetParent !== null);
        const first = targets[0],
          last = targets.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    const back = event => {
      if (event.defaultPrevented || document.querySelector('.image-viewer, .camera-scanner-immersive')) return;
      if ([...document.querySelectorAll('.modal[role="dialog"]')].at(-1) !== ref.current) return;
      event.preventDefault();
      closeRef.current();
    };
    if (mobileDevice) window.addEventListener('erp:back-modal', back);
    return () => {
      for (const [element, inert] of backgrounds) element.inert = inert;
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key);
      window.removeEventListener('erp:back-modal', back);
      if (old?.isConnected) old.focus({ preventScroll: drawer });
      else if (drawer) {
        const page = document.querySelector('main');
        if (page) { page.tabIndex = -1; page.focus({ preventScroll: true }); }
      }
    };
  }, []);
  const content = <section
        ref={ref}
        className={`modal ${wide ? "modal-wide" : ""} ${drawer ? `modal-drawer drawer-${drawerSize}` : ''} ${className}`}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          {drawer && headerNavigation}
          <div className="modal-header-title">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <div className="modal-header-actions">
          {headerActions}
          <AntButton type="text"
            htmlType="button"
            className="icon-button"
            onClick={onClose}
            aria-label={closeLabel}
            title={closeLabel}
          >
            <X size={20} />
          </AntButton>
          </div>
        </div>
        {children}
        {drawer && footer}
      </section>;
  if (mobileDevice) return <Popup visible forceRender position="bottom" closeOnMaskClick={false}
    disableBodyScroll={false} onClose={onClose} onMaskClick={closeBackdrop} className="erp-mobile-popup"
    bodyClassName="erp-mobile-popup-body" maskClassName="erp-mobile-popup-mask">
    <div className="modal-backdrop erp-mobile-popup-layout" {...backdropEvents}>{content}</div>
  </Popup>;
  return <div className={`modal-backdrop${drawer ? ' drawer-backdrop' : ''}`} {...backdropEvents}>{content}</div>;
}

function Empty({ title = translate("system.no.records"), description = translate("system.new.records.will.appear.here"), action }) {
  useLocale();
  return <AntEmpty description={<><h3>{title}</h3><p>{description}</p></>}>{action}</AntEmpty>;
}

function PageHeading({ title, description, children }) {
  useLocale();
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  extra,
  children,
  className = "",
  subtitle,
}) {
  useLocale();
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>
            {Icon && <Icon size={16} />} {title}
          </h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}

function QueryStatus({ query, block = false }) {
  useLocale();
  if (query.loading) return block
    ? <LoadingStatus block>{translate("system.reading.data")}</LoadingStatus>
    : <p><LoadingStatus>{translate("system.reading.data")}</LoadingStatus></p>;
  if (query.error) return <div role="alert" className="info-box">{query.error}<Button onClick={query.retry}>{translate("system.reload")}</Button></div>;
  return null;
}

function Pagination({ total, page, setPage }) {
  useLocale();
  return <div className="pagination">
    <span>{translate("system.total.2")}{" "}<strong>{total}</strong>{" "}{translate("system.records.2")}{total > 0 && translate("system.showing.items", { v0: (page - 1) * 8 + 1, v1: Math.min(page * 8, total) })}</span>
    <AntPagination current={page} total={total} pageSize={8} onChange={setPage} showSizeChanger={false} responsive
      itemRender={(number, type, original) => type === 'prev' || type === 'next'
        ? <AntButton type="text" aria-label={type === 'prev' ? translate("system.previous.page") : translate("system.next.page")}
            disabled={type === 'prev' ? page <= 1 : page >= Math.ceil(total / 8)}
            icon={type === 'prev' ? <ChevronLeft size={16} /> : <ChevronRight size={16} />} />
        : original} />
  </div>;
}

function CategoryTree({ categories, counts = [], active = false, selected, onSelect }) {
  useLocale();
  const [collapsed, setCollapsed] = useState(new Set());
  const render = (parent = null, depth = 0) => categories.filter(c => c.parent_id === parent).map(c => {
    const children = categories.some(child => child.parent_id === c.id);
    const branch = categoryBranch(categories, c.id);
    const total = counts.filter(row => branch.has(row.category_id)).reduce((sum, row) => sum + (active ? row.active : row.total), 0);
    return <li key={c.id}>
      <div className="category-tree-row" style={{ paddingLeft: depth * 14 }}>
        {children ? <AntButton type="text" htmlType="button" className="category-expand" aria-label={`${collapsed.has(c.id) ? translate("system.expand") : translate("system.fold")} ${c.name}`} aria-expanded={!collapsed.has(c.id)} onClick={() => setCollapsed(current => { const next = new Set(current); next.has(c.id) ? next.delete(c.id) : next.add(c.id); return next; })}>{collapsed.has(c.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</AntButton> : <span className="category-expand" />}
        <AntButton type="text" htmlType="button" className={`category-select ${selected === c.id ? 'active' : ''}`} aria-pressed={selected === c.id} onClick={() => onSelect(c.id)}><span>{c.name}</span><small>{total}</small></AntButton>
      </div>
      {children && !collapsed.has(c.id) && <ul>{render(c.id, depth + 1)}</ul>}
    </li>;
  });
  return <nav aria-label={translate("system.material.classification.tree")} className="category-tree">
    <AntButton type="text" htmlType="button" className={`category-select ${selected === null ? 'active' : ''}`} aria-pressed={selected === null} onClick={() => onSelect(null)}><span>{translate("system.all.materials")}</span><small>{counts.reduce((sum, row) => sum + (active ? row.active : row.total), 0)}</small></AntButton>
    <ul>{render()}</ul>
    {!categories.length && <p className="muted">{translate("system.there.is.no.category.yet.please.add.a.category")}</p>}
  </nav>;
}

function ProductName({ product, onView }) {
  useLocale();
  return <AntButton type="text" htmlType="button" className="product-name-link" aria-label={translate("system.view.material.details", { v0: product.name })} onClick={() => onView(product)}>{product.name}</AntButton>;
}

export { Button, Badge, ProductArt, Modal, Empty, PageHeading, Panel, QueryStatus, Pagination, CategoryTree, ProductName };
