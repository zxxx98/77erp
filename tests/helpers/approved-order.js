// Existing finance/history/correction fixtures need an actually posted order.
// Exercise both HTTP steps; dedicated order-approval tests cover the pending boundary.
export async function approveFixtureOrder(result, approve) {
  if (result.status !== 201 || result.data.status !== 'pending') return result;
  const posted = await approve(`/orders/${result.data.id}/approve`, {
    version: 1, request_id: `fixture-approval-${result.data.id}`,
  });
  return posted.status === 200 ? { ...result, data: { ...result.data, ...posted.data } } : posted;
}
