import { Calculator, Ellipsis, Pencil, PlusSquare } from 'lucide-react';
import { Badge } from '../components/common.jsx';
import { SortHandle } from '../components/SortableList.jsx';
import { t as pt, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';

const formatCount = value => Number(value).toLocaleString(getFormatLocale(), { maximumFractionDigits: 4 });

export function BomListTable({
  items,
  sort,
  sortable,
  busy,
  onOpen,
  onCreateProduction,
  onMore,
}) {
  useLocale();
  const customSort = sort === 'custom';
  return <div className="bom-table-wrap">
    <table className="data-table bom-list-table">
      <thead>
        <tr>
          {customSort && <th scope="col" className="bom-col-sort"><span className="bom-visually-hidden">{pt('production.dragToSort')}</span></th>}
          <th scope="col">{pt('production.bomName')}</th>
          <th scope="col">{pt('production.finishedProductCol')}</th>
          <th scope="col" className="bom-col-num">{pt('production.baseOutput')}</th>
          <th scope="col" className="bom-col-num">{pt('production.materialCountCol')}</th>
          <th scope="col">{pt('production.statusCol')}</th>
          <th scope="col">{pt('production.updatedByCol')}</th>
          <th scope="col" className="bom-col-actions">{pt('production.actionsCol')}</th>
        </tr>
      </thead>
      <tbody>
        {items.map(bom => <tr className="bom-list-item" key={bom.id} {...sortable.itemProps(bom.id)}>
          {customSort && <td className="bom-list-cell-sort">
            <SortHandle sortable={sortable} id={bom.id} label={pt('production.dragToSort')} />
          </td>}
          <td className="bom-list-cell-name">
            <div className="bom-cell-main">
              <strong>{bom.name}</strong>
              <small className="bom-mono">#{bom.id} {pt('production.revision')} {bom.version}</small>
            </div>
          </td>
          <td className="bom-list-cell-product" data-label={pt('production.finishedProductCol')}>
            <div className="bom-cell-main">
              <span>{bom.product_name}</span>
              <small className="bom-mono">{bom.barcode}</small>
            </div>
          </td>
          <td className="bom-col-num bom-list-cell-output" data-label={pt('production.baseOutput')}>
            <span className="bom-num">{formatCount(bom.base_quantity)}</span>{' '}
            <span className="bom-unit">{bom.base_unit}</span>
          </td>
          <td className="bom-col-num bom-list-cell-count" data-label={pt('production.materialCountCol')}>
            <span className="bom-num">{bom.item_count}</span>
          </td>
          <td className="bom-list-cell-status" data-label={pt('production.statusCol')}>
            <div className="bom-status-badges">
              <Badge tone={bom.enabled ? 'green' : 'orange'}>{bom.enabled ? pt('production.enabled') : pt('production.disabled2')}</Badge>
              {!bom.product_active && <Badge tone="orange">{pt('production.productDisabled')}</Badge>}
            </div>
          </td>
          <td className="bom-list-cell-updater" data-label={pt('production.updatedByCol')}>
            <span className="bom-cell-muted">{bom.updated_by_name}</span>
          </td>
          <td className="bom-col-actions bom-list-cell-actions">
            <div className="bom-list-table-actions">
              <button
                type="button"
                className="bom-row-btn bom-row-btn-primary"
                disabled={busy || !bom.enabled}
                onClick={() => onOpen(bom.id, 'calculate')}
              >
                <Calculator size={14} aria-hidden="true" />
                <span>{pt('production.planMaterials')}</span>
              </button>
              {onCreateProduction && <button
                type="button"
                className="bom-row-btn"
                disabled={busy || !bom.enabled || !bom.product_active}
                onClick={() => onCreateProduction(bom)}
              >
                <PlusSquare size={14} aria-hidden="true" />
                <span>{pt('production.newProductionOrder')}</span>
              </button>}
              <button
                type="button"
                className="bom-row-btn"
                disabled={busy}
                onClick={() => onOpen(bom.id, 'edit')}
              >
                <Pencil size={14} aria-hidden="true" />
                <span>{pt('production.edit')}</span>
              </button>
              <button
                type="button"
                className="bom-row-btn"
                disabled={busy}
                aria-label={pt('production.moreActions')}
                onClick={() => onMore(bom)}
              >
                <Ellipsis size={14} aria-hidden="true" />
                <span>{pt('production.moreActions')}</span>
              </button>
            </div>
          </td>
        </tr>)}
      </tbody>
    </table>
  </div>;
}
