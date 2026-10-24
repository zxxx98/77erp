import { Button, Badge } from '../components/common.jsx';
import { count, dateTime } from '../app/format.js';

export function ProductionApprovalList({ documents, busy, onView, statusLabels, receipt = false }) {
  return <ul className="production-approval-list">{documents.map(doc => <li className="production-approval-row" key={doc.id}>
    <div className="production-approval-summary">
      <div className="production-approval-number"><strong>{doc.number}</strong><Badge tone={doc.status === 'pending' ? 'orange' : doc.status === 'confirmed' ? 'green' : 'gray'}>{statusLabels[doc.status]}</Badge></div>
      <p>{doc.production_number} · {doc.product_name}</p>
      <small>{receipt ? `第 ${doc.batch_number} 批 · ${count(doc.quantity)} ${doc.unit}` : `${doc.type === 'in' ? '退料' : doc.kind === 'supplement' ? '补料' : '领料'} · ${doc.items.length} 种材料`} · {doc.created_by_name} · {dateTime(doc.created_at)}</small>
    </div>
    <Button disabled={busy} aria-label={`${doc.status === 'pending' ? '查看并审批' : '查看详情'} ${doc.number}`} onClick={() => onView(doc.id)}>{doc.status === 'pending' ? '查看并审批' : '查看详情'}</Button>
  </li>)}</ul>;
}
