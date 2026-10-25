import { productionMessage } from '../i18n/production-errors.js';
import { bomLossMethodLabels, bomLossMethodFormulas } from '../i18n/production-display.js';
import { t as pt, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Form as AntForm } from 'antd';
import { Input as AntInput, Checkbox as AntCheckbox } from '../ui/controls.jsx';
import { FormField } from './../ui/FormField.jsx';

import { BomResultViews } from '../features/BomResultViews.jsx';
import { ChildBomPicker } from '../features/ChildBomPicker.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Calculator, Camera, Copy, Download, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useBusiness } from '../business-api.js';
import { useQuery, queryPath } from '../queries.js';
import { lookupProductCode } from '../product-query.js';
import { CameraScanner } from '../LazyComponents.jsx';
import { PageHeading, Button, Badge, QueryStatus } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { downloadFile } from '../app/download.js';
import { bomStructureCSV, bomCSV } from '../bom-csv.js';
import { addQuantity, parseQuantity } from '../../shared/quantity.js';
import { BOM_MAX_ITEMS, parseBomQuantity, validateBom, bomRequiredQuantity, validateBomLossRate } from '../../shared/bom.js';
import { validateScrapRules } from '../../shared/scrap.js';
import { ScrapOutputs } from '../features/ScrapOutputs.jsx';
import './bom.css';

const parseLossRate = value => {
  const rate = Number(value);
  if (!/^\d+(\.\d{1,6})?$/.test(String(value).trim())) throw new Error(pt("production.standardLossRateSupportsAtMost6Decimal"));
  validateBomLossRate(rate);
  return rate;
};
const count = value => Number(value).toLocaleString(getFormatLocale(), { maximumFractionDigits: 4 });
const editable = bom => ({ ...bom, items: bom.items.map(item => ({ ...item, quantity: item.quantity_fraction || item.quantity })),
  scraps: (bom.scraps || []).map(row => ({ ...row, quantity: row.quantity_fraction || row.quantity })) });
const newBom = product => ({ name: product ? `${product.name}BOM`.slice(0, 100) : '', product: product || null,
  product_id: product?.id || null, base_quantity: 1, base_unit: product?.unit || '', loss_method: 'internal', note: '', enabled: 1, items: [], scraps: [] });

function incrementUsage(value) {
  const parsed = parseBomQuantity(value);
  if (!parsed.quantity_fraction) return parseQuantity(addQuantity(parsed.quantity, 1), true);
  const [numerator, denominator] = parsed.quantity_fraction.split('/').map(Number);
  const next = `${numerator + denominator}/${denominator}`;
  parseBomQuantity(next);
  return next;
}

function UsagePreview({ value, unit, lossRate, lossMethod }) {
  useLocale();
  try {
    const parsed = parseBomQuantity(value);
    const rate = parseLossRate(lossRate), gross = bomRequiredQuantity(parsed.quantity, 1, 1, parsed.quantity_fraction, rate, lossMethod);
    return <small className="bom-hint bom-usage-preview">{parsed.quantity_fraction && <>{pt("production.approximately")} {count(parsed.quantity)} {unit}{pt("production.calculatedUsingTheOriginalFraction")} </>}{pt("production.standardInputIncludingLoss")} {count(gross)} {unit}{pt("production.forTheBaseOutput")}</small>;
  } catch { return null; }
}

