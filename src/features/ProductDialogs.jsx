import { localizeError } from '../i18n/errors.js';
import { describeStockExpression, inspectionCycleLabel, inspectionUnits } from '../warehouse-format.js';
import { t as translate, getFormatLocale, translateText } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { ConfigProvider as AntConfigProvider, Form as AntForm } from 'antd';
import { Button as AntButton, Input as AntInput, Checkbox as AntCheckbox } from '../ui/controls.jsx';

import { FormField } from './../ui/FormField.jsx';

import { useState, useRef, useEffect } from 'react';
import { downloadFile } from '../app/download.js';
import { Modal, ProductArt, Button } from '../components/common.jsx';
import { Barcode, ProductQualityCharts } from '../LazyComponents.jsx';
import { LoadingIndicator } from '../Loading.jsx';
import { Download, ScanLine, ImagePlus, Plus, Package, TriangleAlert, Check, Minus } from 'lucide-react';
import { usePermissions } from '../permissions.jsx';
import { api } from '../api.js';
import { evaluateStockExpression } from '../../shared/stock-compare.js';
import { price, count, stockStatus, currencySymbol } from '../app/format.js';
import { baseCurrency } from '../currency.js';
import { ProductHistory } from '../ProductHistory.jsx';
import { flattenCategories, readProductImage, categoryBranch } from '../catalog.js';
import { Select } from '../Dropdown.jsx';
import { ProductImage } from '../ProductImage.jsx';
import { ProductSync } from '../Warehouses.jsx';
import { ProductConflict } from '../ProductConflict.jsx';
import { useBusiness } from '../business-api.js';
import { parseQuantity, materialQuantity } from '../../shared/quantity.js';
import { mobileDevice } from '../device.js';

import { CustomerPartNumbersEditor, CustomerPartNumbersDetail } from '../CustomerPartNumbers.jsx';
import { productionTypes } from '../../shared/product-production-type.js';

function ProductFormSection({ title, children }) {
  useLocale();
  return mobileDevice ? <>{children}</> : <section className="drawer-form-section"><h3>{title}</h3>{children}</section>;
}

const productSnapshot = (form, targets) => JSON.stringify([
  ...['name', 'barcode', 'category', 'category_id', 'production_type', 'unit', 'cost', 'price', 'image', 'specification', 'note', 'threshold', 'is_fixed_asset', 'unit_round_up', 'inspection_date', 'inspection_interval', 'inspection_unit']
    .map(key => ['category_id', 'cost', 'price', 'threshold', 'inspection_interval'].includes(key) && form[key] !== '' && form[key] != null
      ? Number(form[key]) : ['is_fixed_asset', 'unit_round_up'].includes(key) ? (form[key] ? 1 : 0) : String(form[key] ?? '')),
  [...targets].sort((a, b) => a - b),
  (form.customer_part_numbers || []).map(row => [row.customer_id, row.part_number, !!row._editing]),
]);

