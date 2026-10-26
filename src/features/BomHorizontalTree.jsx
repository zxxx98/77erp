import { ChevronDown, ChevronRight } from 'lucide-react';
import { bomUsageLabels } from '../i18n/production-display.js';
import { t, getFormatLocale, translateText } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import './bom-horizontal-tree.css';

const count = value => Number(value).toLocaleString(getFormatLocale(), { maximumFractionDigits: 4 });

// The browser owns calculation, search, scope and selection; this renderer only
// turns the visible hierarchy into left-to-right branches on every screen size.
export function BomHorizontalTree({ groups, root, scope, expanded, searching, includedPaths, matchedPaths, selectedPath, onToggle, onSelect, onBranch }) {
  useLocale();
  const branch = parent => {
    const children = (groups.get(parent) || []).filter(node => !searching || includedPaths.has(node.path));
    if (!children.length) return null;
    return <ul className="bom-horizontal-children">{children.map(node => {
      const expandable = node.usage_mode === 'explode', open = searching || expanded.has(node.path);
      return <li className="bom-horizontal-branch" key={node.path}>
        <div className="bom-horizontal-node" data-node-path={node.path} data-selected={selectedPath === node.path || undefined} data-match={searching && matchedPaths.has(node.path) || undefined}>
          <button type="button" className="bom-node-name" aria-label={t('production.viewDetails2', { v0: node.name })} onClick={event => onSelect(node.path, event.currentTarget)}>{node.name}</button>
          <small>{node.barcode}</small>
          <div className="bom-node-tags"><span>{translateText(node.current_production_type) || t('production.productionTypeNotSet')}</span><span>{t('production.structureLevelValue', { level: node.path.split('.').length })}</span></div>
          <p className="bom-horizontal-quantity">{count(node.required)} {node.unit}</p>
          <small>{bomUsageLabels[node.usage_mode]}</small>
          {expandable && <div className="bom-horizontal-actions">
            <button type="button" className="bom-tree-action" disabled={searching} aria-expanded={open} aria-label={`${t(open ? 'production.collapse' : 'production.expand')} ${node.name}`} onClick={() => onToggle(node.path)}>
              {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}{t(open ? 'production.collapse' : 'production.expand')}
            </button>
            <button type="button" className="bom-tree-action" aria-label={t('production.openBranch', { v0: node.name })} onClick={() => onBranch(node.path)}>{t('production.openBranch2')}</button>
          </div>}
        </div>
        {expandable && open && branch(node.path)}
      </li>;
    })}</ul>;
  };
  return <div className="bom-horizontal-tree">
    <div className="bom-horizontal-root bom-horizontal-node" data-node-path={scope}>
      <strong>{root.name}</strong><small>{scope ? t('production.openBranch2') : t('production.finalProduct')}</small>
      <p className="bom-horizontal-quantity">{count(root.quantity)} {root.unit}</p>
    </div>
    {branch(searching ? '' : scope)}
    {searching && !includedPaths.size && <p className="bom-empty">{t('production.noMatchingMaterialsTryAnotherNameOrCode')}</p>}
  </div>;
}
