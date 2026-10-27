// Single-group fields remain readable for historical orders and older clients.
const entries = value => typeof value === 'string' ? JSON.parse(value) : value || [];
export function productionAssignments(order) {
  const groups = [...entries(order.assigned_groups)];
  if (order.production_group_id && !groups.some(group => group.id === order.production_group_id))
    groups.unshift({ id: order.production_group_id, name: order.production_group_name });
  return { assigned_groups: groups, assigned_users: entries(order.assigned_users) };
}
export function isProductionAssignee(user, order) {
  const { assigned_groups, assigned_users } = productionAssignments(order);
  return !!user && (assigned_users.some(person => person.id === user.id) ||
    !!user.production_group_id && assigned_groups.some(group => group.id === user.production_group_id));
}
export function productionAssignmentNames(order) {
  const { assigned_groups, assigned_users } = productionAssignments(order);
  return [...assigned_groups, ...assigned_users].map(entry => entry.name).join('、');
}
