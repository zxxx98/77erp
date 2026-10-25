import { inspectionCycleLabel } from './warehouse-format.js';
import { t as translate, getFormatLocale } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import { Form as AntForm } from 'antd';
import { Input as AntInput } from './ui/controls.jsx';
import { FormField } from './ui/FormField.jsx';

import { useMemo, useState } from 'react';
import { usePagedQuery } from './queries.js';
import { api } from './api.js';
import { useBusiness } from './business-api.js';
import { usePermissions } from './permissions.jsx';
import { Button, Modal } from './components/common.jsx';
import { inspectionCompletion, inspectionToday, nextInspectionDate, validInspectionDate } from '../shared/inspection.js';
import './inspection.css';

export function InspectionPanel({ data }) {
  useLocale();
  const { can } = usePermissions();
  const [revision, setRevision] = useState(0);
  const queryData = useMemo(() => ({ ...data }), [data, revision]);
  const query = usePagedQuery('/products?inspection=due', queryData, 'products');
  const action = useBusiness();
  const [selected, setSelected] = useState(null);
  const [inspectedOn, setInspectedOn] = useState(inspectionToday);
  const [nextDate, setNextDate] = useState('');
  const [message, setMessage] = useState('');
  const periodicDate = useMemo(() => {
    if (!selected?.inspection_interval || !validInspectionDate(inspectedOn)) return '';
    try { return inspectionCompletion(selected, { inspected_on: inspectedOn }).inspection_date; }
    catch { return ''; }
  }, [selected, inspectedOn]);
  const refresh = () => { setSelected(null); action.setError(''); setRevision(value => value + 1); };
  const complete = product => action.run(async () => {
    const saved = await api(`/products/${product.id}/inspect`, {
      method: 'POST', warehouseId: data.warehouse_id,
      body: { version: product.version, inspected_on: inspectedOn, ...(product.inspection_interval ? {} : { next_date: nextDate }) },
    });
    setSelected(null);
    setMessage(translate("warehouse.has.been.verified.next.verification.date", { v0: product.name, v1: saved.inspection_date }));
    setRevision(value => value + 1);
  });
  const products = query.result?.products || [];
  if (!query.result?.total && !query.error && !action.error && !message) return null;
  return <section className="inspection-panel" aria-label={translate("warehouse.materials.due.for.inspection")}>
    <div className="inspection-heading"><h2>{translate("warehouse.materials.due.for.inspection")}{query.result ? `（${query.result.total}）` : ''}</h2><Button disabled={action.busy || query.loading} onClick={refresh}>{translate("warehouse.refresh.list")}</Button></div>
    {message && <p className="inspection-success" role="status">{message}</p>}
    {(query.error || (!selected && action.error)) && <p role="alert" className="form-error">{query.error || action.error}</p>}
    {products.map(product => <div className="inspection-row" key={product.id}>
      <div><strong>{product.name}</strong><small>{product.barcode}{product.specification ? ` · ${product.specification}` : ''}</small><span>{translate("warehouse.verification.date")}{product.inspection_date} · {inspectionCycleLabel(product)}</span></div>
      {can('products') && <Button aria-label={translate("warehouse.verified", { v0: product.name })} disabled={action.busy || query.loading} onClick={() => {
        action.setError('');
        setSelected(product);
        setInspectedOn(inspectionToday());
        setNextDate('');
      }}>{translate("warehouse.inspected")}</Button>}
    </div>)}
    {query.result?.has_more && <Button disabled={query.loading || action.busy} onClick={query.loadMore}>{query.loading ? translate("warehouse.loading.2") : translate("warehouse.load.more.materials.to.be.verified")}</Button>}
    {selected && <Modal title={translate("warehouse.record.verified")} subtitle={selected.name} onClose={() => { if (!action.busy) setSelected(null); }}>
      <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }} onFinish={() => {  complete(selected); }}>
        <div className="form-body">
          <label>{translate("warehouse.actual.verification.date")}<FormField value={inspectedOn} required type="date" max={inspectionToday()} label={translate("warehouse.actual.verification.date")}><AntInput type="date" aria-label={translate("warehouse.actual.verification.date")}  max={inspectionToday()} value={inspectedOn} disabled={action.busy} onChange={event => setInspectedOn(event.target.value)} /></FormField><small>{translate("warehouse.the.default.is.today.when.making.supplementary.registration.please.select.the")}</small></label>
          {selected.inspection_interval ? <p>{translate("warehouse.calibration.cycle")}{inspectionCycleLabel(selected)}{translate("warehouse.next.verification.date.2")}{periodicDate || translate("warehouse.please.select.a.valid.actual.verification.date")}{translate("warehouse.it.is.postponed.from.the.actual.verification.date.according.to.the")}</p> : <>
            <p>{translate("warehouse.there.is.no.cycle.configured.for.this.material.please.manually.fill")}</p>
            <label>{translate("warehouse.next.verification.date")}<FormField label={translate("warehouse.next.verification.date")} value={nextDate} required type="date" min={validInspectionDate(inspectedOn) && inspectedOn < '9999-12-31' ? nextInspectionDate(inspectedOn, 1, 'day') : undefined}><AntInput type="date"  min={validInspectionDate(inspectedOn) && inspectedOn < '9999-12-31' ? nextInspectionDate(inspectedOn, 1, 'day') : undefined} value={nextDate} disabled={action.busy} onChange={event => setNextDate(event.target.value)} /></FormField></label>
          </>}
          {action.error && <p role="alert" className="form-error">{action.error}</p>}
        </div>
        <div className="modal-footer"><Button type="button" disabled={action.busy} onClick={() => setSelected(null)}>{translate("warehouse.cancel")}</Button><Button type="submit" kind="primary" busy={action.busy}>{translate("warehouse.complete")}</Button></div>
      </AntForm>
    </Modal>}
  </section>;
}
