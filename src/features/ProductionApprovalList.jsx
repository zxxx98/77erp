import { t as translate, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Button, Badge } from '../components/common.jsx';
import { count, dateTime } from '../app/format.js';

export function ProductionApprovalList({ documents, busy, onView, statusLabels, receipt = false }) {
  useLocale();
  return <ul className="production-approval-list">{documents.map(doc => <li className="production-approval-row" key={doc.id}>
    <div className="production-approval-summary">
      <div className="production-approval-number"><strong>{doc.number}</strong><Badge tone={doc.status === 'pending' ? 'orange' : doc.status === 'confirmed' ? 'green' : 'gray'}>{statusLabels[doc.status]}</Badge></div>
      <p>{doc.production_number} · {doc.product_name}</p>
      <small>{receipt ? translate("warehouse.batch.2", { v0: doc.batch_number, v1: count(doc.quantity), v2: doc.unit }) : translate("warehouse.materials.2", { v0: doc.type === 'in' ? translate("warehouse.material.return") : doc.kind === 'supplement' ? translate("warehouse.additional.material.issue") : translate("warehouse.material.issue"), v1: doc.items.length })} · {doc.created_by_name} · {dateTime(doc.created_at)}</small>
    </div>
    <Button disabled={busy} aria-label={`${doc.status === 'pending' ? translate("warehouse.view.and.approve") : translate("warehouse.view.details")} ${doc.number}`} onClick={() => onView(doc.id)}>{doc.status === 'pending' ? translate("warehouse.view.and.approve") : translate("warehouse.view.details")}</Button>
  </li>)}</ul>;
}
