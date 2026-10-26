import { useCallback, useEffect, useRef, useState } from 'react';

export function useProcessGraphGestures({ onCreate, disabled }) {
  const canvasRef = useRef(null), active = useRef(null), press = useRef(null);
  const [line, setLine] = useState(null), [menu, setMenu] = useState(null);
  const editable = !!onCreate;
  const closeMenu = useCallback(() => setMenu(null), []);
  const stopPress = () => { clearTimeout(press.current?.timer); press.current = null; };
  const stopLine = () => { active.current = null; setLine(null); };
  useEffect(() => {
    if (!editable) return;
    const cancel = () => { stopPress(); stopLine(); setMenu(null); };
    const key = event => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('keydown', key);
    window.addEventListener('blur', cancel);
    return () => { stopPress(); active.current = null; window.removeEventListener('keydown', key); window.removeEventListener('blur', cancel); };
  }, [editable]);
  useEffect(() => { if (disabled) { stopPress(); stopLine(); setMenu(null); } }, [disabled]);

  const point = event => {
    const bounds = canvasRef.current.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  const menuTarget = target => {
    if (target.closest('.process-node, .process-node-handle')) return null;
    const edge = target.closest('.process-edge-hit');
    return edge ? { from: edge.dataset.from, to: edge.dataset.to } : undefined;
  };
  const openMenu = event => {
    if (!editable || disabled) return;
    const edge = menuTarget(event.target);
    if (edge === null) return;
    event.preventDefault(); stopPress(); stopLine();
    setMenu({ ...point(event), clientX: event.clientX, clientY: event.clientY, edge });
  };
  const canvasEvents = {
    onContextMenu: openMenu,
    onPointerDown: event => {
      if (!editable || disabled || event.isPrimary === false || event.pointerType !== 'touch') return;
      const edge = menuTarget(event.target);
      if (edge === null) return;
      stopPress();
      const request = { ...point(event), clientX: event.clientX, clientY: event.clientY, edge };
      press.current = { x: event.clientX, y: event.clientY, timer: setTimeout(() => { press.current = null; setMenu(request); }, 550) };
    },
    onPointerMove: event => { if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 8) stopPress(); },
    onPointerUp: stopPress,
    onPointerCancel: stopPress,
  };
  const handleEvents = (node, direction, limited) => ({
    onPointerDown: event => {
      event.stopPropagation();
      if (disabled || limited || event.button !== 0 || event.isPrimary === false || active.current) return;
      event.preventDefault(); stopPress(); closeMenu();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      active.current = { anchorId: node.id, direction, pointerId: event.pointerId, start: { x: node.x + (direction === 'after' ? 184 : 0), y: node.y + 41 }, origin: point(event) };
    },
    onPointerMove: event => {
      const current = active.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const end = point(event);
      if (Math.hypot(end.x - current.origin.x, end.y - current.origin.y) > 8) setLine({ ...current, end });
    },
    onPointerUp: event => {
      const current = active.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const end = point(event), target = document.elementFromPoint(event.clientX, event.clientY);
      stopLine();
      if (disabled || limited || Math.hypot(end.x - current.origin.x, end.y - current.origin.y) <= 8) return;
      if (!target || target.closest('.process-canvas') !== canvasRef.current || target.closest('.process-node, .process-node-handle, .process-edge-hit')) return;
      onCreate({ anchorId: current.anchorId, direction, x: end.x - (direction === 'before' ? 184 : 0), y: end.y - 41 });
    },
    onPointerCancel: stopLine,
    onLostPointerCapture: stopLine,
    // Keyboard activation offers the same operation without a drag gesture.
    onClick: event => { if (!disabled && !limited && event.detail === 0) onCreate({ anchorId: node.id, direction, x: node.x + (direction === 'before' ? -240 : 240), y: node.y }); },
    onContextMenu: event => event.preventDefault(),
  });
  return { canvasRef, line, menu, closeMenu, canvasEvents, handleEvents };
}
