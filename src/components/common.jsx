import { Pagination as AntPagination } from 'antd';
import { Spin, Button as AntButton, Tag, Empty as AntEmpty } from '../ui/controls.jsx';
import { Popup } from 'antd-mobile';

import { usePermissions } from '../permissions.jsx';
import { LoadingIndicator, LoadingStatus } from '../Loading.jsx';
import { ProductImage } from '../ProductImage.jsx';
import { useId, useRef, useEffect, useState } from 'react';
import { mobileDevice } from '../device.js';
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
  const colors = { green: 'success', orange: 'warning', red: 'error', blue: 'processing', gray: 'default' };
  return <Tag color={colors[tone] || tone}>{children}</Tag>;
}

function ProductArt({ product, size = "normal", preview = true }) {
  if (product.image) return <ProductImage src={product.image} alt={product.name} preview={preview} thumbnailSize={size === 'large' ? 200 : 100} className={`product-art art-${size}`} />;
  const n = product.name;
  const type = /杯/.test(n)
    ? /保温/.test(n)
      ? "bottle"
      : "cup"
    : /笔记本/.test(n)
      ? "book"
      : /线/.test(n)
        ? "cable"
        : /袋|毛巾/.test(n)
          ? "bag"
          : /笔/.test(n)
            ? "pen"
            : /音箱|鼠标/.test(n)
              ? "speaker"
              : "box";
  return (
    <span className={`product-art art-${product.color || "blue"} art-${size}`}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        {type === "cup" && (
          <>
            <path
              d="M13 15h23v17c0 6-23 6-23 0z"
              fill="#f1e6d7"
              stroke="#bcaa91"
              strokeWidth="1.5"
            />
            <ellipse
              cx="24.5"
              cy="15"
              rx="11.5"
              ry="3.5"
              fill="#f9f4ec"
              stroke="#bcaa91"
              strokeWidth="1.5"
            />
            <ellipse cx="24.5" cy="15" rx="8" ry="1.8" fill="#d3c1a8" />
            <path
              d="M36 19h3c7 0 7 12-3 12"
              fill="none"
              stroke="#bcaa91"
              strokeWidth="2.5"
            />
            <path d="M17 20v11" stroke="#fff" strokeWidth="2" opacity=".8" />
          </>
        )}
        {type === "bottle" && (
          <>
            <rect x="18" y="8" width="14" height="5" rx="2" fill="#8fadb7" />
            <rect x="17" y="13" width="16" height="28" rx="5" fill="#aec3cb" />
            <path d="M20 17v18" stroke="#e9f4f7" strokeWidth="2" />
            <path d="M17 32h16" stroke="#93aeb8" strokeWidth="1.5" />
          </>
        )}
        {type === "book" && (
          <>
            <path d="M12 12l22-3 3 28-22 3z" fill="#819b85" />
            <path
              d="M14 10l22-3 3 28-22 3z"
              fill="#a9bfa8"
              stroke="#748e78"
              strokeWidth="1"
            />
            <path d="M18 10l3 28" stroke="#64856c" strokeWidth="2" />
            <path
              d="M23 17l11-1m-10 5 11-1"
              stroke="#e5eee3"
              strokeWidth="1.5"
            />
            <path d="M16 39l22-3" stroke="#e9eee5" strokeWidth="2" />
          </>
        )}
        {type === "cable" && (
          <>
            <path
              d="M29 13c-18-5-20 15-9 20 10 5 18-6 12-11-8-7-18 6-8 12"
              fill="none"
              stroke="#9c91bb"
              strokeWidth="2.5"
            />
            <rect x="27" y="9" width="8" height="7" rx="2" fill="#8373a8" />
            <rect x="26" y="33" width="6" height="7" rx="1.5" fill="#8373a8" />
            <path d="M30 8v-3m-2 36v3" stroke="#b3adbc" strokeWidth="3" />
          </>
        )}
        {type === "bag" && (
          <>
            <path
              d="M13 18h23l3 22H10z"
              fill="#d4c3a6"
              stroke="#b4a389"
              strokeWidth="1"
            />
            <path
              d="M18 21v-8a6 6 0 0 1 12 0v8"
              fill="none"
              stroke="#b4a389"
              strokeWidth="2"
            />
            <path d="M22 28h8m-8 3h5" stroke="#af9b7c" strokeWidth="1.5" />
          </>
        )}
        {type === "pen" && (
          <>
            <path d="M15 35 30 9l5 3-15 26-6 3z" fill="#7e9a91" />
            <path d="m29 10 3-5 5 3-3 5" fill="#bbcfc7" />
            <path d="m18 35 14-23" stroke="#d2e1da" strokeWidth="1.5" />
            <path d="m14 41 2-7 4 3z" fill="#445d54" />
          </>
        )}
        {type === "speaker" && (
          <>
            <rect x="10" y="15" width="30" height="23" rx="7" fill="#819ca8" />
            <rect x="12" y="17" width="26" height="18" rx="5" fill="#a8bec8" />
            {[18, 23, 28, 33].map((x) => (
              <path
                key={x}
                d={`M${x} 21v10`}
                stroke="#6e8c9b"
                strokeWidth="1"
                strokeDasharray="1 2"
              />
            ))}
            <path
              d="M23 12h5"
              stroke="#819ca8"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </>
        )}
        {type === "box" && (
          <>
            <path d="m11 17 14-7 14 7-14 8z" fill="#dfbfc5" stroke="#b99098" />
            <path d="m11 17 14 8v16l-14-8z" fill="#d3a9b1" />
            <path d="m25 25 14-8v16l-14 8z" fill="#c799a3" />
            <path
              d="m18 13 14 8v8"
              fill="none"
              stroke="#f8e6e9"
              strokeWidth="3"
            />
          </>
        )}
      </svg>
    </span>
  );
}

