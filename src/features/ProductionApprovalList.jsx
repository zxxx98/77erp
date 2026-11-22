import { t as translate, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Button, Badge } from '../components/common.jsx';
import { count, dateTime } from '../app/format.js';

export function ProductionApprovalList({ documents, busy, onView, statusLabels, receipt = false }) {
  useLocale();
  if (!documents.length) return null;
  return <div className="production-approval-list erp-table-wrap erp-table-mobile-stack">
    <table className="erp-table production-approval-table">
      <thead>
        <tr>
          <th scope="col">{translate("production.approvalDocCol")}</th>
          <th scope="col">{translate("production.statusCol")}</th>
          <th scope="col">{translate("export.productionOrder")}</th>
          <th scope="col">{translate("production.approvalItemsCol")}</th>
          <th scope="col">{translate("production.approvalMetaCol")}</th>
          <th scope="col" className="erp-col-actions">{translate("production.actionsCol")}</th>
        </tr>
      </thead>
      <tbody>
        {documents.map(doc => <tr className="production-approval-row" key={doc.id}>
          <td className="erp-cell-main">
            <div className="erp-cell-stack">
              <strong>{doc.number}</strong>
              <small>{doc.kind === 'stage' && `${translate('production.stageReceiptTitle')} · `}{doc.product_name}</small>
            </div>
          </td>
          <td data-label={translate("production.statusCol")}>
            <Badge tone={doc.status === 'pending' ? 'orange' : doc.status === 'confirmed' ? 'green' : 'gray'}>{statusLabels[doc.fulfillment_status || doc.status]}</Badge>
          </td>
          <td data-label={translate("export.productionOrder")}>{doc.production_number}</td>
          <td data-label={translate("production.approvalItemsCol")}>
            <span>{receipt ? translate("warehouse.batch.2", { v0: doc.batch_number, v1: count(doc.quantity), v2: doc.unit }) : translate("warehouse.materials.2", { v0: doc.type === 'in' ? translate("warehouse.material.return") : doc.kind === 'supplement' ? translate("warehouse.additional.material.issue") : translate("warehouse.material.issue"), v1: doc.items.length })}</span>
          </td>
          <td data-label={translate("production.approvalMetaCol")}>
            <div className="erp-cell-stack">
              <span>{doc.created_by_name}</span>
              <small>{dateTime(doc.created_at)}</small>
            </div>
          </td>
          <td className="erp-col-actions">
            <Button disabled={busy} aria-label={`${doc.status === 'pending' ? translate("warehouse.view.and.approve") : translate("warehouse.view.details")} ${doc.number}`} onClick={() => onView(doc.id)}>{doc.status === 'pending' ? translate("warehouse.view.and.approve") : translate("warehouse.view.details")}</Button>
          </td>
        </tr>)}
      </tbody>
    </table>
  </div>;
}
