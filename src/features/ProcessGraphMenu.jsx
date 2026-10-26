import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';
import { t } from '../i18n/index.js';

export function ProcessGraphMenu({ menu, limit, onCreate, onClose }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const element = ref.current, previous = document.activeElement;
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(menu.clientX, window.innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(menu.clientY, window.innerHeight - bounds.height - 8))}px`;
    (element.querySelector('button:not(:disabled)') || element).focus({ preventScroll: true });
    const outside = event => { if (!element.contains(event.target)) onClose(); };
    const dismiss = () => onClose();
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      if (element.contains(document.activeElement) && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [menu, onClose]);
  return createPortal(<div ref={ref} role="menu" tabIndex={-1} className="process-graph-menu" style={{ left: menu.clientX, top: menu.clientY }} onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      if (event.key === 'Tab' || event.key === 'Escape') onClose();
      if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); ref.current.querySelector('button:not(:disabled)')?.focus(); }
    }}>
    <button type="button" role="menuitem" disabled={!!limit} onClick={() => { onClose(); onCreate({ x: menu.x - 92, y: menu.y - 41, edge: menu.edge }); }}>
      <Plus size={16} aria-hidden="true" />{t(menu.edge ? 'route.insertNode' : 'route.createNode')}
    </button>
    {limit && <p role="status">{t(limit)}</p>}
  </div>, document.body);
}
