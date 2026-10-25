import { t as pt, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { FormField } from './../ui/FormField.jsx';
import { Input as AntInput } from '../ui/controls.jsx';

import { Button } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { quantityUnits, QUANTITY_SCALE, validQuantity } from '../../shared/quantity.js';

const count = value => Number(value).toLocaleString(getFormatLocale(), { maximumFractionDigits: 4 });

export function ScrapOutputs({ rows, materials = [], complete = false, completed = false, showPlan = true, disabled = false, receiptStatus, onChange }) {
  useLocale();
  if (!rows.length) return null;
  const stockLabel = receiptStatus === 'confirmed' ? pt("production.received") : receiptStatus === 'pending' ? pt("production.pendingReceipt") : receiptStatus === 'void' ? pt("production.receiptVoided") : pt("production.receiptRegistration");
  return <section className="scrap-outputs" aria-label={pt("production.scrapOutput")}>
    <h2>{complete ? pt("production.verifyScrapOutput") : completed ? pt("production.scrapOutputRecords") : pt("production.estimatedScrapOutput")}</h2>
    <p className="bom-hint">{pt("production.estimatesUseThisOrderSRulesVerifyActual")}</p>
    {rows.map(row => {
      const name = row.name || row.product?.name;
      const source = materials.find(item => item.product_id === row.source_product_id);
      const sourceName = source?.name || source?.product?.name || pt("production.specifiedMaterial");
      const expected = completed || complete ? row.expected_quantity : row.planned_quantity;
      const actual = complete ? row.actual : row.actual_quantity;
      const validActual = actual !== '' && actual != null && validQuantity(Number(actual));
      const difference = expected != null && validActual ? (quantityUnits(Number(actual)) - quantityUnits(expected)) / QUANTITY_SCALE : null;
      return <article className="scrap-output" key={row.product_id}>
        <div><strong>{name}</strong><small>{row.barcode || row.product?.barcode} · {row.method === 'input_ratio' ? pt("production.of", { v0: sourceName, v1: complete || completed ? pt("production.actualUsage3") : pt("production.inputIncludingStandardLoss"), v2: count(row.quantity) }) : pt("production.forBaseOutput", { v0: row.quantity_fraction || count(row.quantity), v1: row.unit })}</small>
          {showPlan && (complete || completed) && <small>{pt("production.plannedEstimate")} {count(row.planned_quantity)} {row.unit}</small>}
          {row.note && <small>{row.note}</small>}
          {row.product && row.unit !== row.product.unit && <p className="bom-warning">{pt("production.unitChangedTo")} {row.product.unit}{pt("production.thisOrderRetains2")} {row.unit}。</p>}
          {row.product && !row.product.active && <p className="bom-warning">{pt("production.scrapMaterialDisabled")}</p>}</div>
        <div><small>{complete || completed ? pt("production.completionEstimate") : pt("production.plannedEstimate")}</small><span>{expected == null ? pt("production.verifyOutputAndUsageFirst") : `${count(expected)} ${row.unit}`}</span></div>
        {complete ? <>
          <label>{pt("production.actualOutput")}{row.unit}）<FormField value={row.actual} required label={pt("production.actualScrap", { v0: name })}><AntInput aria-label={pt("production.actualScrap", { v0: name })} inputMode="decimal"  disabled={disabled} value={row.actual}
            onChange={e => onChange(row.product_id, { quantity: e.target.value })} /></FormField></label>
          <label>{pt("production.handlingMethod")}<Select aria-label={pt("production.handlingMethod2", { v0: name })} disabled={disabled} value={row.disposition} onChange={e => onChange(row.product_id, { disposition: e })}>
            <option value="stock">{pt("production.receivePendingWarehouseApproval")}</option><option value="discard">{pt("production.directDisposal")}</option>
          </Select></label>
          <Button type="button" disabled={disabled || expected == null} onClick={() => onChange(row.product_id, { quantity: String(expected) })} aria-label={pt("production.useEstimate", { v0: name })}>{pt("production.useEstimate2")}</Button>
        </> : completed && <div><small>{pt("production.actualOutput2")} {row.disposition === 'mixed' ? pt("production.disposal", { v0: stockLabel }) : row.disposition === 'stock' ? stockLabel : pt("production.directDisposal")}</small><span>{count(actual)} {row.unit}</span>
          {row.stock_quantity != null && <small>{stockLabel} {count(row.stock_quantity)} {pt("production.directDisposal2")} {count(row.discard_quantity)} {row.unit}</small>}</div>}
        {(complete || completed) && difference != null && <small className={difference ? 'bom-warning' : ''}>{pt("production.vsCompletionEstimate")} {difference > 0 ? '+' : ''}{count(difference)} {row.unit}</small>}
      </article>;
    })}
  </section>;
}
