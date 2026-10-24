import { FormField } from './../ui/FormField.jsx';
import { Input as AntInput } from '../ui/controls.jsx';

import { Button } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { quantityUnits, QUANTITY_SCALE, validQuantity } from '../../shared/quantity.js';

const count = value => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 4 });

export function ScrapOutputs({ rows, materials = [], complete = false, completed = false, showPlan = true, disabled = false, receiptStatus, onChange }) {
  if (!rows.length) return null;
  const stockLabel = receiptStatus === 'confirmed' ? '已入库' : receiptStatus === 'pending' ? '待入库' : receiptStatus === 'void' ? '入库已作废' : '入库登记';
  return <section className="scrap-outputs" aria-label="废料产出">
    <h2>{complete ? '核对废料产出' : completed ? '废料产出记录' : '预计废料产出'}</h2>
    <p className="bom-hint">预计数量由本单规则计算，请按实际产出核对。选择入库的废料随本批成品提交仓库批准，批准后才增加库存；直接处置仅记录数量。废料按零成本入库，材料成本全部计入成品。</p>
    {rows.map(row => {
      const name = row.name || row.product?.name;
      const source = materials.find(item => item.product_id === row.source_product_id);
      const sourceName = source?.name || source?.product?.name || '指定材料';
      const expected = completed || complete ? row.expected_quantity : row.planned_quantity;
      const actual = complete ? row.actual : row.actual_quantity;
      const validActual = actual !== '' && actual != null && validQuantity(Number(actual));
      const difference = expected != null && validActual ? (quantityUnits(Number(actual)) - quantityUnits(expected)) / QUANTITY_SCALE : null;
      return <article className="scrap-output" key={row.product_id}>
        <div><strong>{name}</strong><small>{row.barcode || row.product?.barcode} · {row.method === 'input_ratio' ? `${sourceName}${complete || completed ? '实际耗料' : '含标准损耗投入'}的 ${count(row.quantity)}%` : `基准产量对应 ${row.quantity_fraction || count(row.quantity)} ${row.unit}`}</small>
          {showPlan && (complete || completed) && <small>计划预计 {count(row.planned_quantity)} {row.unit}</small>}
          {row.note && <small>{row.note}</small>}
          {row.product && row.unit !== row.product.unit && <p className="bom-warning">单位已变为 {row.product.unit}，本单保留 {row.unit}。</p>}
          {row.product && !row.product.active && <p className="bom-warning">废料物料已停用</p>}</div>
        <div><small>{complete || completed ? '完工预计' : '计划预计'}</small><span>{expected == null ? '请先核对产量与耗料' : `${count(expected)} ${row.unit}`}</span></div>
        {complete ? <>
          <label>实际产出（{row.unit}）<FormField value={row.actual} required label={`${name}实际废料`}><AntInput aria-label={`${name}实际废料`} inputMode="decimal"  disabled={disabled} value={row.actual}
            onChange={e => onChange(row.product_id, { quantity: e.target.value })} /></FormField></label>
          <label>处理方式<Select aria-label={`${name}处理方式`} disabled={disabled} value={row.disposition} onChange={e => onChange(row.product_id, { disposition: e })}>
            <option value="stock">入库（待仓库批准）</option><option value="discard">直接处置</option>
          </Select></label>
          <Button type="button" disabled={disabled || expected == null} onClick={() => onChange(row.product_id, { quantity: String(expected) })} aria-label={`${name}采用预计数量`}>采用预计数量</Button>
        </> : completed && <div><small>实际产出 · {row.disposition === 'mixed' ? `${stockLabel}／处置` : row.disposition === 'stock' ? stockLabel : '直接处置'}</small><span>{count(actual)} {row.unit}</span>
          {row.stock_quantity != null && <small>{stockLabel} {count(row.stock_quantity)} · 直接处置 {count(row.discard_quantity)} {row.unit}</small>}</div>}
        {(complete || completed) && difference != null && <small className={difference ? 'bom-warning' : ''}>较完工预计 {difference > 0 ? '+' : ''}{count(difference)} {row.unit}</small>}
      </article>;
    })}
  </section>;
}