function ProductPicker({ data, material = false, scrap = false, onSelect, disabled }) {
  useLocale();
  const [q, setQ] = useState(''), [offset, setOffset] = useState(0), [camera, setCamera] = useState(false);
  const action = useBusiness();
  const query = useQuery(q.trim() ? queryPath('/products', { q: q.trim(), status: 'active', limit: 20, offset }) : null, data, 200);
  const label = scrap ? pt("production.scrap") : material ? pt("production.material") : pt("production.finishedProduct");
  const selectLabel = scrap ? pt("production.addScrap") : material ? pt("production.addMaterial") : pt("production.selectFinishedProduct");
  const choose = product => { onSelect(product); setQ(''); setOffset(0); };
  const scan = raw => {
    setCamera(false);
    action.run(async () => {
      const product = await lookupProductCode(raw, data);
      if (!product) throw new Error(pt("production.noMaterialFoundForThisCodeCreateIts"));
      if (!product.active) throw new Error(pt("production.thisMaterialIsDisabledSelectAnActiveMaterial"));
      choose(product);
    });
  };
  return <div className="bom-picker">
    <div className="bom-search-row">
      <AntInput type="search" aria-label={pt("production.search", { v0: label })} placeholder={pt("production.searchByNameCodeOrSpecification", { v0: label })} maxLength={100} value={q}
        disabled={disabled || action.busy} onChange={e => { setQ(e.target.value); setOffset(0); action.setError(''); }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (q.trim()) scan(q.trim()); } }} />
      <Button type="button" disabled={disabled || action.busy || !q.trim()} onClick={() => scan(q.trim())}>{pt("production.byBarcode")}{scrap ? pt("production.addScrap") : material ? pt("production.add") : pt("production.select")}</Button>
      <Button type="button" icon={Camera} disabled={disabled || action.busy} onClick={() => setCamera(true)} aria-label={pt("production.scan", { v0: selectLabel })}>{pt("production.scan2")}</Button>
    </div>
    {productionMessage(action.error) && <p className="form-error" role="alert">{productionMessage(action.error)}</p>}
    {q.trim() && <div className="bom-search-results">
      <QueryStatus query={query} />
      {query.result?.products.map(product => <div className="bom-search-product" key={product.id}>
        <div><strong>{product.name}</strong><small>{product.barcode} · {product.specification || pt("production.noSpecification")} · {product.unit}</small></div>
        <Button type="button" disabled={disabled} onClick={() => choose(product)} aria-label={`${selectLabel} ${product.name}`}>{material || scrap ? pt("production.add") : pt("production.select")}</Button>
      </div>)}
      {query.result && !query.result.products.length && <p className="bom-empty">{pt("production.noMatchingActiveMaterials")}</p>}
      {(offset > 0 || query.result?.has_more) && <div className="bom-actions">
        <Button type="button" disabled={!offset || query.loading} onClick={() => setOffset(n => n - 20)}>{pt("production.previousMaterials")}</Button>
        <Button type="button" disabled={!query.result?.has_more || query.loading} onClick={() => setOffset(n => n + 20)}>{pt("production.nextMaterials")}</Button>
      </div>}
    </div>}
    {camera && <CameraScanner title={pt("production.scan", { v0: selectLabel })} onResult={scan} onClose={() => setCamera(false)} onManual={() => setCamera(false)} />}
  </div>;
}

