import { ArrowLeft, ChevronDown, Save } from 'lucide-react';
import { Form as AntForm } from 'antd';
import { PageHeading, Button } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { Input as AntInput, Checkbox as AntCheckbox } from '../ui/controls.jsx';
import { FormField } from '../ui/FormField.jsx';
import { ProductPicker } from './ProductPicker.jsx';
import { RoutePicker } from './RoutePicker.jsx';
import { BomMaterialTable, BomScrapTable } from './BomEditorTables.jsx';
import { addQuantity, parseQuantity } from '../../shared/quantity.js';
import { BOM_MAX_ITEMS, parseBomQuantity, validateBomLossRate } from '../../shared/bom.js';
import { productionMessage } from '../i18n/production-errors.js';
import { bomLossMethodLabels, bomLossMethodFormulas } from '../i18n/production-display.js';
import { t as pt } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';

export const parseLossRate = value => {
  const rate = Number(value);
  if (!/^\d+(\.\d{1,6})?$/.test(String(value).trim())) throw new Error(pt("production.standardLossRateSupportsAtMost6Decimal"));
  validateBomLossRate(rate);
  return rate;
};

function incrementUsage(value) {
  const parsed = parseBomQuantity(value);
  if (!parsed.quantity_fraction) return parseQuantity(addQuantity(parsed.quantity, 1), true);
  const [numerator, denominator] = parsed.quantity_fraction.split('/').map(Number);
  const next = `${addQuantity(numerator, denominator)}/${denominator}`;
  parseBomQuantity(next);
  return next;
}

