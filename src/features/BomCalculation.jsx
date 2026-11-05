import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Calculator, Download } from 'lucide-react';
import { api } from '../api.js';
import { useBusiness } from '../business-api.js';
import { PageHeading, Button } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { Input as AntInput, Checkbox as AntCheckbox } from '../ui/controls.jsx';
import { downloadFile } from '../app/download.js';
import { bomStructureCSV, bomCSV } from '../bom-csv.js';
import { parseQuantity } from '../../shared/quantity.js';
import { productionMessage } from '../i18n/production-errors.js';
import { bomLossMethodLabels, bomLossMethodFormulas } from '../i18n/production-display.js';
import { t as pt, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { BomResultViews } from './BomResultViews.jsx';
import { ScrapOutputs } from './ScrapOutputs.jsx';

const count = value => Number(value).toLocaleString(getFormatLocale(), { maximumFractionDigits: 4 });

export function BomCalculation({ bom, data, onBack, onCreateProduction }) {
  const { locale } = useLocale();
  const [outputLanguage, setOutputLanguage] = useState(null);
  const [quantity, setQuantity] = useState(String(bom.base_quantity));
  const [snapshot, setSnapshot] = useState(null);
  const [stale, setStale] = useState(false);
  const [shortageOnly, setShortageOnly] = useState(false);
  const snapshotData = useRef(data);

  useEffect(() => {
    if (!snapshot || snapshotData.current === data) return;
    const controller = new AbortController();
    api(`/boms/${bom.id}/calculate`, {
      method: 'POST',
      warehouseId: data.warehouse_id,
      signal: controller.signal,
      body: { production_quantity: snapshot.production_quantity, version: snapshot.version, schema_version: 2 },
    })
      .then(result => {
        if (!controller.signal.aborted) {
          setStale(result.structure_token !== snapshot.structure_token);
          snapshotData.current = data;
        }
      })
      .catch(() => { if (!controller.signal.aborted) setStale(true); });
    return () => controller.abort();
  }, [data, snapshot, bom.id]);

  const action = useBusiness();
  const shortages = snapshot ? snapshot.rows.filter(row => row.shortage > 0).length : 0;

  return <>
    <PageHeading title={pt("production.materialPlanning")} description={`${bom.name} #${bom.id} · ${bom.product.name} · ${bom.product.barcode}`}>
      <Button icon={ArrowLeft} disabled={action.busy} onClick={onBack}>{pt("production.backToBom")}</Button>
    </PageHeading>
    <section className="panel bom-section">
      <div className="bom-calculate-form">
        <label>
          {pt("production.productionQuantity")}{bom.product.unit}）
          <AntInput
            aria-label={pt("production.productionQuantity2")}
            inputMode="decimal"
            value={quantity}
            disabled={action.busy}
            onChange={e => { setQuantity(e.target.value); setSnapshot(null); action.setError(''); }}
          />
        </label>
        <Button
          kind="primary"
          icon={Calculator}
          busy={action.busy}
          onClick={() => action.run(async () => {
            const production_quantity = parseQuantity(quantity, true);
            const result = await api(`/boms/${bom.id}/calculate`, {
              method: 'POST',
              warehouseId: data.warehouse_id,
              body: { production_quantity, version: bom.version, schema_version: 2 },
            });
            snapshotData.current = data;
            setStale(false);
            setSnapshot(result);
          })}
        >
          {snapshot ? pt("production.recalculate") : pt("production.calculate")}
        </Button>
      </div>
      <p className="bom-hint">
        {pt("production.baseOutput")} {count(bom.base_quantity)} {bom.base_unit}
        {pt("production.standardLossUses")}{bomLossMethodLabels[bom.loss_method]}：{bomLossMethodFormulas[bom.loss_method]}
        {pt("production.thenScalesByProductionQuantityBaseOutputRounded")}
      </p>
      {productionMessage(action.error) && <p className="form-error" role="alert">{productionMessage(action.error)}</p>}
    </section>
    {snapshot && <section className="panel bom-section bom-calculation-result">
      <div className="bom-section-heading">
        <div>
          <h2>{pt("production.materialRequirements")}</h2>
          <p className="bom-hint">
            {snapshot.warehouse.name} {pt("production.stockReadAt")} {new Date(snapshot.captured_at).toLocaleString(getFormatLocale(), { hour12: false })}
          </p>
        </div>
        <div className="bom-actions bom-result-actions">
          {onCreateProduction && <Button kind="primary" disabled={stale} onClick={() => onCreateProduction({ ...bom, planned_quantity: snapshot.production_quantity })}>
            {pt("production.createProductionOrderForThisQuantity")}
          </Button>}
          <Select aria-label={pt("production.outputLanguage")} value={outputLanguage || locale} onChange={setOutputLanguage}>
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
            <option value="vi">Tiếng Việt</option>
          </Select>
          <Button icon={Download} onClick={() => downloadFile(bomCSV(snapshot, outputLanguage || locale), pt("production.materialPlanCsv", { v0: snapshot.product.barcode, v1: snapshot.captured_at.slice(0, 10) }), 'text/csv;charset=utf-8')}>
            {pt("production.exportMaterialPlan")}
          </Button>
          <Button icon={Download} onClick={() => downloadFile(bomStructureCSV(snapshot, outputLanguage || locale), pt("production.bomStructureCsv", { v0: snapshot.bom_id }), 'text/csv;charset=utf-8')}>
            {pt("production.exportStructureDetails")}
          </Button>
        </div>
      </div>
      {snapshot.multi_level && <p className="bom-warning">{pt("production.expandedByGrossRequirementsIntermediateStockIsNot")}</p>}
      {stale && <p className="bom-warning">{pt("production.recipeOrMaterialInformationChangedRecalculateBeforeCreating")}</p>}
      <BomResultViews nodes={snapshot.nodes} quantity={snapshot.production_quantity}>{showSources => <>
        <div className="bom-result-summary-row">
          <p className={`bom-result-summary${shortages ? ' has-shortage' : ''}`} role="status">
            {pt("production.total")} {snapshot.rows.length} {pt("production.materials")}{shortages} {pt("production.shortages")}
          </p>
          {shortages > 0 && <AntCheckbox checked={shortageOnly} onChange={e => setShortageOnly(e.target.checked)}>
            {pt('production.shortageOnly')}
          </AntCheckbox>}
        </div>
        <div className="bom-result-table">
          <table>
            <thead>
              <tr>
                <th>{pt("production.material")}</th>
                <th>{pt("production.baseNetUsage")}</th>
                <th>{pt("production.requiredQuantityIncludingLoss")}</th>
                <th>{pt("production.bookStock")}</th>
                <th>{pt("production.shortageQuantity")}</th>
                <th>{pt("production.note")}</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.rows.filter(row => !shortageOnly || row.shortage > 0).map(row => {
                const single = row.quantity === null && row.sources.length === 1
                  ? snapshot.nodes.find(node => node.path === row.sources[0])
                  : null;
                const shown = single || (row.quantity === null ? null : row);
                return <tr key={row.product_id} className={row.shortage > 0 ? 'bom-shortage-row' : undefined}>
                  <td>
                    <strong>{row.name}</strong>
                    <small>{row.barcode}{row.specification && ` · ${row.specification}`}</small>
                  </td>
                  <td data-label={pt("production.baseNetUsage")}>
                    {shown
                      ? <>{shown.quantity_fraction || count(shown.quantity)} {row.unit}<small>{pt("production.standardLossRate")} {count(shown.loss_rate)}%</small></>
                      : <button type="button" className="bom-tree-action" onClick={() => showSources(row)}>{pt("production.view")} {row.sources.length} {pt("production.sources")}</button>}
                  </td>
                  <td data-label={pt("production.requiredQuantityIncludingLoss")}>{count(row.required)} {row.unit}</td>
                  <td data-label={pt("production.bookStock")}>{count(row.stock)} {row.unit}</td>
                  <td data-label={pt("production.shortageQuantity")} className={row.shortage > 0 ? 'bom-shortage' : ''}>{count(row.shortage)} {row.unit}</td>
                  <td data-label={pt("production.note")}>{row.note || '—'}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        <ScrapOutputs rows={snapshot.scraps || []} materials={snapshot.rows} />
        <p className="bom-hint">{pt("production.resultsAndExportsRetainTheStockReadFor")}</p>
      </>}</BomResultViews>
    </section>}
  </>;
}
