import { useId, useState } from 'react';
import { useLocale } from '../i18n/react.jsx';
import { t } from '../i18n/index.js';

export function ProductionDetailTabs({ active, onChange, items }) {
  useLocale();
  const id = useId();
  const [visited, setVisited] = useState(() => new Set([active]));
  const select = (key, target) => {
    setVisited(previous => new Set([...previous, key]));
    onChange(key);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const keyboard = (event, index) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % items.length
      : event.key === 'ArrowLeft' ? (index + items.length - 1) % items.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    select(items[next].key, document.getElementById(`${id}-${items[next].key}`));
  };
  return <div className="production-detail-tabs">
    <div className="production-tab-list" role="tablist" aria-label={t('production.detailSections')}>
      {items.map((item, index) => <button key={item.key} type="button" role="tab" id={`${id}-${item.key}`}
        aria-selected={active === item.key} aria-controls={`${id}-${item.key}-panel`} tabIndex={active === item.key ? 0 : -1}
        onClick={event => select(item.key, event.currentTarget)} onKeyDown={event => keyboard(event, index)}>{item.label}</button>)}
    </div>
    {items.map(item => <div key={item.key} role="tabpanel" id={`${id}-${item.key}-panel`} aria-labelledby={`${id}-${item.key}`}
      hidden={active !== item.key} tabIndex={0} className="production-tab-panel">
      {(active === item.key || visited.has(item.key)) && item.children}
    </div>)}
  </div>;
}
