import { ChevronDown, ChevronRight } from 'lucide-react';
import { bomUsageLabels } from '../i18n/production-display.js';
import { t as pt, getFormatLocale, translateText } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';

const formatCount = value => Number(value).toLocaleString(getFormatLocale(), { maximumFractionDigits: 4 });
const nodeLevel = node => pt('production.structureLevelValue', { level: node.path.split('.').length });
const productionType = node => translateText(node.current_production_type) || pt('production.productionTypeNotSet');

export function BomStructureTable({
  visible,
  narrow,
  searching,
  expanded,
  matchedPaths,
  selectedPath,
  fullPath,
  onToggle,
  onNavigate,
  onSelect,
}) {
  useLocale();
  return <table className="bom-structure-grid-table">
    <thead>
      <tr>
        {!narrow && <th scope="col" className="bom-struct-col-path">{pt('production.structurePathCol')}</th>}
        <th scope="col" className="bom-struct-col-name">{pt('production.material2')}</th>
        {!narrow && <th scope="col" className="bom-struct-col-code">{pt('production.materialCode')}</th>}
        {!narrow && <th scope="col" className="bom-struct-col-type">{pt('production.structureTypeLevelCol')}</th>}
        {!narrow && <th scope="col" className="bom-struct-col-mode">{pt('production.materialSupplyMethod')}</th>}
        {!narrow && <th scope="col" className="bom-struct-col-base bom-col-num">{pt('production.baseNetUsage')}</th>}
        {!narrow && <th scope="col" className="bom-struct-col-loss bom-col-num">{pt('production.lossRateCol')}</th>}
        <th scope="col" className="bom-struct-col-req bom-col-num">{pt('production.currentRequirement')}</th>
        <th scope="col" className="bom-struct-col-branch"><span className="bom-visually-hidden">{pt('production.branchActions')}</span></th>
      </tr>
    </thead>
    <tbody>
      {visible.map(({ node, level }) => {
        const isExplode = node.usage_mode === 'explode';
        const isExpanded = searching || expanded.has(node.path);
        return <tr
          className="bom-structure-row"
          key={node.path}
          data-selected={node.path === selectedPath || undefined}
          data-match={(searching && matchedPaths.has(node.path)) || undefined}
          data-explode={isExplode || undefined}
        >
          {!narrow && <td className="bom-struct-col-path bom-mono">{node.path}</td>}
          <td className="bom-struct-col-name">
            <div className="bom-tree-name" style={{ '--bom-indent': `${level * 18}px` }}>
              {!narrow && <span className="bom-tree-toggle">
                {isExplode && <button
                  type="button"
                  className="bom-tree-icon"
                  disabled={searching}
                  aria-label={`${isExpanded ? pt('production.collapse') : pt('production.expand')} ${node.name}`}
                  aria-expanded={isExpanded}
                  onClick={() => onToggle(node.path)}
                >
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>}
              </span>}
              <div>
                <button
                  type="button"
                  className="bom-node-name"
                  aria-label={pt('production.viewDetails2', { v0: node.name })}
                  onClick={event => onSelect(node.path, event.currentTarget)}
                >
                  {node.name}
                </button>
                {narrow && <div className="bom-node-tags">
                  <span className="bom-node-type">{productionType(node)}</span>
                  <span>{nodeLevel(node)}</span>
                </div>}
                {narrow && <small className="bom-mono">
                  {node.barcode} · {node.quantity_fraction || formatCount(node.quantity)} {node.unit} · {formatCount(node.loss_rate)}% · {bomUsageLabels[node.usage_mode]}
                </small>}
                {searching && narrow && <small className="bom-search-path">{fullPath(node)}</small>}
              </div>
            </div>
          </td>
          {!narrow && <td className="bom-struct-col-code bom-mono">{node.barcode || '—'}</td>}
          {!narrow && <td className="bom-struct-col-type">
            <div className="bom-node-tags">
              <span className="bom-node-type">{productionType(node)}</span>
              <span>{nodeLevel(node)}</span>
            </div>
          </td>}
          {!narrow && <td className="bom-struct-col-mode bom-tree-mode">{bomUsageLabels[node.usage_mode]}</td>}
          {!narrow && <td className="bom-struct-col-base bom-col-num">
            <span className="bom-num">{node.quantity_fraction || formatCount(node.quantity)}</span>{' '}
            <span className="bom-unit">{node.unit}</span>
          </td>}
          {!narrow && <td className="bom-struct-col-loss bom-col-num">
            <span className="bom-num">{formatCount(node.loss_rate)}%</span>
          </td>}
          <td className="bom-struct-col-req bom-tree-quantity">
            {formatCount(node.required)} <span>{node.unit}</span>
          </td>
          <td className="bom-struct-col-branch bom-tree-branch">
            {isExplode && <button
              type="button"
              className="bom-tree-action"
              aria-label={pt('production.openBranch', { v0: node.name })}
              onClick={() => onNavigate(node.path)}
            >
              {narrow ? <ChevronRight size={18} /> : pt('production.openBranch2')}
            </button>}
          </td>
        </tr>;
      })}
    </tbody>
  </table>;
}
