import { useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, Copy, Network, Plus, Power, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useBusiness } from '../business-api.js';
import { useQuery, queryPath } from '../queries.js';
import { PageHeading, Button, Badge, Modal, QueryStatus } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { SortHandle, useSortableList } from '../components/SortableList.jsx';
import { Input as AntInput } from '../ui/controls.jsx';
import { parseQuantity } from '../../shared/quantity.js';
import { parseBomQuantity, validateBom } from '../../shared/bom.js';
import { postProcessingMaterialPayload } from '../features/PostProcessingMaterialEditor.jsx';
import { validateScrapRules } from '../../shared/scrap.js';
import { BomProcessOverview } from '../features/ProcessOverview.jsx';
import { BomCalculation } from '../features/BomCalculation.jsx';
import { BomEditor, parseLossRate } from '../features/BomEditor.jsx';
import { productionMessage } from '../i18n/production-errors.js';
import { t as pt, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import './bom.css';

const count = value => Number(value).toLocaleString(getFormatLocale(), { maximumFractionDigits: 4 });
const editable = bom => ({
  ...bom,
  items: bom.items.map(item => ({ ...item, quantity: item.quantity_fraction || item.quantity })),
  post_processing_operations: (bom.post_processing_operations || []).map(row => ({ ...row,
    materials: row.materials.map(material => ({ ...material, quantity: material.quantity_fraction || material.quantity })) })),
  scraps: (bom.scraps || []).map(row => ({ ...row, quantity: row.quantity_fraction || row.quantity })),
});
const newBom = product => ({
  name: product ? `${product.name}BOM`.slice(0, 100) : '',
  product: product || null,
  product_id: product?.id || null,
  base_quantity: 1,
  base_unit: product?.unit || '',
  loss_method: 'internal',
  note: '',
  enabled: 1,
  items: [],
  scraps: [],
  post_processing_operations: [],
});

function BomList({
  q,
  setQ,
  status,
  setStatus,
  sort,
  setSort,
  offset,
  setOffset,
  filterProduct,
  setFilterProduct,
  list,
  sortable,
  message,
  action,
  moreBom,
  setMoreBom,
  onNew,
  open,
  setOverviewId,
  onCreateProduction,
  onToggleStatus,
  onDelete,
}) {
  useLocale();
  return <div className="bom-page">
    <PageHeading title="BOM" description={pt("production.maintainProductRecipesAndCalculateRequirementsAndShortages")}>
      <Button kind="primary" icon={Plus} disabled={action.busy} onClick={onNew}>{pt("production.newBom")}</Button>
    </PageHeading>
    {message && <p className="bom-success" role="status">{productionMessage(message)}</p>}
    {productionMessage(action.error) && <p className="form-error" role="alert">{productionMessage(action.error)}</p>}
    {filterProduct && <div className="bom-filter-product">
      <span>{pt("production.finishedProduct2")}{filterProduct.name} · {filterProduct.barcode}</span>
      <Button onClick={() => { setFilterProduct(null); setOffset(0); }}>{pt("production.showAllBoms")}</Button>
    </div>}
    <section className="panel bom-section">
      <div className="bom-list-filters">
        <AntInput
          type="search"
          aria-label={pt("production.searchBoms")}
          placeholder={pt("production.searchBomProductNameOrCode")}
          maxLength={100}
          value={q}
          onChange={e => { setQ(e.target.value); setOffset(0); }}
        />
        <div className="bom-filter-right">
          <Select aria-label={pt("production.bomStatus")} value={status} onChange={e => { setStatus(e); setOffset(0); }}>
            <option value="all">{pt("production.allStatuses")}</option>
            <option value="enabled">{pt("production.enabled")}</option>
            <option value="disabled">{pt("production.disabled2")}</option>
          </Select>
          <Select aria-label={pt('production.sortBy')} value={sort} onChange={e => { setSort(e); setOffset(0); }}>
            <option value="custom">{pt('production.sortCustom')}</option>
          <option value="updated_desc">{pt('production.sortUpdatedDesc')}</option>
            <option value="updated_asc">{pt('production.sortUpdatedAsc')}</option>
            <option value="created_desc">{pt('production.sortCreatedDesc')}</option>
            <option value="created_asc">{pt('production.sortCreatedAsc')}</option>
            <option value="name_asc">{pt('production.sortNameAsc')}</option>
            <option value="name_desc">{pt('production.sortNameDesc')}</option>
          </Select>
        </div>
      </div>
      <QueryStatus query={list} />
      {!!list.result?.boms.length && <p className="bom-hint sort-hint">{pt(sort === 'custom' ? 'production.dragSortHint' : 'production.dragSortDisabledHint')}</p>}
      <div className="bom-list">
        {sortable.ordered.map(bom => <article className="bom-list-item" key={bom.id} {...sortable.itemProps(bom.id)}>
          <div className="bom-list-info">
            <div className="bom-list-heading">
              {sort === 'custom' && <SortHandle sortable={sortable} id={bom.id} label={pt('production.dragToSort')} />}
              <strong>{bom.name}</strong>
            </div>
            <small>BOM #{bom.id} {pt("production.revision")} {bom.version}</small>
            <p>{bom.product_name} · {bom.barcode}</p>
            <small>{pt("production.baseOutput")} {count(bom.base_quantity)} {bom.base_unit} · {bom.item_count} {pt("production.materialsUpdatedBy")} {bom.updated_by_name}</small>
            <div>
              <Badge tone={bom.enabled ? 'green' : 'orange'}>{bom.enabled ? pt("production.enabled") : pt("production.disabled2")}</Badge>
              {!bom.product_active && <Badge tone="orange">{pt("production.productDisabled")}</Badge>}
            </div>
          </div>
          <div className="bom-actions">
            <Button icon={Calculator} disabled={action.busy || !bom.enabled} onClick={() => open(bom.id, 'calculate')}>{pt("production.planMaterials")}</Button>
            {onCreateProduction && <Button disabled={action.busy || !bom.enabled || !bom.product_active} onClick={() => onCreateProduction(bom)}>{pt("production.newProductionOrder")}</Button>}
            <Button disabled={action.busy} onClick={() => open(bom.id, 'edit')}>{pt("production.edit")}</Button>
            <Button disabled={action.busy} onClick={() => setMoreBom(bom)}>{pt('production.moreActions')}</Button>
          </div>
        </article>)}
      </div>
      {list.result && !list.result.boms.length && <p className="bom-empty">{pt("production.noMatchingBomsCreateAProductRecipeTo")}</p>}
      {list.result && (offset > 0 || list.result.has_more) && <div className="bom-actions bom-pagination">
        <Button disabled={!offset} onClick={() => setOffset(n => n - 30)}>{pt("production.previous")}</Button>
        <span>{pt("production.total")} {list.result.total} {pt("production.bomsCount")}</span>
        <Button disabled={!list.result.has_more} onClick={() => setOffset(n => n + 30)}>{pt("production.next")}</Button>
      </div>}
    </section>
    {moreBom && <Modal title={pt('production.moreActions')} subtitle={`${moreBom.name} #${moreBom.id}`} onClose={() => { if (!action.busy) setMoreBom(null); }}>
      <div className="form-body bom-more-actions">
        <Button icon={Network} disabled={action.busy} onClick={() => { const id = moreBom.id; setMoreBom(null); setOverviewId(id); }}>{pt('overview.bom')}</Button>
        <Button icon={Copy} disabled={action.busy} onClick={() => { const id = moreBom.id; setMoreBom(null); open(id, 'copy'); }}>{pt("production.copy2")}</Button>
        <Button icon={Power} disabled={action.busy} onClick={() => { const bom = moreBom; setMoreBom(null); onToggleStatus(bom); }}>
          {moreBom.enabled ? pt("production.disable") : pt("production.enable")}
        </Button>
        <Button icon={Trash2} kind="danger" disabled={action.busy} onClick={() => { const bom = moreBom; setMoreBom(null); onDelete(bom); }}>
          {pt("production.delete")}
        </Button>
      </div>
    </Modal>}
  </div>;
}

export function Bom({ data, initialProduct, onCreateProduction }) {
  useLocale();
  const [q, setQ] = useState(''), [status, setStatus] = useState('all'), [sort, setSort] = useState('custom'), [offset, setOffset] = useState(0);
  const [filterProduct, setFilterProduct] = useState(initialProduct || null), [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState(null), [baseline, setBaseline] = useState(''), [calculation, setCalculation] = useState(null);
  const [message, setMessage] = useState('');
  const [overviewId, setOverviewId] = useState(null), [moreBom, setMoreBom] = useState(null), [changingProduct, setChangingProduct] = useState(false);
  const action = useBusiness();
  const queryData = useMemo(() => ({ ...data, bomRevision: revision }), [data, revision]);
  const list = useQuery(queryPath('/boms', { q, status, sort, offset, product_id: filterProduct?.id }), queryData, 150);
  const dirty = !!editor && (JSON.stringify(editor) !== baseline || !editor.id && (!!editor.name.trim() || editor.items.length > 0));
  const sortable = useSortableList({
    items: list.result?.boms,
    enabled: sort === 'custom' && !action.busy,
    onReorder: async ids => {
      let saved = false;
      await action.run(async () => {
        await action.send('/boms/reorder', { ids }, { warehouseId: data.warehouse_id });
        saved = true;
      });
      return saved;
    },
  });
  const state = useRef({ dirty, busy: action.busy });
  state.current = { dirty, busy: action.busy };

  useEffect(() => {
    const before = event => {
      if (state.current.busy || state.current.dirty && !window.confirm(pt("production.thisBomHasUnsavedChangesLeave"))) event.preventDefault();
    };
    const unload = event => { if (state.current.dirty || state.current.busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('erp:before-navigate', before);
    window.addEventListener('beforeunload', unload);
    return () => {
      window.removeEventListener('erp:before-navigate', before);
      window.removeEventListener('beforeunload', unload);
    };
  }, []);

  const apply = bom => {
    setChangingProduct(false);
    const value = editable(bom);
    setEditor(value);
    setBaseline(JSON.stringify(value));
    setCalculation(null);
    action.setError('');
    setMessage('');
  };
  const back = () => {
    if (action.busy || dirty && !window.confirm(pt("production.thisBomHasUnsavedChangesLeave"))) return;
    setEditor(null);
    setCalculation(null);
    action.setError('');
  };
  const open = (id, kind) => action.run(async () => {
    const bom = await api(`/boms/${id}`, { warehouseId: data.warehouse_id });
    if (kind === 'calculate') {
      setCalculation(bom);
      action.setError('');
      setMessage('');
    } else if (kind === 'copy') {
      apply({
        ...newBom(bom.product),
        name: pt("production.copy", { v0: bom.name.slice(0, 98) }),
        base_quantity: bom.base_quantity,
        base_unit: bom.base_unit,
        loss_method: bom.loss_method,
        route_override_id: bom.route_override_id,
        route_price_table_id: bom.route_price_table_id,
        note: bom.note,
        items: editable(bom).items,
        scraps: editable(bom).scraps,
        post_processing_operations: editable(bom).post_processing_operations,
      });
    } else {
      apply(bom);
    }
  });
  const update = change => { setEditor(previous => ({ ...previous, ...change })); action.setError(''); };
  const save = () => action.run(async () => {
    const body = {
      name: editor.name,
      product_id: editor.product_id,
      base_quantity: parseQuantity(editor.base_quantity, true),
      route_override_id: editor.route_override_id ?? null,
      route_price_table_id: editor.route_price_table_id ?? null,
      base_unit: editor.product?.unit || '',
      loss_method: editor.loss_method,
      note: editor.note,
      enabled: editor.enabled,
      post_processing_operations: (editor.post_processing_operations || []).map(row => ({
        route_id: row.route_id, route_version: row.route_version, node_id: row.node_id, price_table_id: row.price_table_id ?? null,
        product_coefficient: 1, ...(row.usage_basis === 'material' ? { usage_basis: 'material', materials: row.materials.map(material => ({
          product_id: material.product_id, ...parseBomQuantity(material.quantity) })) } : { materials: postProcessingMaterialPayload(row.materials) }),
      })),
      items: editor.items.map(item => ({
        product_id: item.product_id,
        ...parseBomQuantity(item.quantity),
        loss_rate: parseLossRate(item.loss_rate),
        unit: item.product.unit,
        note: item.note,
        usage_mode: item.usage_mode ?? 'stock',
        child_bom_id: item.usage_mode === 'explode' ? item.child_bom_id : null,
      })),
      scraps: editor.scraps.map(row => ({
        product_id: row.product_id,
        method: row.method,
        source_product_id: row.source_product_id,
        ...parseBomQuantity(row.quantity),
        unit: row.product.unit,
        note: row.note,
      })),
      ...(editor.id ? { version: editor.version } : {}),
    };
    validateBom(body);
    validateScrapRules(body.scraps, body.product_id, body.items);
    await action.send(editor.id ? `/boms/${editor.id}` : '/boms', body, { warehouseId: data.warehouse_id });
    setEditor(null);
    setRevision(n => n + 1);
    setMessage(pt("production.bomSaved"));
  });

  if (overviewId) return <BomProcessOverview bomId={overviewId} data={queryData} onBack={() => setOverviewId(null)} />;
  if (calculation) return <div className="bom-page">
    <BomCalculation key={`${calculation.id}:${calculation.version}`} bom={calculation} data={data} onBack={back} onCreateProduction={onCreateProduction} />
  </div>;
  if (editor) return <BomEditor
    editor={editor}
    data={data}
    queryData={queryData}
    dirty={dirty}
    action={action}
    changingProduct={changingProduct}
    setChangingProduct={setChangingProduct}
    update={update}
    save={save}
    back={back}
    open={open}
    setOverviewId={setOverviewId}
  />;
  return <BomList
    q={q}
    setQ={setQ}
    status={status}
    setStatus={setStatus}
    sort={sort}
    setSort={setSort}
    offset={offset}
    setOffset={setOffset}
    filterProduct={filterProduct}
    setFilterProduct={setFilterProduct}
    list={list}
    sortable={sortable}
    message={message}
    action={action}
    moreBom={moreBom}
    setMoreBom={setMoreBom}
    onNew={() => apply(newBom(filterProduct))}
    open={open}
    setOverviewId={setOverviewId}
    onCreateProduction={onCreateProduction}
    onToggleStatus={bom => action.run(async () => {
      await action.send(`/boms/${bom.id}/status`, { version: bom.version, enabled: bom.enabled ? 0 : 1 }, { warehouseId: data.warehouse_id });
      setRevision(n => n + 1);
      setMessage(bom.enabled ? pt("production.bomDisabled") : pt("production.bomEnabled"));
    })}
    onDelete={bom => {
      if (!window.confirm(pt("production.deleteBomThisCannotBeUndoneRecipesReferenced", { v0: bom.name, v1: bom.id }))) return;
      action.run(async () => {
        setMessage('');
        await action.send(`/boms/${bom.id}/delete`, { version: bom.version }, { warehouseId: data.warehouse_id });
        if (list.result.boms.length === 1 && offset > 0) setOffset(n => Math.max(0, n - 30));
        setRevision(n => n + 1);
        setMessage(pt("production.bomDeleted"));
      });
    }}
  />;
}
