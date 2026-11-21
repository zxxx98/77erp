import { useId, useState } from 'react';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { parseQuantity } from '../../shared/quantity.js';
import { Badge, Button, Modal, PageHeading, QueryStatus } from '../components/common.jsx';
import { Input } from '../ui/controls.jsx';
import { api } from '../api.js';
import { useBusiness } from '../business-api.js';
import { t } from '../i18n/index.js';
import { queryPath, usePagedQuery } from '../queries.js';
import { PostProcessingPlan } from './PostProcessingPlan.jsx';

const path = '/post-processing-tables';

function TableList({ data, manage = false, render }) {
  const [search, setSearch] = useState('');
  const list = usePagedQuery(queryPath(path, { q: search, scope: manage ? 'manage' : null }), data, 'tables', 150);
  return <>
    <Input type="search" aria-label={t('production.searchPostProcessingTables')} placeholder={t('production.searchPostProcessingTables')} value={search} onChange={event => setSearch(event.target.value)} />
    <QueryStatus query={list} />
    {list.result?.tables.length === 0 && <p className="bom-hint">{t('production.noPostProcessingTables')}</p>}
    {list.result?.tables.map(render)}
    {list.result?.has_more && <Button disabled={list.loading} onClick={list.loadMore}>{t('route.next')}</Button>}
  </>;
}

export function PostProcessingTablePicker({ data, onClose, onSelect, onSkip }) {
  const action = useBusiness();
  const pickerId = useId();
  return <Modal title={t('production.choosePostProcessingTable')} onClose={() => { if (!action.busy) onClose(); }}>
    <div className="form-body">
      {action.error && <p className="form-error" role="alert">{action.error}</p>}
      {onSkip && <Button disabled={action.busy} onClick={onSkip}>{t('production.skipPostProcessingTable')}</Button>}
      <TableList data={data} render={table => {
        const noteId = table.note ? `${pickerId}-${table.id}-note` : undefined;
        return <Button key={table.id} className="post-processing-table-option" aria-label={table.name} aria-describedby={noteId}
          disabled={action.busy} onClick={() => action.run(async () => {
            onSelect(await api(`${path}/${table.id}/preview`, { warehouseId: data.warehouse_id }));
            onClose();
          })}>
          <span className="post-processing-table-option-label">
            <span>{table.name}</span>
            {table.note && <small id={noteId} className="post-processing-table-note">{table.note}</small>}
          </span>
        </Button>;
      }} />
    </div>
  </Modal>;
}

export function PostProcessingTables({ data, onBack }) {
  const action = useBusiness();
  const [editor, setEditor] = useState(null), [revision, setRevision] = useState(0);
  const options = { warehouseId: data.warehouse_id };
  const refresh = () => setRevision(value => value + 1);
  const close = () => { setEditor(null); action.setError(''); };
  const update = changes => { setEditor(previous => ({ ...previous, ...changes })); action.setError(''); };
  const notices = action.error && <p className="form-error" role="alert">{action.error}</p>;
  return <div className="bom-page process-page">
    <PageHeading title={t('production.postProcessingTables')} description={t('production.postProcessingTablesHint')}>
      <Button icon={ArrowLeft} disabled={action.busy} onClick={editor ? close : onBack}>{t('route.back')}</Button>
      {!editor && <Button kind="primary" icon={Plus} disabled={action.busy} onClick={() => update({ name: '', note: '', enabled: 1, operations: [] })}>{t('production.newPostProcessingTable')}</Button>}
    </PageHeading>
    {notices}
    {editor ? <>
      <section className="panel bom-section post-processing-table-fields">
        <label>{t('production.postProcessingTableName')}
          <Input aria-label={t('production.postProcessingTableName')} maxLength={100} value={editor.name} disabled={action.busy} onChange={event => update({ name: event.target.value })} />
        </label>
        <label>{t('production.postProcessingTableNote')}
          <Input.TextArea aria-label={t('production.postProcessingTableNote')} rows={2} maxLength={500} value={editor.note ?? ''}
            disabled={action.busy} onChange={event => update({ note: event.target.value })} />
        </label>
      </section>
      <PostProcessingPlan rows={editor.operations} onChange={operations => update({ operations })} data={data} disabled={action.busy} />
      <div className="bom-editor-actions"><Button kind="primary" busy={action.busy} disabled={!editor.name.trim() || !editor.operations.length}
        onClick={() => action.run(async () => {
          const operations = editor.operations.map(row => ({ route_id: row.route_id, route_version: row.route_version, node_id: row.node_id,
            price_table_id: row.price_table_id ?? null, product_coefficient: parseQuantity(row.product_coefficient, true),
            materials: (row.materials ?? []).map(material => {
              let quantity;
              try { quantity = parseQuantity(material.quantity, true); }
              catch { throw new Error(t('production.postProcessingMaterialInvalid', { name: material.name })); }
              if (material.unit_round_up && !Number.isInteger(quantity)) throw new Error(t('production.postProcessingMaterialWhole', { name: material.name }));
              return { product_id: material.product_id, quantity, note: material.note ?? '' };
            }) }));
          await action.send(editor.id ? `${path}/${editor.id}` : path, { name: editor.name, note: editor.note, enabled: editor.enabled, version: editor.version, operations }, options);
          close(); refresh();
        })}>{t('production.savePostProcessingTable')}</Button></div>
    </> : <section className="panel bom-section">
      <TableList key={revision} data={data} manage render={table => <article key={table.id} className="post-processing-table-row">
        <div className="post-processing-name">
          <strong>{table.name}</strong>
          <small>{t('route.operations')} {table.operation_count}</small>
          {table.note && <small className="post-processing-table-note">{table.note}</small>}
        </div>
        <Badge tone={table.enabled ? 'green' : 'gray'}>{t(table.enabled ? 'route.enabled' : 'route.disabled')}</Badge>
        <div className="bom-actions">
          <Button disabled={action.busy} onClick={() => action.run(async () => setEditor(await api(`${path}/${table.id}`, options)))}>{t('production.editPostProcessingTable')}</Button>
          <Button disabled={action.busy} onClick={() => action.run(async () => {
            await action.send(`${path}/${table.id}/status`, { version: table.version, enabled: table.enabled ? 0 : 1 }, options); refresh();
          })}>{t(table.enabled ? 'route.disabled' : 'route.enabled')}</Button>
          <Button kind="danger" icon={Trash2} disabled={action.busy} onClick={() => {
            if (window.confirm(t('production.deletePostProcessingTable', { name: table.name }))) action.run(async () => {
              await action.send(`${path}/${table.id}/delete`, { version: table.version }, options); refresh();
            });
          }}>{t('production.removePostProcessingTable')}</Button>
        </div>
      </article>} />
    </section>}
  </div>;
}