function ProductCodeModal({ product, warehouseId, sourceId, onClose, notify, manageStockQr }) {
  useLocale();
  const [format, setFormat] = useState("barcode");
  const [qr, setQr] = useState(null);
  const codeRef = useRef(null);
  useEffect(() => {
    setQr(null);
    if (format !== "qr") return;
    let alive = true;
    import("../product-code.js").then(({ productQrPayload, qrSymbol }) => {
      if (alive) setQr(qrSymbol(productQrPayload(product, product.warehouse_id ?? warehouseId, sourceId)));
    }).catch(error => {
      if (alive) setQr({ error: error.message || translate("warehouse.qr.code.generation.failed.please.refresh.and.try.again") });
    });
    return () => { alive = false; };
  }, [format, product, warehouseId, sourceId]);
  const download = async () => {
    try {
      const svg = codeRef.current?.querySelector("svg");
      if (!svg) throw new Error(translate("warehouse.the.label.has.not.been.generated.yet.please.try.again"));
      await downloadFile(
        new XMLSerializer().serializeToString(svg),
        `${product.barcode}${format === "qr" ? "-qr" : ""}.svg`,
        "image/svg+xml",
      );
      notify(format === "qr" ? translate("warehouse.qr.code.label.has.been.downloaded") : translate("warehouse.barcode.label.downloaded"));
    } catch (error) { notify(localizeError(error.message)); }
  };
  return (
    <Modal title={translate("warehouse.material.barcode")} subtitle={translate("warehouse.print.or.download.material.labels")} onClose={onClose} className="product-code-modal" headerActions={
      <div className="code-format-switch" role="group" aria-label={translate("warehouse.tag.type")}>
        <AntButton type="text" htmlType="button" aria-pressed={format === "barcode"} onClick={() => setFormat("barcode")}>{translate("warehouse.barcode.2")}</AntButton>
        <AntButton type="text" htmlType="button" aria-pressed={format === "qr"} onClick={() => setFormat("qr")}>{translate("warehouse.qr.code")}</AntButton>
      </div>
    }>
      <div className="barcode-detail">
        <ProductArt product={product} size="large" />
        <h3>{product.name}</h3>
        <div ref={codeRef} className="product-code-symbol">
          {format === "barcode" ? <Barcode value={product.barcode} height={70} /> : !qr ? (
            <div className="product-qr-loading" role="status"><LoadingIndicator size={64} />{translate("warehouse.generating.qr.code")}</div>
          ) : qr.error ? (
            <div className="form-error" role="alert">{qr.error}</div>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="product-qr" width="256" height="256" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={translate("warehouse.qr.code.2", { v0: product.barcode })} shapeRendering="crispEdges">
              <title>{product.name} · {product.barcode}</title>
              <rect width={qr.size} height={qr.size} fill="#fff" />
              <path d={qr.path} fill="#000" />
            </svg>
          )}
        </div>
        {format === "qr" && <p className="product-code-number">{product.barcode}</p>}
        <p>{format === "qr" ? translate("warehouse.contains.material.code.name.unit.and.warehouse.information") : `CODE 128 · ${product.category}`}</p>
      </div>
      <div className="modal-footer">
        {manageStockQr && <Button onClick={manageStockQr}>{translate("warehouse.inbound.and.outbound.qr.code")}</Button>}
        <Button onClick={onClose}>{translate("warehouse.close")}</Button>
        <Button kind="primary" icon={Download} disabled={format === "qr" && (!qr || !!qr.error)} onClick={download}>{translate("warehouse.download.tags")}</Button>
      </div>
    </Modal>
  );
}

