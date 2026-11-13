import assert from 'node:assert/strict';

// Existing lifecycle tests continue after inspecting and cancelling the newly
// supported shortage, so their later FIFO/correction assertions stay isolated.
export async function recordAndCancel(f, response) {
  const order = f.ok(response);
  assert.ok(['pending', 'unsettled'].includes(order.registration_status));
  const row = order.operation_registrations.filter(row => row.status === 'pending').sort((a,b) => b.id-a.id)[0];
  assert.ok(row.issues.length > 0);
  return f.ok(await f.command(`/production-orders/${order.id}/operations/registrations/${row.id}/cancel`, {
    schema_version: 2, stage_schema_version: 1, operation_schema_version: 1, version: order.version,
  }));
}
