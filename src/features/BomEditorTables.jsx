import { useState } from 'react';
import { ChevronDown, GitBranch, Trash2 } from 'lucide-react';
import { Button } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { Input as AntInput } from '../ui/controls.jsx';
import { FormField } from '../ui/FormField.jsx';
import { ChildBomPicker } from './ChildBomPicker.jsx';
import { bomRequiredQuantity, parseBomQuantity, validateBomLossRate } from '../../shared/bom.js';
import { t as pt, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';

const formatCount = value => Number(value).toLocaleString(getFormatLocale(), { maximumFractionDigits: 4 });

function computeGrossPreview(quantity, lossRate, lossMethod) {
  try {
    const rateText = String(lossRate).trim();
    if (!/^\d+(\.\d{1,6})?$/.test(rateText)) return null;
    const rate = Number(lossRate);
    validateBomLossRate(rate);
    const parsed = parseBomQuantity(quantity);
    const gross = bomRequiredQuantity(parsed.quantity, 1, 1, parsed.quantity_fraction, rate, lossMethod);
    return { parsed, gross };
  } catch {
    return null;
  }
}

function BomMaterialTableRowGroup({ index, item, lossMethod, queryData, busy, onPatch, onRemove }) {
  useLocale();
  const [childOpen, setChildOpen] = useState(() => item.usage_mode === 'explode' || !!item.child_bom_id);
  const preview = computeGrossPreview(item.quantity, item.loss_rate, lossMethod);

  return <tbody className={`bom-material${childOpen ? ' is-child-open' : ''}`}>
    <tr className="bom-material-main-row">
      <td className="bom-col-index">
        <span className="bom-row-num">{index + 1}</span>
      </td>
      <td className="bom-col-name">
        <div className="bom-cell-main">
          <strong>{item.product.name}</strong>
          <small className="bom-mono">
            {item.product.barcode} · {item.product.specification || pt('production.noSpecification')}
            {!item.product.active && pt('production.disabled')}
          </small>
          {item.unit !== item.product.unit && <span className="bom-warning">
            {pt('production.unitChangedFrom')} {item.unit} {pt('production.to')} {item.product.unit}{pt('production.verifyUsage')}
          </span>}
        </div>
      </td>
      <td className="bom-col-qty" data-label={pt('production.netUsageCol')}>
        <div className="bom-cell-input-unit">
          <FormField value={item.quantity} required maxLength={60} label={pt('production.usage', { v0: item.product.name })}>
            <AntInput
              className="bom-table-input bom-table-num-input"
              aria-label={pt('production.usage', { v0: item.product.name })}
              aria-describedby="bom-usage-help bom-loss-help"
              inputMode="text"
              placeholder={pt('production.eG0025Or140')}
              maxLength={60}
              spellCheck={false}
              value={item.quantity}
              disabled={busy}
              onChange={e => onPatch({ quantity: e.target.value })}
            />
          </FormField>
          <span className="bom-unit-suffix">{item.product.unit}</span>
        </div>
      </td>
      <td className="bom-col-loss" data-label={pt('production.lossRateCol')}>
        <div className="bom-cell-input-unit">
          <FormField value={item.loss_rate} required maxLength={20} label={pt('production.standardLossRate3', { v0: item.product.name })}>
            <AntInput
              className="bom-table-input bom-table-num-input"
              aria-label={pt('production.standardLossRate3', { v0: item.product.name })}
              aria-describedby="bom-loss-help"
              inputMode="decimal"
              maxLength={20}
              value={item.loss_rate}
              disabled={busy}
              onChange={e => onPatch({ loss_rate: e.target.value })}
            />
          </FormField>
          <span className="bom-unit-suffix">%</span>
        </div>
      </td>
      <td className="bom-col-gross" data-label={pt('production.grossInputCol')}>
        {preview ? <div className="bom-usage-preview bom-table-gross">
          <span className="bom-gross-line">
            <span className="bom-visually-hidden">{pt('production.standardInputIncludingLoss')} </span>
            <strong className="bom-num">{formatCount(preview.gross)}</strong>{' '}
            <span className="bom-unit">{item.product.unit}</span>
          </span>
          {preview.parsed.quantity_fraction && <small className="bom-fraction-approx">
            {pt('production.approximately')} {formatCount(preview.parsed.quantity)} {item.product.unit}{pt('production.calculatedUsingTheOriginalFraction')}
          </small>}
        </div> : <span className="bom-cell-muted">—</span>}
      </td>
      <td className="bom-col-child" data-label={pt('production.childBomCol')}>
        <button
          type="button"
          className={`bom-child-trigger${item.child_bom_id ? ' is-linked' : ''}`}
          aria-expanded={childOpen}
          onClick={() => setChildOpen(open => !open)}
        >
          <GitBranch size={13} aria-hidden="true" />
          <span className="bom-child-trigger-label">
            {item.child_bom_id
              ? `${item.child_bom?.name || pt('production.selectedRecipe')} #${item.child_bom_id}`
              : `${pt('production.directIssueLinkChild')} · ${pt('production.linkChildBom')}`}
          </span>
          <ChevronDown size={13} className={`bom-child-trigger-chevron${childOpen ? ' is-open' : ''}`} aria-hidden="true" />
        </button>
      </td>
      <td className="bom-col-note" data-label={pt('production.note')}>
        <FormField value={item.note} maxLength={200} label={pt('production.note2', { v0: item.product.name })}>
          <AntInput
            className="bom-table-input"
            aria-label={pt('production.note2', { v0: item.product.name })}
            placeholder={pt('production.optionalNotePlaceholder')}
            maxLength={200}
            value={item.note}
            disabled={busy}
            onChange={e => onPatch({ note: e.target.value })}
          />
        </FormField>
      </td>
      <td className="bom-col-del">
        <button
          type="button"
          className="bom-icon-del"
          disabled={busy}
          aria-label={pt('production.removeMaterial', { v0: item.product.name })}
          title={pt('production.remove')}
          onClick={onRemove}
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </td>
    </tr>
    <tr className={`bom-material-child-row${childOpen ? ' is-open' : ''}`}>
      <td colSpan={8} className="bom-child-cell">
        <details
          className="bom-disclosure bom-table-child-details"
          open={childOpen}
          onToggle={e => setChildOpen(e.currentTarget.open)}
        >
          <summary>
            <span>{pt('production.supplyBomHint')}</span>
            <ChevronDown className="bom-disclosure-chevron" size={16} aria-hidden="true" />
          </summary>
          <div className="bom-table-child-body">
            <p className="bom-hint">{pt('production.supplyBomDescription')}</p>
            <ChildBomPicker
              item={item}
              data={queryData}
              disabled={busy}
              recipeOnly
              onChange={patch => onPatch({ ...patch, usage_mode: 'explode' })}
            />
            {item.child_bom_id && <Button
              type="button"
              disabled={busy}
              onClick={() => {
                onPatch({ usage_mode: 'stock', child_bom_id: null, child_bom: null });
                setChildOpen(false);
              }}
            >
              {pt('production.supplyRemoveReference')}
            </Button>}
          </div>
        </details>
      </td>
    </tr>
  </tbody>;
}

export function BomMaterialTable({ items, lossMethod, queryData, busy, onPatchItem, onRemoveItem }) {
  useLocale();
  const childCount = items.filter(item => item.usage_mode === 'explode' && item.child_bom_id).length;

  return <div className="bom-table-wrap bom-edit-table-wrap">
    <table className="bom-edit-table bom-material-table">
      <thead>
        <tr>
          <th scope="col" className="bom-col-index">#</th>
          <th scope="col" className="bom-col-name">{pt('production.material2')}</th>
          <th scope="col" className="bom-col-qty">{pt('production.netUsageCol')}</th>
          <th scope="col" className="bom-col-loss">{pt('production.lossRateCol')}</th>
          <th scope="col" className="bom-col-gross bom-col-num">{pt('production.grossInputCol')}</th>
          <th scope="col" className="bom-col-child">{pt('production.childBomCol')}</th>
          <th scope="col" className="bom-col-note">{pt('production.note')}</th>
          <th scope="col" className="bom-col-del"><span className="bom-visually-hidden">{pt('production.actionsCol')}</span></th>
        </tr>
      </thead>
      {items.map((item, index) => <BomMaterialTableRowGroup
        key={item.product_id}
        index={index}
        item={item}
        lossMethod={lossMethod}
        queryData={queryData}
        busy={busy}
        onPatch={patch => onPatchItem(item.product_id, patch)}
        onRemove={() => onRemoveItem(item.product_id)}
      />)}
      <tfoot>
        <tr>
          <td colSpan={8}>
            <div className="bom-table-summary">
              <span>{pt('production.bomMaterialSummaryCount', { count: items.length })}</span>
              {childCount > 0 && <span className="bom-cell-muted">{pt('production.bomMaterialChildCount', { count: childCount })}</span>}
            </div>
          </td>
        </tr>
      </tfoot>
    </table>
  </div>;
}

export function BomScrapTable({ scraps, items, busy, onPatchScrap, onRemoveScrap }) {
  useLocale();
  return <div className="bom-table-wrap bom-edit-table-wrap">
    <table className="bom-edit-table bom-scrap-table">
      <thead>
        <tr>
          <th scope="col" className="bom-col-index">#</th>
          <th scope="col" className="bom-col-name">{pt('production.scrapMaterialCol')}</th>
          <th scope="col" className="bom-col-method">{pt('production.calculationMethod')}</th>
          <th scope="col" className="bom-col-source">{pt('production.sourceMaterial')}</th>
          <th scope="col" className="bom-col-scrap-qty">{pt('production.scrapAmountOrRatioCol')}</th>
          <th scope="col" className="bom-col-note">{pt('production.scrapNote')}</th>
          <th scope="col" className="bom-col-del"><span className="bom-visually-hidden">{pt('production.actionsCol')}</span></th>
        </tr>
      </thead>
      <tbody>
        {scraps.map((row, index) => {
          const sameUnitMaterials = items.filter(item => item.product.unit === row.product.unit);
          const qtyLabel = `${row.product.name}${row.method === 'output' ? pt('production.baseScrapQuantity2') : pt('production.scrapRatio2')}`;
          return <tr className="bom-scrap-rule bom-scrap-row" key={row.product_id}>
            <td className="bom-col-index"><span className="bom-row-num">{index + 1}</span></td>
            <td className="bom-col-name">
              <div className="bom-cell-main">
                <strong>{row.product.name}</strong>
                <small className="bom-mono">
                  {row.product.barcode} · {row.product.unit}
                  {!row.product.active && pt('production.disabled')}
                </small>
                {row.unit !== row.product.unit && <span className="bom-warning">{pt('production.unitChangedVerifyTheRuleBeforeSaving')}</span>}
              </div>
            </td>
            <td className="bom-col-method" data-label={pt('production.calculationMethod')}>
              <Select
                aria-label={pt('production.calculationMethod2', { v0: row.product.name })}
                value={row.method}
                disabled={busy}
                onChange={e => onPatchScrap(row.product_id, {
                  method: e,
                  source_product_id: e === 'input_ratio' && sameUnitMaterials.length === 1 ? sameUnitMaterials[0].product_id : null,
                  quantity: '',
                })}
              >
                <option value="output">{pt('production.byOutput')}</option>
                <option value="input_ratio">{pt('production.byMaterialInputRatio')}</option>
              </Select>
            </td>
            <td className="bom-col-source" data-label={pt('production.sourceMaterial')}>
              {row.method === 'input_ratio' ? <Select
                aria-label={pt('production.sourceMaterial2', { v0: row.product.name })}
                value={row.source_product_id ?? ''}
                required
                disabled={busy}
                onChange={e => onPatchScrap(row.product_id, { source_product_id: Number(e) })}
              >
                <option value="">{pt('production.selectMaterialWithTheSameUnit')}</option>
                {sameUnitMaterials.map(item => <option value={item.product_id} key={item.product_id}>{item.product.name}</option>)}
              </Select> : <span className="bom-cell-muted">—</span>}
            </td>
            <td className="bom-col-scrap-qty" data-label={pt('production.scrapAmountOrRatioCol')}>
              <div className="bom-cell-input-unit">
                <FormField value={row.quantity} required maxLength={60} label={qtyLabel}>
                  <AntInput
                    className="bom-table-input bom-table-num-input"
                    aria-label={qtyLabel}
                    inputMode={row.method === 'output' ? 'text' : 'decimal'}
                    maxLength={60}
                    value={row.quantity}
                    disabled={busy}
                    onChange={e => onPatchScrap(row.product_id, { quantity: e.target.value })}
                  />
                </FormField>
                <span className="bom-unit-suffix">{row.method === 'output' ? row.product.unit : '%'}</span>
              </div>
            </td>
            <td className="bom-col-note" data-label={pt('production.scrapNote')}>
              <AntInput
                className="bom-table-input"
                aria-label={pt('production.scrapNote2', { v0: row.product.name })}
                placeholder={pt('production.optionalNotePlaceholder')}
                maxLength={200}
                value={row.note}
                disabled={busy}
                onChange={e => onPatchScrap(row.product_id, { note: e.target.value })}
              />
            </td>
            <td className="bom-col-del">
              <button
                type="button"
                className="bom-icon-del"
                disabled={busy}
                aria-label={pt('production.removeScrap', { v0: row.product.name })}
                title={pt('production.remove')}
                onClick={() => onRemoveScrap(row.product_id)}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </td>
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
}
