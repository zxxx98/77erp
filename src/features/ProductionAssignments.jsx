import { useEffect, useState } from 'react';
import { Check, ChevronDown, Users } from 'lucide-react';
import { api } from '../api.js';
import { Button } from '../components/common.jsx';
import { Checkbox } from '../ui/controls.jsx';
import { productionAssignments } from '../../shared/production-assignment.js';
import { t } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';

export function ProductionAssignments({ order, busy, onSave }) {
  useLocale();
  const current = productionAssignments(order);
  const [groups, setGroups] = useState(null), [users, setUsers] = useState(null), [error, setError] = useState('');
  const [groupIds, setGroupIds] = useState(current.assigned_groups.map(group => group.id));
  const [userIds, setUserIds] = useState(current.assigned_users.map(user => user.id));
  const started = order.status !== 'draft' || !!order.completed_at || !!order.batches?.length || !!order.material_documents?.length || !!order.receipt_documents?.length || order.operation_routes?.some(route => route.report_count);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([api('/production-groups', { signal: controller.signal }), api('/production-orders/assignment-options', { signal: controller.signal })])
      .then(([groups, options]) => { setGroups(groups); setUsers(options.users); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);
  const toggle = (setter, id, checked) => setter(ids => checked ? [...ids, id] : ids.filter(value => value !== id));
  const options = (available, selected) => [...(available || []), ...selected.filter(entry => !available?.some(value => value.id === entry.id))];
  const groupList = options(groups, current.assigned_groups);
  const userList = options(users, current.assigned_users);
  const totalSelected = groupIds.length + userIds.length;
  return <details className="production-assignment-editor">
    <summary className="production-assignment-summary">
      <span className="production-assignment-summary-main">
        <span className="production-assignment-summary-icon" aria-hidden="true"><Users size={15} /></span>
        <span className="production-assignment-summary-title">{t('production.manageAssignments')}</span>
      </span>
      <span className="production-assignment-summary-meta" aria-hidden="true">
        {totalSelected > 0 && <span className="production-assignment-count-pill">{totalSelected}</span>}
        <ChevronDown size={16} className="production-assignment-chevron" />
      </span>
    </summary>
    <div className="production-assignment-body">
      <p className={`bom-hint production-assignment-hint${started ? ' is-started' : ''}`}>{t(started ? 'production.appendAssignmentHint' : 'production.multipleAssignmentHint')}</p>
      {error && <p role="alert" className="bom-error">{error}</p>}
      <div className="production-assignment-options">
        <fieldset className="production-assignment-group" disabled={busy || !groups}>
          <div className="production-assignment-group-header">
            <legend>{t('production.assignProductionGroup')}</legend>
            <span className="production-assignment-group-badge" aria-hidden="true">{groupIds.length}/{groupList.length}</span>
          </div>
          <div className="production-assignment-list">
            {groupList.map(group => {
              const checked = groupIds.includes(group.id);
              const locked = started && current.assigned_groups.some(entry => entry.id === group.id);
              return <div key={group.id} className={`production-assignment-item${checked ? ' is-checked' : ''}${locked ? ' is-locked' : ''}`}>
                <Checkbox checked={checked} disabled={busy || !groups || locked}
                  onChange={event => toggle(setGroupIds, group.id, event.target.checked)}>{group.name}</Checkbox>
              </div>;
            })}
            {groups && !groupList.length && <span className="production-assignment-empty" aria-hidden="true">—</span>}
          </div>
        </fieldset>
        <fieldset className="production-assignment-group" disabled={busy || !users}>
          <div className="production-assignment-group-header">
            <legend>{t('production.assignProductionUsers')}</legend>
            <span className="production-assignment-group-badge" aria-hidden="true">{userIds.length}/{userList.length}</span>
          </div>
          <div className="production-assignment-list">
            {userList.map(user => {
              const checked = userIds.includes(user.id);
              const locked = started && current.assigned_users.some(entry => entry.id === user.id);
              return <div key={user.id} className={`production-assignment-item${checked ? ' is-checked' : ''}${locked ? ' is-locked' : ''}`}>
                <Checkbox checked={checked} disabled={busy || !users || locked}
                  onChange={event => toggle(setUserIds, user.id, event.target.checked)}>{user.name}</Checkbox>
              </div>;
            })}
            {users && !userList.length && <span className="production-assignment-empty" aria-hidden="true">—</span>}
          </div>
        </fieldset>
      </div>
      <div className="production-assignment-footer">
        <Button kind="primary" icon={Check} busy={busy} disabled={busy || !groups || !users || !!error}
          onClick={() => onSave({ production_group_ids: groupIds, user_ids: userIds })}>{t('production.assign')}</Button>
      </div>
    </div>
  </details>;
}