export function BomEditor({
  editor,
  data,
  queryData,
  dirty,
  action,
  changingProduct,
  setChangingProduct,
  update,
  save,
  back,
  open,
  setOverviewId,
}) {
  useLocale();
  const patchItem = (productId, patch) => update({
    items: editor.items.map(row => row.product_id === productId ? { ...row, ...patch } : row),
  });
  const patchScrap = (productId, patch) => update({
    scraps: editor.scraps.map(row => row.product_id === productId ? { ...row, ...patch } : row),
  });

  return <div className="bom-page">
    <PageHeading title={editor.id ? pt("production.editBom") : pt("production.newBom")}>
      <Button icon={ArrowLeft} disabled={action.busy} onClick={back}>{pt("production.backToBom")}</Button>
    </PageHeading>
    <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }} onFinish={save}>
      <section className="panel bom-section">
        <h2>{pt("production.finishedProductAndRecipe")}</h2>
        <div className="bom-form-grid">
          <label>
            {pt("production.bomName")}
            <FormField label={pt("production.bomName")} value={editor.name} required maxLength={100}>
              <AntInput maxLength={100} value={editor.name} disabled={action.busy} onChange={e => update({ name: e.target.value })} />
            </FormField>
          </label>
          <label>
            {pt("production.baseOutput")}{editor.product && `（${editor.product.unit}）`}
            <FormField value={editor.base_quantity} required label={pt("production.baseOutput")}>
              <AntInput aria-label={pt("production.baseOutput")} inputMode="decimal" value={editor.base_quantity} disabled={action.busy} onChange={e => update({ base_quantity: e.target.value })} />
            </FormField>
          </label>
        </div>
        {editor.product && <div className="bom-selected-product">
          <div>
            <strong>{pt("production.finishedProduct2")}{editor.product.name}</strong>
            <small>{editor.product.barcode} · {editor.product.unit}</small>
          </div>
          <Button type="button" disabled={action.busy} aria-expanded={changingProduct} onClick={() => setChangingProduct(value => !value)}>
            {changingProduct ? pt('production.cancel') : pt('production.changeFinishedProduct')}
          </Button>
        </div>}
        {editor.product && editor.base_unit !== editor.product.unit && <p className="bom-warning">
          {pt("production.productUnitChangedFrom")} {editor.base_unit} {pt("production.to")} {editor.product.unit}{pt("production.verifyBaseOutputBeforeSaving")}
        </p>}
        {!editor.product && <p className="bom-hint">{pt("production.selectAFinishedOrSemiFinishedProductOne")}</p>}
        {(!editor.product || changingProduct) && <ProductPicker data={data} disabled={action.busy} onSelect={product => {
          if ([...editor.items, ...editor.scraps].some(item => item.product_id === product.id)) {
            action.setError(pt("production.theFinishedProductCannotAlsoBeAnInput"));
            return;
          }
          setChangingProduct(false);
          update({ product, product_id: product.id, base_unit: product.unit, ...(!editor.route_override_id ? { route_price_table_id: null } : {}), name: editor.name || `${product.name}BOM`.slice(0, 100) });
        }} />}
        <label className="bom-note">
          {pt("production.note")}
          <AntInput.TextArea rows={2} maxLength={500} value={editor.note} disabled={action.busy} onChange={e => update({ note: e.target.value })} />
        </label>
        <AntCheckbox className="bom-checkbox" checked={!!editor.enabled} disabled={action.busy} onChange={e => update({ enabled: e.target.checked ? 1 : 0 })}>
          {pt("production.enableThisBom")}
        </AntCheckbox>
      </section>

      <section className="panel bom-section">
        <div className="bom-section-heading">
          <h2>{pt('route.override')}</h2>
          <Button disabled={action.busy || dirty || !editor.id} onClick={() => setOverviewId(editor.id)}>{pt('overview.bom')}</Button>
        </div>
        <RoutePicker
          warehouseId={data.warehouse_id}
          inherit
          inheritedValue={editor.product?.default_route_id}
          value={editor.route_override_id}
          onChange={value => update({ route_override_id: value, route_price_table_id: null })}
          priceTableId={editor.route_price_table_id}
          onPriceTableChange={value => update({ route_price_table_id: value })}
          disabled={action.busy}
        />
        {(dirty || !editor.id) && <p className="bom-hint">{pt('overview.saveFirst')}</p>}
      </section>

      <section className="panel bom-section">
        <div className="bom-section-heading">
          <h2>{pt("production.materialUsage")}</h2>
          <span className="bom-hint">{pt("production.added")} {editor.items.length} / {BOM_MAX_ITEMS} {pt("production.types")}</span>
        </div>
        <p className="bom-hint">
          {pt("production.enterTheNetMaterialsNeededToProduce")} {editor.base_quantity || '…'} {editor.product?.unit || pt("production.unitsOfFinishedProduct")} {pt("production.materialsMayBeIssuedDirectlyOrExpandedUsing")}
        </p>
        <label className="bom-loss-method">
          {pt("production.standardLossCalculation")}
          <Select
            aria-label={pt("production.standardLossCalculation")}
            aria-describedby="bom-loss-help"
            value={editor.loss_method}
            disabled={action.busy}
            onChange={e => update({ loss_method: e })}
          >
            {Object.entries(bomLossMethodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </label>
        <details className="bom-disclosure bom-help-disclosure">
          <summary>
            <span>{pt("production.calculationAndUsageHelp")}</span>
            <ChevronDown className="bom-disclosure-chevron" size={16} aria-hidden="true" />
          </summary>
          <p className="bom-hint" id="bom-loss-help">
            {pt("production.allMaterialsInThisBomUse")}{bomLossMethodLabels[editor.loss_method]}{pt("production.standardInput")}{bomLossMethodFormulas[editor.loss_method]}。
            {editor.loss_method === 'external' ? pt("production.lossIsBasedOnNetUsageNetUsage") : pt("production.lossIsBasedOnInputNetUsage90")}
            {pt("production.standardLossMustBeAtLeast0And")}
          </p>
          <p className="bom-hint" id="bom-usage-help">{pt("production.usageSupportsDecimalsOrFractionsEG1")}</p>
        </details>
        <ProductPicker data={data} material disabled={action.busy} onSelect={product => {
          if (product.id === editor.product_id) { action.setError(pt("production.aProductCannotBeItsOwnMaterial")); return; }
          if (editor.scraps.some(row => row.product_id === product.id)) { action.setError(pt("production.inputMaterialCannotAlsoBeScrap")); return; }
          const found = editor.items.find(item => item.product_id === product.id);
          if (!found && editor.items.length >= BOM_MAX_ITEMS) { action.setError(pt("production.youCanAddAtMostMaterials", { v0: BOM_MAX_ITEMS })); return; }
          try {
            update({
              items: found
                ? editor.items.map(item => item.product_id === product.id ? { ...item, product, quantity: incrementUsage(item.quantity) } : item)
                : [...editor.items, { product_id: product.id, product, quantity: 1, loss_rate: 0, usage_mode: 'stock', child_bom_id: null, unit: product.unit, note: '' }],
            });
          } catch (error) { action.setError(error.message); }
        }} />
        {!editor.items.length && <p className="bom-empty">{pt("production.searchOrScanToAddMaterials")}</p>}
        {editor.items.length > 0 && <BomMaterialTable
          items={editor.items}
          lossMethod={editor.loss_method}
          queryData={queryData}
          busy={action.busy}
          onPatchItem={patchItem}
          onRemoveItem={productId => update({ items: editor.items.filter(row => row.product_id !== productId) })}
        />}
      </section>

      <section className="panel bom-section">
        <div className="bom-section-heading">
          <h2>{pt("production.scrapOutput")}</h2>
          <span className="bom-hint">{pt("production.optional")} {editor.scraps.length} {pt("production.label100Types")}</span>
        </div>
        <p className="bom-hint">{pt("production.selectExistingMaterialsAndConfigureRulesForEach")}</p>
        <ProductPicker data={data} scrap disabled={action.busy} onSelect={product => {
          if (product.id === editor.product_id || editor.items.some(row => row.product_id === product.id)) {
            action.setError(pt("production.scrapCannotBeTheFinishedProductOrAn"));
            return;
          }
          if (editor.scraps.some(row => row.product_id === product.id)) {
            action.setError(pt("production.thisScrapIsAlreadyAddedEditItsExisting"));
            return;
          }
          if (editor.scraps.length >= 100) {
            action.setError(pt("production.atMost100ScrapTypesAreAllowed"));
            return;
          }
          update({ scraps: [...editor.scraps, { product_id: product.id, product, unit: product.unit, method: 'output', source_product_id: null, quantity: 1, note: '' }] });
        }} />
        {!editor.scraps.length && <p className="bom-empty">{pt("production.leaveEmptyIfThereIsNoScrap")}</p>}
        {editor.scraps.length > 0 && <BomScrapTable
          scraps={editor.scraps}
          items={editor.items}
          busy={action.busy}
          onPatchScrap={patchScrap}
          onRemoveScrap={productId => update({ scraps: editor.scraps.filter(item => item.product_id !== productId) })}
        />}
      </section>

      {productionMessage(action.error) && <p className="form-error bom-error" role="alert">{productionMessage(action.error)}</p>}
      <div className="bom-editor-actions">
        <Button type="button" disabled={action.busy} onClick={back}>{pt("production.cancel")}</Button>
        {editor.id && <Button type="button" disabled={action.busy} onClick={() => { if (!dirty || window.confirm(pt("production.reloadingWillDiscardUnsavedChangesContinue"))) open(editor.id, 'edit'); }}>
          {pt("production.reloadSavedBom")}
        </Button>}
        <Button type="submit" icon={Save} kind="primary" busy={action.busy} disabled={!editor.product || !editor.items.length}>
          {pt("production.saveBom")}
        </Button>
      </div>
    </AntForm>
  </div>;
}
