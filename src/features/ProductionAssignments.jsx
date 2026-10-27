import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Button } from '../components/common.jsx';
import { Checkbox } from '../ui/controls.jsx';
import { productionAssignments } from '../../shared/production-assignment.js';
import { t } from '../i18n/index.js';

export function ProductionAssignments({ order, busy, onSave }) {
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
  return <details className="production-assignment-editor">
    <summary>{t('production.manageAssignments')}</summary>
    <p className="bom-hint">{t(started ? 'production.appendAssignmentHint' : 'production.multipleAssignmentHint')}</p>
    {error && <p role="alert" className="bom-error">{error}</p>}
    <div className="production-assignment-options">
      <fieldset disabled={busy || !groups}><legend>{t('production.assignProductionGroup')}</legend>
        {options(groups, current.assigned_groups).map(group => <Checkbox key={group.id} checked={groupIds.includes(group.id)}
          disabled={busy || !groups || started && current.assigned_groups.some(entry => entry.id === group.id)}
          onChange={event => toggle(setGroupIds, group.id, event.target.checked)}>{group.name}</Checkbox>)}
      </fieldset>
      <fieldset disabled={busy || !users}><legend>{t('production.assignProductionUsers')}</legend>
        {options(users, current.assigned_users).map(user => <Checkbox key={user.id} checked={userIds.includes(user.id)}
          disabled={busy || !users || started && current.assigned_users.some(entry => entry.id === user.id)}
          onChange={event => toggle(setUserIds, user.id, event.target.checked)}>{user.name}</Checkbox>)}
      </fieldset>
    </div>
    <Button disabled={busy || !groups || !users || !!error} onClick={() => onSave({ production_group_ids: groupIds, user_ids: userIds })}>{t('production.assign')}</Button>
  </details>;
}