function Modal({ title, subtitle, children, onClose, wide = false, className = "", headerActions, closeLabel = '关闭弹窗',
  presentation = 'dialog', drawerSize = 'standard', headerNavigation, footer }) {
  const drawer = presentation === 'drawer' && !mobileDevice;
  const titleId = useId();
  const ref = useRef();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
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
    disableBodyScroll={false} onClose={onClose} className="erp-mobile-popup"
    bodyClassName="erp-mobile-popup-body" maskClassName="erp-mobile-popup-mask">
    <div className="modal-backdrop erp-mobile-popup-layout">{content}</div>
  </Popup>;
  return <div className={`modal-backdrop${drawer ? ' drawer-backdrop' : ''}`}>{content}</div>;
}

function Empty({ title = '暂无记录', description = '新的记录会出现在这里。', action }) {
  return <AntEmpty description={<><h3>{title}</h3><p>{description}</p></>}>{action}</AntEmpty>;
}

function PageHeading({ eyebrow, title, description, children }) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
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
  if (query.loading) return block
    ? <LoadingStatus block>正在读取数据…</LoadingStatus>
    : <p><LoadingStatus>正在读取数据…</LoadingStatus></p>;
  if (query.error) return <div role="alert" className="info-box">{query.error}<Button onClick={query.retry}>重新加载</Button></div>;
  return null;
}

function Pagination({ total, page, setPage }) {
  return <div className="pagination">
    <span>共 <strong>{total}</strong> 条记录{total > 0 && `，显示 ${(page - 1) * 8 + 1}–${Math.min(page * 8, total)} 条`}</span>
    <AntPagination current={page} total={total} pageSize={8} onChange={setPage} showSizeChanger={false} responsive
      itemRender={(number, type, original) => type === 'prev' || type === 'next'
        ? <AntButton type="text" aria-label={type === 'prev' ? '上一页' : '下一页'}
            disabled={type === 'prev' ? page <= 1 : page >= Math.ceil(total / 8)}
            icon={type === 'prev' ? <ChevronLeft size={16} /> : <ChevronRight size={16} />} />
        : original} />
  </div>;
}

function CategoryTree({ categories, counts = [], active = false, selected, onSelect }) {
  const [collapsed, setCollapsed] = useState(new Set());
  const render = (parent = null, depth = 0) => categories.filter(c => c.parent_id === parent).map(c => {
    const children = categories.some(child => child.parent_id === c.id);
    const branch = categoryBranch(categories, c.id);
    const total = counts.filter(row => branch.has(row.category_id)).reduce((sum, row) => sum + (active ? row.active : row.total), 0);
    return <li key={c.id}>
      <div className="category-tree-row" style={{ paddingLeft: depth * 14 }}>
        {children ? <AntButton type="text" htmlType="button" className="category-expand" aria-label={`${collapsed.has(c.id) ? '展开' : '折叠'} ${c.name}`} aria-expanded={!collapsed.has(c.id)} onClick={() => setCollapsed(current => { const next = new Set(current); next.has(c.id) ? next.delete(c.id) : next.add(c.id); return next; })}>{collapsed.has(c.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</AntButton> : <span className="category-expand" />}
        <AntButton type="text" htmlType="button" className={`category-select ${selected === c.id ? 'active' : ''}`} aria-pressed={selected === c.id} onClick={() => onSelect(c.id)}><span>{c.name}</span><small>{total}</small></AntButton>
      </div>
      {children && !collapsed.has(c.id) && <ul>{render(c.id, depth + 1)}</ul>}
    </li>;
  });
  return <nav aria-label="物料分类树" className="category-tree">
    <AntButton type="text" htmlType="button" className={`category-select ${selected === null ? 'active' : ''}`} aria-pressed={selected === null} onClick={() => onSelect(null)}><span>全部物料</span><small>{counts.reduce((sum, row) => sum + (active ? row.active : row.total), 0)}</small></AntButton>
    <ul>{render()}</ul>
    {!categories.length && <p className="muted">暂无分类，请添加分类。</p>}
  </nav>;
}

function ProductName({ product, onView }) {
  return <AntButton type="text" htmlType="button" className="product-name-link" aria-label={`查看 ${product.name} 物料详情`} onClick={() => onView(product)}>{product.name}</AntButton>;
}

export { Button, Badge, ProductArt, Modal, Empty, PageHeading, Panel, QueryStatus, Pagination, CategoryTree, ProductName };
