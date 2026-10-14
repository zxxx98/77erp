import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { OrderDetail } from '../src/screens';
import { Order } from '../src/model';
import { PermissionContext } from '../src/permissions';

test('order detail displays the persisted zero-cent return tail', () => {
  const order: Order = { id: 1, number: 'RETURN-1', type: 'in', kind: 'return', partner: '客户',
    note: '', total: 0, created_at: '2026-10-14T00:00:00Z', items: [{ product_id: 1,
      name: '尾差物料', barcode: 'TAIL-001', quantity: 0.5, price: 0.01, amount_cents: 0 }] };
  render(<PermissionContext.Provider value={{ role: 'employee', permissions: [] }}>
    <OrderDetail isAdmin={false} order={order} onClose={jest.fn()} onSaved={jest.fn()} />
  </PermissionContext.Provider>);
  // The total and the line amount must both be zero; the reference price remains 0.01.
  expect(screen.getAllByText('¥ 0.00')).toHaveLength(2);
  expect(screen.getByText('0.5 × ¥ 0.01')).toBeTruthy();
});