function ProductDetail({ product, data, warehouseName, onViewOrder, onClose, onViewBom }) {
  useLocale();
  const { costs, can } = usePermissions();
  const [tab,setTab]=useState('details');
  const showQuality=!mobileDevice&&can('quality');
  const [others, setOthers] = useState(null);
  const [otherError, setOtherError] = useState("");
  useEffect(() => {
    let active = true;
    setOthers(null); setOtherError("");
    api(`/products/${product.id}/other-warehouses`)
      .then((result) => { if (active) setOthers(result.warehouses || []); })
      .catch((e) => { if (active) setOtherError(e.message); });
    return () => { active = false; };
  }, [product.id]);
  const expression = data?.settings?.stock_expression || null;
  const nameById = Object.fromEntries((data?.warehouses || []).map((w) => [w.id, w.name]));
  const stockByWarehouse = { ...(data?.warehouse_id != null ? { [data.warehouse_id]: Number(product.stock) || 0 } : {}) };
  for (const row of others ?? []) stockByWarehouse[row.warehouse_id] = Number(row.stock) || 0;
  const expressionValue = expression && others !== null ? evaluateStockExpression(expression, stockByWarehouse) : null;
  const expressionText = expression ? describeStockExpression(expression, nameById) : "";
  const fields = [
    [translate("warehouse.material.barcode"), product.barcode],
    [translate("warehouse.material.categories"), product.category],
    [translate("warehouse.unit.of.measurement"), product.unit],
    [translate("warehouse.belonging.warehouse"), warehouseName],
    [translate("warehouse.reference.sales.price"), `${currencySymbol()} ${price(product.price)}`],
    ...(costs ? [[translate("warehouse.reference.purchase.price"), `${currencySymbol()} ${price(product.cost)}`]] : []),
    [translate("warehouse.current.inventory"), `${count(product.stock)} ${product.unit}`],
    [translate("warehouse.safety.stock"), `${count(product.threshold)} ${product.unit}`],
    [translate("warehouse.stock.status"), stockStatus(product)],
    [translate("warehouse.use.status"), product.active === 0 ? translate("warehouse.deactivated") : translate("warehouse.enabled")],
    [translate("warehouse.round.quantities.to.whole.units"), product.unit_round_up ? translate("warehouse.yes") : translate("warehouse.no")],
    [translate("warehouse.fixed.asset"), product.is_fixed_asset ? translate("warehouse.yes") : translate("warehouse.no")],
    [translate("warehouse.production.type"), translateText(product.production_type) || translate("warehouse.not.set")],
    [translate("warehouse.next.verification.date"), product.inspection_date || translate("warehouse.not.configured")],
    [translate("warehouse.inspection.cycle"), inspectionCycleLabel(product)],
    [translate("warehouse.last.check"), product.last_inspected_on || translate("warehouse.no.records")],
  ];
  return <Modal title={translate("warehouse.material.details.2")} subtitle={translate("warehouse.view.material.files.and.current.inventory")} onClose={onClose} presentation="drawer">
    <div className="form-body product-detail">
      <div className="product-detail-heading">
        <ProductArt product={product} size="large" />
        <h3>{product.name}</h3>
      </div>
      {showQuality&&<div className="product-quality-tabs" role="tablist" aria-label={translate("warehouse.material.details.view")}>{[['details',translate("warehouse.material.information")],['quality',translate("warehouse.quality.chart")]].map(([id,label])=><AntButton type="text" key={id} htmlType="button" role="tab" id={`product-tab-${id}`} aria-controls={`product-panel-${id}`} aria-selected={tab===id} onClick={()=>setTab(id)}>{label}</AntButton>)}</div>}
      {showQuality&&tab==='quality'?<div id="product-panel-quality" role="tabpanel" aria-labelledby="product-tab-quality"><ProductQualityCharts key={product.id} product={product} data={data}/></div>:<div id="product-panel-details" role={showQuality?'tabpanel':undefined} aria-labelledby={showQuality?'product-tab-details':undefined}>
      <dl className="product-detail-fields">
        {fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}
        <div className="product-detail-full"><dt>{translate("warehouse.specifications.and.models")}</dt><dd>{product.specification || "—"}</dd></div>
        <div className="product-detail-full"><dt>{translate("warehouse.remarks")}</dt><dd>{product.note || "—"}</dd></div>
      </dl>
      <CustomerPartNumbersDetail value={product.customer_part_numbers} />
      <ProductHistory key={product.id} product={product} onViewOrder={onViewOrder} />
      <section className="product-other-stock">
        <h4>{translate("warehouse.other.warehouse.inventory")}</h4>
        {otherError ? <p className="form-error" role="alert">{otherError}</p>
          : others === null ? <p className="product-other-empty"><LoadingIndicator size={20} />{" "}{translate("warehouse.reading")}</p>
          : others.length === 0 ? <p className="product-other-empty">{translate("warehouse.the.same.material.is.not.currently.available.in.other.warehouses")}</p>
          : <ul className="product-other-list">
            {others.map((row) => <li key={row.warehouse_id}>
              <span>{row.warehouse_name}</span>
              <strong>{count(row.stock)} {row.unit || product.unit}</strong>
            </li>)}
          </ul>}
        {expressionValue !== null && (
          <div className="product-stock-total">
            <div className={`product-stock-total-sum stock-diff-${expressionValue > 0 ? "positive" : expressionValue < 0 ? "negative" : "zero"}`}>
              <span title={expressionText}>{expressionText}</span>
              <strong>{`${expressionValue > 0 ? "+" : ""}${count(expressionValue)}`} {product.unit}</strong>
            </div>
          </div>
        )}
      </section>
      </div>}
    </div>
    <div className="modal-footer">{can('bom') && onViewBom && <Button onClick={onViewBom}>{translate("warehouse.view.bom")}</Button>}<Button onClick={onClose}>{translate("warehouse.close")}</Button></div>
  </Modal>;
}

