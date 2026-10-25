import { productionMessage } from '../i18n/production-errors.js';
import { bomLossMethodLabels, bomUsageLabels } from '../i18n/production-display.js';
import { t as pt, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Drawer } from 'antd';
import { ArrowLeft, ChevronDown, ChevronRight, X } from 'lucide-react';
import { Input } from '../ui/controls.jsx';
import { mobileDevice } from '../device.js';
import { usePreferences } from '../preferences.jsx';
import { calculateBomNodes } from '../../shared/bom-expansion.js';

import './bom-structure.css';

const count = value => Number(value).toLocaleString(getFormatLocale(), { maximumFractionDigits: 4 });
const emptyNodes = [];
const narrowQuery = '(max-width: 760px)';
const subscribeSize = callback => {
  const media = window.matchMedia(narrowQuery);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
};
const isNarrow = () => mobileDevice || window.matchMedia(narrowQuery).matches;
const onServer = () => false;

function NodeDetails({ node, path, onClose }) {
  useLocale();
  return <section className="bom-node-details" aria-label={pt("production.nodeDetails")}>
    <div className="bom-node-details-heading"><h3>{node.name}</h3><button type="button" className="bom-tree-icon" aria-label={pt("production.closeNodeDetails")} onClick={onClose}><X size={18} /></button></div>
    <p className="bom-node-path">{path}</p>
    <dl>
      <dt>{pt("production.materialCode")}</dt><dd>{node.barcode || '—'}</dd>
      <dt>{pt("production.structurePath")}</dt><dd>{node.path}</dd>
      <dt>{pt("production.currentRequirement")}</dt><dd>{count(node.required)} {node.unit}</dd>
      <dt>{pt("production.materialSupplyMethod")}</dt><dd>{bomUsageLabels[node.usage_mode]}</dd>
      <dt>{pt("production.sourceRecipe")}</dt><dd>{node.bom_name} #{node.bom_id} {pt("production.revision")} {node.bom_version}</dd>
      <dt>{pt("production.baseOutput")}</dt><dd>{count(node.bom_base_quantity)} {node.bom_base_unit}</dd>
      <dt>{pt("production.baseNetUsage")}</dt><dd>{node.quantity_fraction || count(node.quantity)} {node.unit}</dd>
      <dt>{pt("production.standardLoss")}</dt><dd>{count(node.loss_rate)}% · {bomLossMethodLabels[node.loss_method]}</dd>
      {node.child_bom_id && <><dt>{pt("production.childRecipe")}</dt><dd>#{node.child_bom_id}</dd></>}
      {node.note && <><dt>{pt("production.note")}</dt><dd>{node.note}</dd></>}
    </dl>
    {node.usage_mode === 'explode' && <p className="bom-hint">{pt("production.thisSemiFinishedItemIsNeitherIssuedNor")}</p>}
  </section>;
}

export function BomStructure({ nodes = emptyNodes, quantity, sourceSelection, active = true }) {
  useLocale();
  // Changing production quantity keeps the current view. Replacing a recipe or
  // snapshot starts at its root, since positional paths can name different goods.
  const identity = useMemo(() => JSON.stringify(nodes.map(node => [node.path, node.product_id, node.bom_id, node.bom_version, node.usage_mode, node.child_bom_id])), [nodes]);
  return <StructureBrowser key={identity} nodes={nodes} quantity={quantity} sourceSelection={sourceSelection} active={active} />;
}

function StructureBrowser({ nodes, quantity, sourceSelection, active }) {
  useLocale();
  const { preferences } = usePreferences();
  const narrow = useSyncExternalStore(subscribeSize, isNarrow, onServer);
  const [expanded, setExpanded] = useState(() => new Set());
  const [scope, setScope] = useState(''), [query, setQuery] = useState(''), [productFilter, setProductFilter] = useState(null);
  const [selectedPath, setSelectedPath] = useState(null);
  const viewport = useRef(null), positions = useRef(new Map()), detailTrigger = useRef(null), breadcrumb = useRef(null);
  const previousScope = useRef(''), searchPosition = useRef(null);
  const calculation = useMemo(() => {
    try { return { rows: nodes.length ? calculateBomNodes(nodes, Number(quantity)).nodes : [] }; }
    catch (error) { return { rows: [], error: error.message }; }
  }, [nodes, quantity]);
  const { rows, error } = calculation;
  const { byPath, groups } = useMemo(() => {
    const byPath = new Map(), groups = new Map();
    for (const node of rows) {
      byPath.set(node.path, node);
      if (!groups.has(node.parent_path)) groups.set(node.parent_path, []);
      groups.get(node.parent_path).push(node);
    }
    return { byPath, groups };
  }, [rows]);
  const rootName = rows[0]?.bom_product_name || pt("production.rootRecipe");
  const ancestors = path => {
    const result = [];
    for (let node = byPath.get(path); node; node = byPath.get(node.parent_path)) result.unshift(node);
    return result;
  };
  const fullPath = node => [rootName, ...ancestors(node.path).map(row => row.name)].join(' / ');
  const searching = !!query.trim() || productFilter !== null;
  const matches = useMemo(() => {
    if (productFilter !== null) return rows.filter(row => row.product_id === productFilter && row.usage_mode === 'stock');
    const term = query.trim().toLocaleLowerCase();
    return term ? rows.filter(row => `${row.name}\n${row.barcode}`.toLocaleLowerCase().includes(term)) : [];
  }, [rows, query, productFilter]);
  const matchedPaths = new Set(matches.map(row => row.path));
  const includedPaths = new Set(matches.flatMap(node => ancestors(node.path).map(row => row.path)));
  const visible = [];
  const append = (parent, level = 0) => {
    for (const node of groups.get(parent) || []) {
      if (searching && !includedPaths.has(node.path)) continue;
      visible.push({ node, level });
      if (!narrow && (searching || expanded.has(node.path))) append(node.path, level + 1);
    }
  };
  if (searching && narrow) matches.forEach(node => visible.push({ node, level: 0 }));
  else append(searching ? '' : scope);
  const selected = byPath.get(selectedPath);

  useEffect(() => {
    if (!sourceSelection) return;
    setQuery(sourceSelection.name); setProductFilter(sourceSelection.productId); setSelectedPath(null);
    if (viewport.current) viewport.current.scrollTop = 0;
  }, [sourceSelection]);
  useLayoutEffect(() => {
    const list = viewport.current;
    if (!list) return;
    if (previousScope.current !== scope) {
      previousScope.current = scope;
      list.scrollTop = positions.current.get(scope)?.scroll || 0;
      searchPosition.current = null;
    } else if (query.trim() || productFilter !== null) {
      searchPosition.current ??= list.scrollTop;
      const match = list.querySelector('[data-match="true"]');
      if (match) list.scrollTop += match.getBoundingClientRect().top - list.getBoundingClientRect().top - (list.querySelector('thead')?.offsetHeight || 0);
    } else if (searchPosition.current !== null) {
      list.scrollTop = searchPosition.current;
      searchPosition.current = null;
    }
  }, [scope, query, productFilter, narrow]);

  const navigate = path => {
    positions.current.set(scope, { scroll: viewport.current?.scrollTop || 0, query, productFilter });
    const saved = positions.current.get(path);
    setScope(path); setQuery(saved?.query || ''); setProductFilter(saved?.productFilter ?? null); setSelectedPath(null);
    breadcrumb.current?.focus({ preventScroll: true });
  };
  const toggle = path => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const expandTo = depth => {
    const baseDepth = scope ? scope.split('.').length : 0;
    setExpanded(new Set(rows.filter(node => node.usage_mode === 'explode' && (!scope || node.path.startsWith(`${scope}.`)) && node.path.split('.').length - baseDepth < depth).map(node => node.path)));
  };
  const restoreDetailFocus = () => detailTrigger.current?.focus({ preventScroll: true });
  const closeDetails = () => { setSelectedPath(null); if (!narrow) restoreDetailFocus(); };
  const clearSearch = () => { setQuery(''); setProductFilter(null); };
  if (!nodes.length) return null;
  if (error) return <p className="bom-warning" role="alert">{productionMessage(error)}</p>;

  return <div className={`bom-structure${narrow ? ' is-drill' : ''}`} onKeyDown={event => { if (event.key === 'Escape' && selected) { event.stopPropagation(); closeDetails(); } }}>
    <div className="bom-structure-toolbar">
      <Input type="search" aria-label={pt("production.searchStructureMaterials")} placeholder={pt("production.searchMaterialNamesOrCodesAcrossTheRecipe")} maxLength={100} value={query}
        onChange={event => { setQuery(event.target.value); setProductFilter(null); }} />
      {searching ? <button type="button" className="bom-tree-action" onClick={clearSearch}>{pt("production.clearSearch")}</button> : !narrow && <div className="bom-depth-actions">
        <button type="button" className="bom-tree-action" onClick={() => expandTo(2)}>{pt("production.expandToLevel2")}</button>
        <button type="button" className="bom-tree-action" onClick={() => expandTo(3)}>{pt("production.expandToLevel3")}</button>
        <button type="button" className="bom-tree-action" onClick={() => setExpanded(new Set())}>{pt("production.collapseAll")}</button>
      </div>}
    </div>
    <nav className="bom-breadcrumb" aria-label={pt("production.bomPath")} ref={breadcrumb} tabIndex={-1}>
      <button type="button" aria-current={!scope ? 'location' : undefined} onClick={() => navigate('')}>{rootName}</button>
      {ancestors(scope).map(node => <span key={node.path}><ChevronRight size={14} aria-hidden="true" /><button type="button" aria-current={scope === node.path ? 'location' : undefined} onClick={() => navigate(node.path)}>{node.name}</button></span>)}
    </nav>
    <div className="bom-structure-context">
      {scope && !searching && <button type="button" className="bom-tree-action" onClick={() => navigate(byPath.get(scope)?.parent_path || '')}><ArrowLeft size={14} />{pt("production.backToParent")}</button>}
      <span role="status">{searching ? pt("production.matchesFoundInTheEntireRecipe", { v0: matches.length }) : pt("production.itemsAtCurrentLevel", { v0: groups.get(scope)?.length || 0, v1: scope ? pt("production.requirementsStillUseThisFinishedProductOutput") : '' })}</span>
    </div>
    <div className={`bom-structure-layout${selected && !narrow ? ' has-detail' : ''}`}>
      <div className="bom-structure-scroll" ref={viewport} tabIndex={0} aria-label={pt("production.recipeStructureList")}>
        <table className="bom-structure-table"><thead><tr><th scope="col">{pt("production.material2")}</th><th scope="col">{pt("production.materialSupplyMethod")}</th><th scope="col">{pt("production.currentRequirement")}</th><th scope="col"><span className="bom-visually-hidden">{pt("production.branchActions")}</span></th></tr></thead>
          <tbody>{visible.map(({ node, level }) => <tr className="bom-structure-row" key={node.path} data-selected={node.path === selectedPath || undefined} data-match={searching && matchedPaths.has(node.path) || undefined}>
            <td><div className="bom-tree-name" style={{ '--bom-indent': `${level * 16}px` }}>
              {!narrow && <span className="bom-tree-toggle">{node.usage_mode === 'explode' && <button type="button" className="bom-tree-icon" disabled={searching} aria-label={`${expanded.has(node.path) || searching ? pt("production.collapse") : pt("production.expand")} ${node.name}`} aria-expanded={searching || expanded.has(node.path)} onClick={() => toggle(node.path)}>{expanded.has(node.path) || searching ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>}</span>}
              <div><button type="button" className="bom-node-name" aria-label={pt("production.viewDetails2", { v0: node.name })} onClick={event => { detailTrigger.current = event.currentTarget; setSelectedPath(node.path); }}>{node.name}</button>
                <small>{node.barcode}</small>{narrow && <span className="bom-tree-mobile-mode">{bomUsageLabels[node.usage_mode]}</span>}
                {searching && narrow && <small className="bom-search-path">{fullPath(node)}</small>}
              </div>
            </div></td>
            <td className="bom-tree-mode">{bomUsageLabels[node.usage_mode]}</td>
            <td className="bom-tree-quantity">{count(node.required)} <span>{node.unit}</span></td>
            <td className="bom-tree-branch">{node.usage_mode === 'explode' && <button type="button" className="bom-tree-action" aria-label={pt("production.openBranch", { v0: node.name })} onClick={() => navigate(node.path)}>{narrow ? <ChevronRight size={18} /> : pt("production.openBranch2")}</button>}</td>
          </tr>)}</tbody>
        </table>
        {!visible.length && <p className="bom-empty">{pt("production.noMatchingMaterialsTryAnotherNameOrCode")}</p>}
      </div>
      {selected && !narrow && <NodeDetails node={selected} path={fullPath(selected)} onClose={closeDetails} />}
    </div>
    <p className="bom-hint">{pt("production.expandedByGrossRequirementsWithoutDeductingIntermediateStock2")}</p>
    {/* Retain the drawer shell so closing during its opening animation still restores focus. */}
    {narrow && <Drawer title={pt("production.materialDetails")} placement="bottom" size="80vh" open={!!selected && active} onClose={closeDetails}
      mask={{ closable: preferences.closeDrawerOnBackdrop }}
      afterOpenChange={open => { if (!open && active) restoreDetailFocus(); }} focusable={{ focusTriggerAfterClose: false }} closable={false}>
      {selected && <NodeDetails node={selected} path={fullPath(selected)} onClose={closeDetails} />}
    </Drawer>}
  </div>;
}