function BomCalculation({ bom, data, onBack, onCreateProduction }) {
  const { locale } = useLocale();
  const [outputLanguage, setOutputLanguage] = useState(null);
  const [quantity, setQuantity] = useState(String(bom.base_quantity)), [snapshot, setSnapshot] = useState(null), [stale, setStale] = useState(false);
  const snapshotData = useRef(data);
  useEffect(() => {
    if (!snapshot || snapshotData.current === data) return;
    const controller = new AbortController();
    api(`/boms/${bom.id}/calculate`, { method: 'POST', warehouseId: data.warehouse_id, signal: controller.signal,
      body: { production_quantity: snapshot.production_quantity, version: snapshot.version, schema_version: 2 } })
      .then(result => { if (!controller.signal.aborted) { setStale(result.structure_token !== snapshot.structure_token); snapshotData.current = data; } })
      .catch(() => { if (!controller.signal.aborted) setStale(true); });
    return () => controller.abort();
  }, [data, snapshot, bom.id]);
  const action = useBusiness();
  return <>
    <PageHeading title={pt("production.materialPlanning")} description={`${bom.name} #${bom.id} · ${bom.product.name} · ${bom.product.barcode}`}>
      <Button icon={ArrowLeft} disabled={action.busy} onClick={onBack}>{pt("production.backToBom")}</Button>
    </PageHeading>
    <section className="panel bom-section">
      <div className="bom-calculate-form"><label>{pt("production.productionQuantity")}{bom.product.unit}）<AntInput aria-label={pt("production.productionQuantity2")} inputMode="decimal" value={quantity} disabled={action.busy}
        onChange={e => { setQuantity(e.target.value); setSnapshot(null); action.setError(''); }} /></label>
        <Button kind="primary" icon={Calculator} busy={action.busy} onClick={() => action.run(async () => {
          const production_quantity = parseQuantity(quantity, true);
          const result = await api(`/boms/${bom.id}/calculate`, { method: 'POST', warehouseId: data.warehouse_id,
            body: { production_quantity, version: bom.version, schema_version: 2 } });
          snapshotData.current = data; setStale(false); setSnapshot(result);
        })}>{snapshot ? pt("production.recalculate") : pt("production.calculate")}</Button>
      </div>
      <p className="bom-hint">{pt("production.baseOutput")} {count(bom.base_quantity)} {bom.base_unit}{pt("production.standardLossUses")}{bomLossMethodLabels[bom.loss_method]}：{bomLossMethodFormulas[bom.loss_method]}{pt("production.thenScalesByProductionQuantityBaseOutputRounded")}</p>
      {productionMessage(action.error) && <p className="form-error" role="alert">{productionMessage(action.error)}</p>}
    </section>
    {snapshot && <section className="panel bom-section bom-calculation-result">
      <div className="bom-section-heading"><div><h2>{pt("production.materialRequirements")}</h2><p className="bom-hint">{snapshot.warehouse.name} {pt("production.stockReadAt")} {new Date(snapshot.captured_at).toLocaleString(getFormatLocale(), { hour12: false })}</p></div>
        <div className="bom-actions">
          <Select aria-label={pt("production.outputLanguage")} value={outputLanguage || locale} onChange={setOutputLanguage}><option value="zh-CN">简体中文</option><option value="en">English</option><option value="vi">Tiếng Việt</option></Select>
          <Button icon={Download} onClick={() => downloadFile(bomCSV(snapshot, outputLanguage || locale), pt("production.materialPlanCsv", { v0: snapshot.product.barcode, v1: snapshot.captured_at.slice(0, 10) }), 'text/csv;charset=utf-8')}>{pt("production.exportMaterialPlan")}</Button>
          <Button icon={Download} onClick={() => downloadFile(bomStructureCSV(snapshot, outputLanguage || locale), pt("production.bomStructureCsv", { v0: snapshot.bom_id }), 'text/csv;charset=utf-8')}>{pt("production.exportStructureDetails")}</Button>
        </div>
      </div>
      {snapshot.multi_level && <p className="bom-warning">{pt("production.expandedByGrossRequirementsIntermediateStockIsNot")}</p>}
      {stale && <p className="bom-warning">{pt("production.recipeOrMaterialInformationChangedRecalculateBeforeCreating")}</p>}
      {onCreateProduction && <Button disabled={stale} onClick={() => onCreateProduction({ ...bom, planned_quantity: snapshot.production_quantity })}>{pt("production.createProductionOrderForThisQuantity")}</Button>}
      <BomResultViews nodes={snapshot.nodes} quantity={snapshot.production_quantity}>{showSources => <>
      <p className="bom-result-summary" role="status">{pt("production.total")} {snapshot.rows.length} {pt("production.materials")}{snapshot.rows.filter(row => row.shortage > 0).length} {pt("production.shortages")}</p>
      <div className="bom-result-table"><table><thead><tr><th>{pt("production.material")}</th><th>{pt("production.baseNetUsage")}</th><th>{pt("production.requiredQuantityIncludingLoss")}</th><th>{pt("production.bookStock")}</th><th>{pt("production.shortageQuantity")}</th><th>{pt("production.note")}</th></tr></thead>
        <tbody>{snapshot.rows.map(row => <tr key={row.product_id}>
          <td><strong>{row.name}</strong><small>{row.barcode}{row.specification && ` · ${row.specification}`}</small></td>
          <td data-label={pt("production.baseNetUsage")}>{row.quantity === null ? <button type="button" className="bom-tree-action" onClick={() => showSources(row)}>{pt("production.view")} {row.sources.length} {pt("production.sources")}</button> : <>{row.quantity_fraction || count(row.quantity)} {row.unit}<small>{pt("production.standardLossRate")} {count(row.loss_rate)}%</small></>}</td><td data-label={pt("production.requiredQuantityIncludingLoss")}>{count(row.required)} {row.unit}</td><td data-label={pt("production.bookStock")}>{count(row.stock)} {row.unit}</td>
          <td data-label={pt("production.shortageQuantity")} className={row.shortage > 0 ? 'bom-shortage' : ''}>{count(row.shortage)} {row.unit}</td><td data-label={pt("production.note")}>{row.note || '—'}</td>
        </tr>)}</tbody></table></div>
      <ScrapOutputs rows={snapshot.scraps || []} materials={snapshot.rows} />
      <p className="bom-hint">{pt("production.resultsAndExportsRetainTheStockReadFor")}</p>
      </>}</BomResultViews>
    </section>}
  </>;
}