function ProductForm({ product, categories, units = ["个"], warehouses, warehouseId, onClose, onSaved }) {
  useLocale();
  const [syncTargets, setSyncTargets] = useState([]);
  const [currentCategories, setCurrentCategories] = useState(categories);
  const options = flattenCategories(currentCategories);
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState(null);
  const [form, setForm] = useState(
    product || {
      name: "",
      barcode: "",
      category: options[0]?.path || "",
      category_id: options[0]?.id || "",
      image: "",
      specification: "",
      note: "",
      unit: units[0],
      cost: "",
      price: "",
      threshold: 20,
      is_fixed_asset: 0,
      unit_round_up: 0,
      production_type: '',
      inspection_date: '', inspection_interval: 0, inspection_unit: 'month',
    },
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const [readingImage, setReadingImage] = useState(false);
  const imageInputRef = useRef(null);
  const errorRef = useRef(null);
  const baseline = useRef(productSnapshot(form, []));
  const close = () => {
    if (busy || readingImage) return;
    if (!mobileDevice && productSnapshot(form, syncTargets) !== baseline.current &&
      !window.confirm(translate("warehouse.the.material.information.has.not.been.saved.are.you.sure.you"))) return;
    onClose();
  };
  useEffect(() => {
    if (!mobileDevice && error) errorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error, conflict]);
  const submit = async () => {

    if (busy || readingImage || conflict) return;
    setBusy(true);
    setError("");
    try {
      if (form.customer_part_numbers?.some(row => row._editing)) throw new Error(translate("warehouse.please.click.to.confirm.the.customer.material.number.first.or.remove"));
      const result = await api(
        product ? `/products/${product.id}` : "/products",
        {
          method: product ? "PUT" : "POST",
          body: {
            ...form,
            customer_part_numbers: (form.customer_part_numbers || []).map(({ customer_id, part_number }) => ({ customer_id, part_number })),
            cost: Number(form.cost),
            price: Number(form.price),
            threshold: Number(form.threshold),
            is_fixed_asset: form.is_fixed_asset ? 1 : 0,
            unit_round_up: form.unit_round_up ? 1 : 0,
            inspection_interval: Number(form.inspection_interval || 0),
            sync_warehouse_ids: syncTargets,
          },
        },
      );
      baseline.current = productSnapshot(form, syncTargets);
      await onSaved(
        product ? translate("warehouse.material.information.has.been.updated") : translate("warehouse.material.has.been.created.barcode", { v0: result.barcode }),
      );
    } catch (e) {
      setError(localizeError(e.message));
      if (e.status === 409 && e.code === 'PRODUCT_VERSION_CONFLICT') {
        setConflict(true);
        setLatest(null);
      }
    } finally {
      setBusy(false);
    }
  };
  const priceFields = (
    <>
      <label>{translate("warehouse.reference.purchase.price.2")}{baseCurrency()}） <span>*</span>
        <FormField value={form.cost} required type="number" min="0" max="99999999" label={translate("warehouse.reference.purchase.price.3")}><AntInput
          type="number"
          min="0"
          max="99999999"
          step="0.0001"
          placeholder="0.0000"
          value={form.cost}
          onChange={(e) => change("cost", e.target.value)}
        /></FormField>
      </label>
      <label>{translate("warehouse.reference.sales.price.2")}{baseCurrency()}） <span>*</span>
        <FormField value={form.price} required type="number" min="0" max="99999999" label={translate("warehouse.reference.sales.price.3")}><AntInput
          type="number"
          min="0"
          max="99999999"
          step="0.0001"
          placeholder="0.0000"
          value={form.price}
          onChange={(e) => change("price", e.target.value)}
        /></FormField>
      </label>
    </>
  );
  const specificationField = (
    <label>{translate("warehouse.specifications.and.models")}<AntInput maxLength={500} placeholder={translate("warehouse.for.example.3.cores.1.5.mm.rated.voltage.300.500v")} value={form.specification || ''} onChange={e => change('specification', e.target.value)} />
    </label>
  );
  return (
    <Modal
      title={product ? translate("warehouse.edit.material") : translate("warehouse.add.new.material")}
      subtitle={translate("warehouse.fill.in.the.material.information.the.barcode.is.optional.leave.it")}
      onClose={close}
      presentation="drawer"
    >
      <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }} onFinish={submit}>
        <div className="form-body">
          <ProductFormSection title={translate("warehouse.basic.information")}>
            <label>{translate("warehouse.material.name")}<span>*</span>
              <FormField label={translate("warehouse.material.name")} value={form.name} required maxLength={100}><AntInput

                data-autofocus
                maxLength={100}
                placeholder={translate("warehouse.for.example.rvv.sheathed.wire")}
                value={form.name}
                onChange={(e) => change("name", e.target.value)}
              /></FormField>
            </label>
            <label>{translate("warehouse.material.barcode.optional")}<div className="input-with-icon">

                <FormField value={form.barcode} maxLength={64} pattern="[A-Za-z0-9_.\-]{3,64}" label={translate("warehouse.material.barcode.optional")}><AntInput prefix={<ScanLine size={17} />}
                  pattern="[A-Za-z0-9_.\-]{3,64}"
                  maxLength={64}
                  title={translate("warehouse.3.64.characters.numbers.or")}
                  placeholder={translate("warehouse.scan.or.enter.the.barcode.you.can.leave.it.blank")}
                  value={form.barcode}
                  onChange={(e) => change("barcode", e.target.value)}
                /></FormField>
              </div>
              <small>
                {product
                  ? translate("warehouse.barcodes.can.be.scanned.or.entered.manually.leaving.blank.to.save")
                  : translate("warehouse.the.barcode.can.be.scanned.or.entered.manually.a.unique.barcode")}
              </small>
            </label>
            <div className="form-grid">
              <label>{translate("warehouse.material.categories")}<span>*</span>
                <Select aria-label={translate("warehouse.material.categories")}
                  required
                  value={form.category_id || ''}
                  onChange={(e) => {
                    const c = options.find(c => c.id === Number(e));
                    setForm(current => ({ ...current, category_id: c?.id || '', category: c?.path || '' }));
                  }}
                >
                  <option value="" disabled>{translate("warehouse.please.select.a.category")}</option>
                  {options.map(c => <option key={c.id} value={c.id}>{'　'.repeat(c.depth)}{c.path}</option>)}
                </Select>
                {!options.length && <small>{translate("warehouse.please.add.a.category.in.the.management.category.of.material.management")}</small>}
              </label>
              <label>{translate("warehouse.unit.of.measurement")}<span>*</span>
                <Select aria-label={translate("warehouse.unit.of.measurement")}
                  required
                  value={form.unit}
                  onChange={(e) => change("unit", e)}
                >
                  {[...new Set([...units, form.unit])].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
                <small>{translate("warehouse.it.can.be.configured.in.settings.basic.settings.unit.of.measurement")}</small>
              </label>
              {mobileDevice && priceFields}
            </div>
            <label>{translate("warehouse.production.type")}<Select aria-label={translate("warehouse.production.type")} value={form.production_type || ''} onChange={value => change('production_type', value)}>
                <option value="">{translate("warehouse.not.set")}</option>
                {productionTypes.map(type => <option key={type} value={type}>{translateText(type)}</option>)}
              </Select>
            </label>
            <AntCheckbox className="product-fixed-asset" checked={!!form.unit_round_up} onChange={e => change('unit_round_up', e.target.checked ? 1 : 0)}>{translate("warehouse.round.quantities.to.whole.units")}<small>{translate("warehouse.after.checking.the.quantity.is.rounded.up.for.example.4.1")}</small>
            </AntCheckbox>
            <AntCheckbox className="product-fixed-asset" checked={!!form.is_fixed_asset} onChange={(e) => change("is_fixed_asset", e.target.checked ? 1 : 0)}>{translate("warehouse.fixed.asset")}<small>{translate("warehouse.after.checking.the.material.is.marked.as.a.fixed.asset.when")}</small>
            </AntCheckbox>
            {!mobileDevice && specificationField}
          </ProductFormSection>
          <div className="drawer-form-section">
            <CustomerPartNumbersEditor value={form.customer_part_numbers} onChange={value => change('customer_part_numbers', value)} disabled={busy || conflict} />
          </div>
          <ProductFormSection title={translate("warehouse.pictures.and.description")}>
            <div className="product-image-editor" role="group" aria-label={translate("warehouse.material.pictures")}>
              <div className="product-image-label">{translate("warehouse.material.pictures")}</div>
              <input ref={imageInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || readingImage} aria-label={translate("warehouse.upload.material.pictures")}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    setReadingImage(true); setError('');
                    try { change('image', await readProductImage(file)); }
                    catch (e) { setError(localizeError(e.message)); }
                    finally { setReadingImage(false); }
                  }} />
              <AntButton type="text" htmlType="button" className="product-image-upload" disabled={busy || readingImage} aria-busy={readingImage} onClick={() => imageInputRef.current?.click()}>
                <span className="product-image-upload-icon" aria-hidden="true">{readingImage ? <LoadingIndicator size={22} /> : <ImagePlus size={22} />}</span>
                <span className="product-image-upload-copy">
                  <strong>{readingImage ? translate("warehouse.uploading.pictures") : form.image ? translate("warehouse.replacement.material.pictures") : translate("warehouse.upload.material.pictures")}</strong>
                  <span>{readingImage ? translate("warehouse.compressing.and.uploading.please.wait") : translate("warehouse.click.to.select.an.image.support.jpeg.png.webp")}</span>
                </span>
                {!readingImage && <Plus size={18} aria-hidden="true" />}
              </AntButton>
              <small className="product-image-hint">{translate("warehouse.a.single.image.should.not.exceed.10.mb.and.will.be")}</small>
              {form.image && <div className="product-image-preview"><ProductImage src={form.image} alt={translate("warehouse.material.picture.preview")} className="product-image-thumbnail" /><Button type="button" disabled={busy || readingImage} onClick={() => change('image', '')}>{translate("warehouse.remove.image")}</Button></div>}
            </div>
            {mobileDevice && specificationField}
            <label>{translate("warehouse.material.remarks")}<AntInput.TextArea maxLength={2000} rows={3} placeholder={translate("warehouse.fill.in.the.material.supplementary.instructions")} value={form.note || ''} onChange={e => change('note', e.target.value)} />
            </label>
          </ProductFormSection>
          <ProductFormSection title={translate("warehouse.price.and.inventory.settings")}>
            {!mobileDevice && <div className="form-grid">{priceFields}</div>}
            <label>{translate("warehouse.safety.stock")}<span>*</span>
              <FormField label={translate("warehouse.safety.stock")} value={form.threshold} required type="number" min="0" max="99999999"><AntInput
                type="number"
                min="0"
                max="99999999"
                step="0.0001"
                value={form.threshold}
                onChange={(e) => change("threshold", e.target.value)}
              /></FormField>
              <small>{translate("warehouse.set.to.0.to.disable.out.of.stock.and.low.stock")}</small>
            </label>
          </ProductFormSection>
          <ProductFormSection title={translate("warehouse.verification.reminder.optional")}>
            <label>{translate("warehouse.next.verification.date")}<AntInput type="date" aria-label={translate("warehouse.next.verification.date")} value={form.inspection_date || ''} onChange={e => {
                change('inspection_date', e.target.value);
                if (!e.target.value) change('inspection_interval', 0);
              }} />
              <small>{translate("warehouse.materials.to.be.verified.will.be.displayed.on.the.home.page")}</small>
            </label>
            <div className="form-grid">
              <label>{translate("warehouse.inspection.cycle")}<FormField value={form.inspection_interval || ''} type="number" min="1" max="999" label={translate("warehouse.inspection.cycle")}><AntInput type="number" aria-label={translate("warehouse.inspection.cycle")} min="1" max="999" step="1" disabled={!form.inspection_date} placeholder={translate("warehouse.leave.blank.to.set.date.manually")} value={form.inspection_interval || ''} onChange={e => change('inspection_interval', e.target.value)} /></FormField>
              </label>
              <label>{translate("warehouse.period.unit")}<Select className="inspection-unit-select" aria-label={translate("warehouse.period.unit")} disabled={!form.inspection_date} value={form.inspection_unit || 'month'} onChange={e => change('inspection_unit', e)}>
                  {Object.entries(inspectionUnits).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </Select>
              </label>
            </div>
            <small>{translate("warehouse.after.clicking.verified.you.can.select.the.actual.verification.date.default")}</small>
          </ProductFormSection>
          <ProductFormSection title={translate("warehouse.sync.to.other.warehouses")}>
            <ProductSync warehouses={warehouses} warehouseId={warehouseId} targets={syncTargets} setTargets={setSyncTargets} disabled={busy || readingImage} />
          </ProductFormSection>
          {!product && (
            <div className="info-box">
              <Package size={17} />
              <p>{translate("warehouse.the.initial.inventory.of.a.new.material.is.0.after.creation")}</p>
            </div>
          )}
          {error && (
            <div ref={errorRef} className="form-error" role="alert">
              <TriangleAlert size={16} />
              {error}
            </div>
          )}
          {conflict && <>
            <ProductConflict form={form} latest={latest?.product} />
            <Button type="button" disabled={busy || readingImage} onClick={async () => {
              setBusy(true);
              setLatest(null);
              try {
                const [data, detail] = await Promise.all([api('/workspace', { warehouseId }), api(`/products/${product.id}`, { warehouseId })]);
                const current = detail.product;
                if (!current) throw new Error(translate("warehouse.the.material.has.been.deleted.and.the.current.filled.content.has"));
                setLatest({ product: current, categories: data.categories });
              } catch (e) { setError(localizeError(e.message)); }
              finally { setBusy(false); }
            }} busy={busy}>{busy ? translate("warehouse.reading.2") : translate("warehouse.view.the.latest.information")}</Button>
            {latest && <Button type="button" disabled={busy || readingImage} onClick={() => {
              if (!window.confirm(translate("warehouse.replace.the.current.filled.content.with.the.latest.information.and.clear"))) return;
              setForm(latest.product);
              baseline.current = productSnapshot(latest.product, []);
              setCurrentCategories(latest.categories);
              setSyncTargets([]);
              setConflict(false);
              setLatest(null);
              setError('');
            }}>{translate("warehouse.re.edit.with.latest.information")}</Button>}
          </>}
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={close} disabled={busy || readingImage}>{translate("warehouse.cancel")}</Button>
          <Button
            type="submit"
            kind="primary"
            icon={Check} busy={busy}
            disabled={busy || readingImage || conflict}
          >
            {busy ? translate("warehouse.saving") : translate("warehouse.save.material")}
          </Button>
        </div>
      </AntForm>
    </Modal>
  );
}

