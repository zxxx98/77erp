import { useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
import './sortable-list.css';

const EMPTY = [];

const scrollParent = element => {
  for (let node = element?.parentElement; node && node !== document.body; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node;
  }
  return window;
};

/**
 * Pointer based drag-to-reorder (mouse, touch and pen) with keyboard fallback on the handle.
 * `items` need a numeric `id`; `onReorder(ids)` resolves true when the new order was saved.
 * Until fresh `items` arrive the optimistic order is kept, and it is dropped if saving fails.
 */
export function useSortableList({ items = EMPTY, enabled, onReorder }) {
  const [local, setLocal] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const drag = useRef(null);

  useEffect(() => { if (!drag.current) setLocal(null); }, [items]);

  const ordered = useMemo(() => {
    if (!local) return items;
    const byId = new Map(items.map(item => [item.id, item]));
    const list = local.filter(id => byId.has(id)).map(id => byId.get(id));
    return list.length === items.length ? list : items;
  }, [items, local]);

  const save = async (ids, previous) => {
    if (ids.join() === previous.join()) { setLocal(null); return; }
    setLocal(ids);
    if (!await onReorder(ids)) setLocal(null);
  };
  const finish = () => {
    const state = drag.current;
    drag.current = null;
    setDraggingId(null);
    if (state) save(state.ids, state.start);
  };

  const handleProps = id => ({
    disabled: !enabled,
    onPointerDown: event => {
      if (!enabled || event.button > 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const ids = ordered.map(item => item.id);
      drag.current = { id, ids, start: ids, scroller: scrollParent(event.currentTarget) };
      setLocal(ids);
      setDraggingId(id);
    },
    onPointerMove: event => {
      const state = drag.current;
      if (!state || state.id !== id) return;
      const edge = 80, top = state.scroller === window ? 0 : state.scroller.getBoundingClientRect().top,
        bottom = state.scroller === window ? window.innerHeight : state.scroller.getBoundingClientRect().bottom;
      if (event.clientY < top + edge) state.scroller.scrollBy(0, -16);
      else if (event.clientY > bottom - edge) state.scroller.scrollBy(0, 16);
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-sortable-id]');
      if (!target) return;
      const overId = Number(target.dataset.sortableId), from = state.ids.indexOf(id), to = state.ids.indexOf(overId);
      if (overId === id || to < 0) return;
      const rect = target.getBoundingClientRect(), middle = rect.top + rect.height / 2;
      if (to < from ? event.clientY < middle : event.clientY > middle) {
        const next = [...state.ids];
        next.splice(from, 1);
        next.splice(to, 0, id);
        state.ids = next;
        setLocal(next);
      }
    },
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: () => { if (drag.current) finish(); },
    onKeyDown: event => {
      if (!enabled || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
      event.preventDefault();
      const ids = ordered.map(item => item.id), from = ids.indexOf(id), to = from + (event.key === 'ArrowUp' ? -1 : 1);
      if (to < 0 || to >= ids.length) return;
      const next = [...ids];
      next.splice(from, 1);
      next.splice(to, 0, id);
      const button = event.currentTarget;
      save(next, ids).then(() => button.focus());
    },
  });
  const itemProps = id => ({ 'data-sortable-id': id, 'data-dragging': draggingId === id ? 'true' : undefined });
  return { ordered, draggingId, handleProps, itemProps };
}

export function SortHandle({ sortable, id, label }) {
  return <button type="button" className="sort-handle" aria-label={label} title={label} {...sortable.handleProps(id)}>
    <GripVertical size={18} aria-hidden="true" />
  </button>;
}