export function Bom({ data, initialProduct, onCreateProduction }) {
  useLocale();
  const [q, setQ] = useState(''), [status, setStatus] = useState('all'), [offset, setOffset] = useState(0);
  const [filterProduct, setFilterProduct] = useState(initialProduct || null), [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState(null), [baseline, setBaseline] = useState(''), [calculation, setCalculation] = useState(null);
  const [message, setMessage] = useState('');
  const action = useBusiness();
  const queryData = useMemo(() => ({ ...data, bomRevision: revision }), [data, revision]);
  const list = useQuery(queryPath('/boms', { q, status, offset, product_id: filterProduct?.id }), queryData, 150);
  const dirty = !!editor && (JSON.stringify(editor) !== baseline || !editor.id && (!!editor.name.trim() || editor.items.length > 0));
  const state = useRef({ dirty, busy: action.busy }); state.current = { dirty, busy: action.busy };
  useEffect(() => {
    const before = event => {
      if (state.current.busy || state.current.dirty && !window.confirm(pt("production.thisBomHasUnsavedChangesLeave"))) event.preventDefault();
    };
    const unload = event => { if (state.current.dirty || state.current.busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('erp:before-navigate', before); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('erp:before-navigate', before); window.removeEventListener('beforeunload', unload); };
  }, []);
  const apply = bom => { const value = editable(bom); setEditor(value); setBaseline(JSON.stringify(value)); setCalculation(null); action.setError(''); setMessage(''); };
  const back = () => { if (action.busy || dirty && !window.confirm(pt("production.thisBomHasUnsavedChangesLeave"))) return; setEditor(null); setCalculation(null); action.setError(''); };
  const open = (id, kind) => action.run(async () => {
    const bom = await api(`/boms/${id}`, { warehouseId: data.warehouse_id });
    if (kind === 'calculate') { setCalculation(bom); action.setError(''); setMessage(''); }
    else if (kind === 'copy') apply({ ...newBom(bom.product), name: pt("production.copy", { v0: bom.name.slice(0, 98) }), base_quantity: bom.base_quantity, base_unit: bom.base_unit, loss_method: bom.loss_method, note: bom.note, items: editable(bom).items, scraps: editable(bom).scraps });
    else apply(bom);
  });
  const update = change => { setEditor(previous => ({ ...previous, ...change })); action.setError(''); };
  const save = () => {

    action.run(async () => {
      const body = { name: editor.name, product_id: editor.product_id, base_quantity: parseQuantity(editor.base_quantity, true),
        base_unit: editor.product?.unit || '', loss_method: editor.loss_method, note: editor.note, enabled: editor.enabled,
        items: editor.items.map(item => ({ product_id: item.product_id, ...parseBomQuantity(item.quantity), loss_rate: parseLossRate(item.loss_rate), unit: item.product.unit, note: item.note, usage_mode: item.usage_mode ?? 'stock', child_bom_id: item.usage_mode === 'explode' ? item.child_bom_id : null })),
        scraps: editor.scraps.map(row => ({ product_id: row.product_id, method: row.method, source_product_id: row.source_product_id,
          ...parseBomQuantity(row.quantity), unit: row.product.unit, note: row.note })),
        ...(editor.id ? { version: editor.version } : {}) };
      validateBom(body);
      validateScrapRules(body.scraps, body.product_id, body.items);
      await action.send(editor.id ? `/boms/${editor.id}` : '/boms', body, { warehouseId: data.warehouse_id });
      setEditor(null); setRevision(n => n + 1); setMessage(pt("production.bomSaved"));
    });
  };
  if (calculation) return <div className="bom-page"><BomCalculation key={`${calculation.id}:${calculation.version}`} bom={calculation} data={data} onBack={back} onCreateProduction={onCreateProduction} /></div>;
  if (editor) return <div className="bom-page">
    <PageHeading title={editor.id ? pt("production.editBom") : pt("production.newBom")} description={pt("production.setBaseOutputAndMaterialUsageThenSave")}>
      <Button icon={ArrowLeft} disabled={action.busy} onClick={back}>{pt("production.backToBom")}</Button>
    </PageHeading>
    <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }} onFinish={save}>
      <section className="panel bom-section"><h2>{pt("production.finishedProductAndRecipe")}</h2>
        <div className="bom-form-grid"><label>{pt("production.bomName")}<FormField label={pt("production.bomName")} value={editor.name} required maxLength={100}><AntInput maxLength={100}  value={editor.name} disabled={action.busy} onChange={e => update({ name: e.target.value })} /></FormField></label>
          <label>{pt("production.baseOutput")}{editor.product && `（${editor.product.unit}）`}<FormField value={editor.base_quantity} required label={pt("production.baseOutput")}><AntInput aria-label={pt("production.baseOutput")} inputMode="decimal"  value={editor.base_quantity} disabled={action.busy} onChange={e => update({ base_quantity: e.target.value })} /></FormField></label></div>
        {editor.product && <div className="bom-selected-product"><div><strong>{pt("production.finishedProduct2")}{editor.product.name}</strong><small>{editor.product.barcode} · {editor.product.unit}</small></div></div>}
        {editor.product && editor.base_unit !== editor.product.unit && <p className="bom-warning">{pt("production.productUnitChangedFrom")} {editor.base_unit} {pt("production.to")} {editor.product.unit}{pt("production.verifyBaseOutputBeforeSaving")}</p>}
        {!editor.product && <p className="bom-hint">{pt("production.selectAFinishedOrSemiFinishedProductOne")}</p>}
        <ProductPicker data={data} disabled={action.busy} onSelect={product => {
          if ([...editor.items, ...editor.scraps].some(item => item.product_id === product.id)) { action.setError(pt("production.theFinishedProductCannotAlsoBeAnInput")); return; }
          update({ product, product_id: product.id, base_unit: product.unit, name: editor.name || `${product.name}BOM`.slice(0, 100) });
        }} />
        <label className="bom-note">{pt("production.note")}<AntInput.TextArea rows={2} maxLength={500} value={editor.note} disabled={action.busy} onChange={e => update({ note: e.target.value })} /></label>
        <AntCheckbox className="bom-checkbox" checked={!!editor.enabled} disabled={action.busy} onChange={e => update({ enabled: e.target.checked ? 1 : 0 })}>{pt("production.enableThisBom")}</AntCheckbox>
      </section>
      <section className="panel bom-section"><div className="bom-section-heading"><h2>{pt("production.materialUsage")}</h2><span className="bom-hint">{pt("production.added")} {editor.items.length} / {BOM_MAX_ITEMS} {pt("production.types")}</span></div>
        <p className="bom-hint">{pt("production.enterTheNetMaterialsNeededToProduce")} {editor.base_quantity || '…'} {editor.product?.unit || pt("production.unitsOfFinishedProduct")} {pt("production.materialsMayBeIssuedDirectlyOrExpandedUsing")}</p>
        <label className="bom-loss-method">{pt("production.standardLossCalculation")}<Select aria-label={pt("production.standardLossCalculation")} aria-describedby="bom-loss-help" value={editor.loss_method} disabled={action.busy}
          onChange={e => update({ loss_method: e })}>{Object.entries(bomLossMethodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
        <p className="bom-hint" id="bom-loss-help">{pt("production.allMaterialsInThisBomUse")}{bomLossMethodLabels[editor.loss_method]}{pt("production.standardInput")}{bomLossMethodFormulas[editor.loss_method]}。{editor.loss_method === 'external' ? pt("production.lossIsBasedOnNetUsageNetUsage") : pt("production.lossIsBasedOnInputNetUsage90")}{pt("production.standardLossMustBeAtLeast0And")}</p>
        <p className="bom-hint" id="bom-usage-help">{pt("production.usageSupportsDecimalsOrFractionsEG1")}</p>
        <ProductPicker data={data} material disabled={action.busy} onSelect={product => {
          if (product.id === editor.product_id) { action.setError(pt("production.aProductCannotBeItsOwnMaterial")); return; }
          if (editor.scraps.some(row => row.product_id === product.id)) { action.setError(pt("production.inputMaterialCannotAlsoBeScrap")); return; }
          const found = editor.items.find(item => item.product_id === product.id);
          if (!found && editor.items.length >= BOM_MAX_ITEMS) { action.setError(pt("production.youCanAddAtMostMaterials", { v0: BOM_MAX_ITEMS })); return; }
          try { update({ items: found ? editor.items.map(item => item.product_id === product.id ? { ...item, product, quantity: incrementUsage(item.quantity) } : item)
            : [...editor.items, { product_id: product.id, product, quantity: 1, loss_rate: 0, usage_mode: 'stock', child_bom_id: null, unit: product.unit, note: '' }] }); }
          catch (error) { action.setError(error.message); }
        }} />
        {!editor.items.length && <p className="bom-empty">{pt("production.searchOrScanToAddMaterials")}</p>}
        <div className="bom-materials">{editor.items.map(item => <div className="bom-material" key={item.product_id}>
          <div className="bom-material-name"><strong>{item.product.name}</strong><small>{item.product.barcode} · {item.product.specification || pt("production.noSpecification")}{!item.product.active && pt("production.disabled")}</small>
            {item.unit !== item.product.unit && <span className="bom-warning">{pt("production.unitChangedFrom")} {item.unit} {pt("production.to")} {item.product.unit}{pt("production.verifyUsage")}</span>}</div>
          <label>{pt("production.netUsage")}{item.product.unit}）<FormField value={item.quantity} required maxLength={60} label={pt("production.usage", { v0: item.product.name })}><AntInput aria-label={pt("production.usage", { v0: item.product.name })} aria-describedby="bom-usage-help bom-loss-help" inputMode="text" placeholder={pt("production.eG0025Or140")} maxLength={60} spellCheck={false}  value={item.quantity} disabled={action.busy}
            onChange={e => update({ items: editor.items.map(row => row.product_id === item.product_id ? { ...row, quantity: e.target.value } : row) })} /></FormField></label>
          <label>{pt("production.standardLossRate2")}<FormField value={item.loss_rate} required maxLength={20} label={pt("production.standardLossRate3", { v0: item.product.name })}><AntInput aria-label={pt("production.standardLossRate3", { v0: item.product.name })} aria-describedby="bom-loss-help" inputMode="decimal" maxLength={20}  value={item.loss_rate} disabled={action.busy}
            onChange={e => update({ items: editor.items.map(row => row.product_id === item.product_id ? { ...row, loss_rate: e.target.value } : row) })} /></FormField></label>
          <label className="bom-material-usage">{pt("production.materialSupplyMethod")}<Select aria-label={pt("production.supplyMethod", { v0: item.product.name })} value={item.usage_mode ?? 'stock'} disabled={action.busy}
            onChange={e => update({ items: editor.items.map(row => row.product_id === item.product_id ? { ...row, usage_mode: e, child_bom_id: null, child_bom: null } : row) })}>
            <option value="stock">{pt("production.issueThisMaterial")}</option><option value="explode">{pt("production.expandChildBom")}</option>
          </Select></label>
          <label className="bom-material-note">{pt("production.materialNote")}<AntInput aria-label={pt("production.note2", { v0: item.product.name })} maxLength={200} value={item.note} disabled={action.busy}
            onChange={e => update({ items: editor.items.map(row => row.product_id === item.product_id ? { ...row, note: e.target.value } : row) })} /></label>
          <Button type="button" icon={Trash2} disabled={action.busy} aria-label={pt("production.removeMaterial", { v0: item.product.name })} onClick={() => update({ items: editor.items.filter(row => row.product_id !== item.product_id) })}>{pt("production.remove")}</Button>
          <UsagePreview value={item.quantity} unit={item.product.unit} lossRate={item.loss_rate} lossMethod={editor.loss_method} />
          {item.usage_mode === 'explode' && <ChildBomPicker item={item} data={queryData} disabled={action.busy}
            onChange={patch => update({ items: editor.items.map(row => row.product_id === item.product_id ? { ...row, ...patch } : row) })} />}
        </div>)}</div>
      </section>
      <section className="panel bom-section"><div className="bom-section-heading"><h2>{pt("production.scrapOutput")}</h2><span className="bom-hint">{pt("production.optional")} {editor.scraps.length} {pt("production.label100Types")}</span></div>
        <p className="bom-hint">{pt("production.selectExistingMaterialsAndConfigureRulesForEach")}</p>
        <ProductPicker data={data} scrap disabled={action.busy} onSelect={product => {
          if (product.id === editor.product_id || editor.items.some(row => row.product_id === product.id)) { action.setError(pt("production.scrapCannotBeTheFinishedProductOrAn")); return; }
          if (editor.scraps.some(row => row.product_id === product.id)) { action.setError(pt("production.thisScrapIsAlreadyAddedEditItsExisting")); return; }
          if (editor.scraps.length >= 100) { action.setError(pt("production.atMost100ScrapTypesAreAllowed")); return; }
          update({ scraps: [...editor.scraps, { product_id: product.id, product, unit: product.unit, method: 'output', source_product_id: null, quantity: 1, note: '' }] });
        }} />
        {!editor.scraps.length && <p className="bom-empty">{pt("production.leaveEmptyIfThereIsNoScrap")}</p>}
        {editor.scraps.map(row => {
          const change = patch => update({ scraps: editor.scraps.map(item => item.product_id === row.product_id ? { ...item, ...patch } : item) });
          return <article className="bom-scrap-rule" key={row.product_id}>
            <div><strong>{row.product.name}</strong><small>{row.product.barcode} · {row.product.unit}{!row.product.active && pt("production.disabled")}</small>
              {row.unit !== row.product.unit && <p className="bom-warning">{pt("production.unitChangedVerifyTheRuleBeforeSaving")}</p>}</div>
            <div className="bom-scrap-fields">
              <label>{pt("production.calculationMethod")}<Select aria-label={pt("production.calculationMethod2", { v0: row.product.name })} value={row.method} disabled={action.busy}
                onChange={e => {
                  const sources = editor.items.filter(item => item.product.unit === row.product.unit);
                  change({ method: e, source_product_id: e === 'input_ratio' && sources.length === 1 ? sources[0].product_id : null, quantity: '' });
                }}>
                <option value="output">{pt("production.byOutput")}</option><option value="input_ratio">{pt("production.byMaterialInputRatio")}</option>
              </Select></label>
              {row.method === 'input_ratio' && <label>{pt("production.sourceMaterial")}<Select aria-label={pt("production.sourceMaterial2", { v0: row.product.name })} value={row.source_product_id ?? ''} required disabled={action.busy}
                onChange={e => change({ source_product_id: Number(e) })}>
                <option value="">{pt("production.selectMaterialWithTheSameUnit")}</option>{editor.items.filter(item => item.product.unit === row.product.unit).map(item => <option value={item.product_id} key={item.product_id}>{item.product.name}</option>)}
              </Select></label>}
              <label>{row.method === 'output' ? pt("production.baseScrapQuantity", { v0: row.product.unit }) : pt("production.scrapRatio")}<FormField value={row.quantity} required maxLength={60} label={`${row.product.name}${row.method === 'output' ? pt("production.baseScrapQuantity2") : pt("production.scrapRatio2")}`}><AntInput aria-label={`${row.product.name}${row.method === 'output' ? pt("production.baseScrapQuantity2") : pt("production.scrapRatio2")}`}
                inputMode={row.method === 'output' ? 'text' : 'decimal'} maxLength={60} value={row.quantity} disabled={action.busy} onChange={e => change({ quantity: e.target.value })} /></FormField></label>
              <label>{pt("production.scrapNote")}<AntInput aria-label={pt("production.scrapNote2", { v0: row.product.name })} maxLength={200} value={row.note} disabled={action.busy} onChange={e => change({ note: e.target.value })} /></label>
            </div>
            <Button type="button" icon={Trash2} disabled={action.busy} aria-label={pt("production.removeScrap", { v0: row.product.name })} onClick={() => update({ scraps: editor.scraps.filter(item => item.product_id !== row.product_id) })}>{pt("production.remove")}</Button>
          </article>;
        })}
      </section>
      {productionMessage(action.error) && <p className="form-error bom-error" role="alert">{productionMessage(action.error)}</p>}
      <div className="bom-editor-actions"><Button type="button" disabled={action.busy} onClick={back}>{pt("production.cancel")}</Button>
        {editor.id && <Button type="button" disabled={action.busy} onClick={() => { if (!dirty || window.confirm(pt("production.reloadingWillDiscardUnsavedChangesContinue"))) open(editor.id, 'edit'); }}>{pt("production.reloadSavedBom")}</Button>}
        <Button type="submit" icon={Save} kind="primary" busy={action.busy} disabled={!editor.product || !editor.items.length}>{pt("production.saveBom")}</Button></div>
    </AntForm>
  </div>;
  return <div className="bom-page">
    <PageHeading title="BOM" description={pt("production.maintainProductRecipesAndCalculateRequirementsAndShortages")}>
      <Button kind="primary" icon={Plus} disabled={action.busy} onClick={() => apply(newBom(filterProduct))}>{pt("production.newBom")}</Button>
    </PageHeading>
    {message && <p className="bom-success" role="status">{productionMessage(message)}</p>}{productionMessage(action.error) && <p className="form-error" role="alert">{productionMessage(action.error)}</p>}
    {filterProduct && <div className="bom-filter-product"><span>{pt("production.finishedProduct2")}{filterProduct.name} · {filterProduct.barcode}</span><Button onClick={() => { setFilterProduct(null); setOffset(0); }}>{pt("production.showAllBoms")}</Button></div>}
    <section className="panel bom-section">
      <div className="bom-list-filters"><AntInput type="search" aria-label={pt("production.searchBoms")} placeholder={pt("production.searchBomProductNameOrCode")} maxLength={100} value={q} onChange={e => { setQ(e.target.value); setOffset(0); }} />
        <Select aria-label={pt("production.bomStatus")} value={status} onChange={e => { setStatus(e); setOffset(0); }}>
          <option value="all">{pt("production.allStatuses")}</option><option value="enabled">{pt("production.enabled")}</option><option value="disabled">{pt("production.disabled2")}</option>
        </Select></div>
      <QueryStatus query={list} />
      <div className="bom-list">{list.result?.boms.map(bom => <article className="bom-list-item" key={bom.id}>
        <div className="bom-list-info"><strong>{bom.name}</strong><small>BOM #{bom.id} {pt("production.revision")} {bom.version}</small><p>{bom.product_name} · {bom.barcode}</p>
          <small>{pt("production.baseOutput")} {count(bom.base_quantity)} {bom.base_unit} · {bom.item_count} {pt("production.materialsUpdatedBy")} {bom.updated_by_name}</small>
          <div><Badge tone={bom.enabled ? 'green' : 'orange'}>{bom.enabled ? pt("production.enabled") : pt("production.disabled2")}</Badge>{!bom.product_active && <Badge tone="orange">{pt("production.productDisabled")}</Badge>}</div></div>
        <div className="bom-actions"><Button icon={Calculator} disabled={action.busy || !bom.enabled} onClick={() => open(bom.id, 'calculate')}>{pt("production.planMaterials")}</Button>
          {onCreateProduction && <Button disabled={action.busy || !bom.enabled || !bom.product_active} onClick={() => onCreateProduction(bom)}>{pt("production.newProductionOrder")}</Button>}
          <Button disabled={action.busy} onClick={() => open(bom.id, 'edit')}>{pt("production.edit")}</Button>
          <Button icon={Copy} disabled={action.busy} onClick={() => open(bom.id, 'copy')}>{pt("production.copy2")}</Button>
          <Button disabled={action.busy} onClick={() => action.run(async () => {
            await action.send(`/boms/${bom.id}/status`, { version: bom.version, enabled: bom.enabled ? 0 : 1 }, { warehouseId: data.warehouse_id });
            setRevision(n => n + 1); setMessage(bom.enabled ? pt("production.bomDisabled") : pt("production.bomEnabled"));
          })}>{bom.enabled ? pt("production.disable") : pt("production.enable")}</Button>
          <Button icon={Trash2} kind="danger" disabled={action.busy} onClick={() => {
            if (!window.confirm(pt("production.deleteBomThisCannotBeUndoneRecipesReferenced", { v0: bom.name, v1: bom.id }))) return;
            action.run(async () => {
              setMessage('');
              await action.send(`/boms/${bom.id}/delete`, { version: bom.version }, { warehouseId: data.warehouse_id });
              if (list.result.boms.length === 1 && offset > 0) setOffset(n => Math.max(0, n - 30));
              setRevision(n => n + 1); setMessage(pt("production.bomDeleted"));
            });
          }}>{pt("production.delete")}</Button></div>
      </article>)}</div>
      {list.result && !list.result.boms.length && <p className="bom-empty">{pt("production.noMatchingBomsCreateAProductRecipeTo")}</p>}
      {list.result && (offset > 0 || list.result.has_more) && <div className="bom-actions bom-pagination"><Button disabled={!offset} onClick={() => setOffset(n => n - 30)}>{pt("production.previous")}</Button>
        <span>{pt("production.total")} {list.result.total} {pt("production.orders")}</span><Button disabled={!list.result.has_more} onClick={() => setOffset(n => n + 30)}>{pt("production.next")}</Button></div>}
    </section>
  </div>;
}