function CategoryManager({ categories, onClose, onChanged }) {
  useLocale();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const options = flattenCategories(categories);
  const excluded = categoryBranch(categories, Number(id));
  const choose = value => {
    const c = categories.find(c => c.id === Number(value));
    setId(value); setName(c?.name || ''); setParent(c?.parent_id || ''); setError('');
  };
  const run = async action => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); await onChanged(); choose(''); }
    catch (e) { setError(localizeError(e.message)); }
    finally { setBusy(false); }
  };
  return <Modal title={translate("warehouse.manage.material.classification")} subtitle={translate("warehouse.create.multi.level.classifications.select.the.upper.level.classification.to.add")} onClose={busy ? () => {} : onClose}>
    <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }} onFinish={() => {  void run(() => api(id ? `/categories/${id}` : '/categories', { method: id ? 'PUT' : 'POST', body: { name, parent_id: parent ? Number(parent) : null } })); }}>
      <AntConfigProvider componentDisabled={busy}><fieldset className="form-body category-form" disabled={busy}>
        <label>{translate("warehouse.edit.category")}<Select aria-label={translate("warehouse.edit.category")} value={id} onChange={e => choose(e)}><option value="">{translate("warehouse.add.new.category")}</option>{options.map(c => <option key={c.id} value={c.id}>{c.path}</option>)}</Select></label>
        <label>{translate("warehouse.category.name")}{" "}<span>*</span><FormField label={translate("warehouse.category.name")} value={name} required maxLength={100}><AntInput  maxLength={100} value={name} placeholder={translate("warehouse.for.example.wire")} onChange={e => setName(e.target.value)} /></FormField></label>
        <label>{translate("warehouse.superior.classification")}<Select aria-label={translate("warehouse.superior.classification")} value={parent} onChange={e => setParent(e)}><option value="">{translate("warehouse.none.first.level.classification")}</option>{options.filter(c => !excluded.has(c.id)).map(c => <option key={c.id} value={c.id}>{c.path}</option>)}</Select></label>
        <small className="muted">{translate("warehouse.selecting.the.parent.category.will.include.subordinate.materials.the.lower.level")}</small>
        {error && <div className="form-error" role="alert">{error}</div>}
      </fieldset></AntConfigProvider>
      <div className="modal-footer">
        {id && <Button type="button" disabled={busy} onClick={() => { if (window.confirm(translate("warehouse.are.you.sure.you.want.to.delete.category", { v0: name }))) void run(() => api(`/categories/${id}/delete`, { method: 'POST', body: {} })); }}>{translate("warehouse.delete.category")}</Button>}
        <Button type="button" disabled={busy} onClick={onClose}>{translate("warehouse.complete")}</Button>
        <Button type="submit" kind="primary" busy={busy}>{busy ? translate("warehouse.saving") : translate("warehouse.save.category")}</Button>
      </div>
    </AntForm>
  </Modal>;
}

function ReduceStockModal({ product, increase = false, onClose, onSaved }) {
  useLocale();
  const action = increase ? translate("warehouse.increase") : translate("warehouse.reduce");
  const { busy, error, run, send } = useBusiness();
  const [quantity, setQuantity] = useState(""),
    [reason, setReason] = useState("");
  const submit = () => {

    run(async () => {
      const amount = materialQuantity(parseQuantity(quantity, true), product);
      if (!reason.trim()) throw new Error(translate("warehouse.please.fill.in.the.reason", { v0: action }));
      if (!increase && amount > product.stock)
        throw new Error(translate("warehouse.quantity.reduction.cannot.exceed.existing.inventory", { v0: product.stock, v1: product.unit }));
      if (
        !window.confirm(
          translate("warehouse.confirm.to.move.inventory.from", { v0: product.name, v1: product.stock, v2: action, v3: amount, v4: product.unit }),
        )
      )
        return;
      await send(increase ? "/stock/increase" : "/stock/reduce", {
        product_id: product.id,
        quantity: amount,
        expected_stock: product.stock,
        reason,
      });
      await onSaved(translate("warehouse.in.stock", { v0: action, v1: product.name }));
    });
  };
  return (
    <Modal
      title={increase ? translate("warehouse.increase.stock.return") : translate("warehouse.reduce.inventory")}
      subtitle={increase ? translate("warehouse.used.to.return.production.surplus.materials.directly.increase.inventory.and.record") : translate("warehouse.used.to.report.losses.losses.or.inventory.losses.directly.adjust.existing")}
      onClose={busy ? () => {} : onClose}
    >
      <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }} onFinish={submit}>
        <div className="form-body">
          <div className="reduce-stock-product">
            <strong>{product.name}</strong>
            <small>
              {product.barcode}{" "}{translate("warehouse.on.hand.inventory.2")}{" "}{product.stock} {product.unit}
            </small>
          </div>
          <label>
            {action}{translate("warehouse.quantity.3")}{product.unit}） <span>*</span>
            <FormField label={translate("warehouse.quantity.4")} value={quantity} required type="number" min="0.0001"><AntInput

              data-autofocus
              type="number"
              min="0.0001"
              step="0.0001"
              placeholder="0"
              value={quantity}
              disabled={busy}
              onChange={(e) => setQuantity(e.target.value)}
            /></FormField>
          </label>
          <label>
            {action}{translate("warehouse.reason")}{" "}<span>*</span>
            <FormField label={translate("warehouse.reason")} value={reason} required maxLength={500}><AntInput

              maxLength={500}
              placeholder={increase ? translate("warehouse.for.example.return.of.production.surplus.materials") : translate("warehouse.for.example.damaged.and.scrapped.inventory.loss")}
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            /></FormField>
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose} disabled={busy}>{translate("warehouse.cancel")}</Button>
          <Button type="submit" kind="primary" icon={increase ? Plus : Minus} busy={busy}>
            {busy ? translate("warehouse.processing") : translate("warehouse.confirm.2", { v0: action })}
          </Button>
        </div>
      </AntForm>
    </Modal>
  );
}

export { ProductCodeModal, ProductDetail, ProductForm, CategoryManager, ReduceStockModal };
