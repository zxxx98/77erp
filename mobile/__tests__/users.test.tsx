import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PasswordEditor } from '../src/account';
import { MoreScreen, OrderDetail } from '../src/screens';
import { OrderEditor } from '../src/forms';
import { CommerceScreen } from '../src/commerce';
import { api } from '../src/native';
import { product, workspace } from './fixtures';

jest.mock('../src/native', () => ({ api: jest.fn(), getWarehouseId: jest.fn(() => 1), scanBarcode: jest.fn(), device: {} }));
const request = jest.mocked(api);
beforeEach(() => jest.clearAllMocks());

test('employee menu exposes templates and password change while hiding administration and stocktake', () => {
  render(<MoreScreen isAdmin={false} username="staff" server="https://erp.example.com" data={workspace} busy={false}
    settings={jest.fn()} stocktake={jest.fn()} commerce={jest.fn()} changeServer={jest.fn()} logout={jest.fn()} changePassword={jest.fn()} />);
  expect(screen.getByText('员工账号')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '单据模板' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '修改密码' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: '库存盘点' })).toBeNull();
  expect(screen.queryByRole('button', { name: '商户与仓库设置' })).toBeNull();
});

test('employee order details display the creator and never load financial or correction controls', () => {
  render(<OrderDetail isAdmin={false} order={{ id: 1, number: 'RK-001', type: 'in', partner: '供应商', total: 10, note: '',
    created_at: '2026-10-12T00:00:00Z', created_by_name: 'staff', items: [] }} onClose={jest.fn()} onSaved={jest.fn()} />);
  expect(screen.getByText('开单人：staff')).toBeOnTheScreen();
  expect(screen.queryByText('收付款记录')).toBeNull();
  expect(screen.queryByText('作废单据')).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

test('employee business screen loads templates without finance or contact management', async () => {
  request.mockResolvedValue([]);
  render(<CommerceScreen isAdmin={false} onClose={jest.fn()} onUse={jest.fn()} onRefresh={jest.fn()} />);
  await waitFor(() => expect(request).toHaveBeenCalledWith('/templates'));
  expect(screen.queryByRole('button', { name: '收付款' })).toBeNull();
  expect(screen.queryByRole('button', { name: '毛利' })).toBeNull();
});

test('password editor validates confirmation, changes password and invokes logout', async () => {
  const changed = jest.fn().mockResolvedValue(undefined);
  request.mockResolvedValue({ ok: true });
  render(<PasswordEditor onClose={jest.fn()} onChanged={changed} />);
  fireEvent.changeText(screen.getByLabelText('当前密码'), 'Original-password-123');
  fireEvent.changeText(screen.getByLabelText('新密码'), 'Changed-password-456');
  fireEvent.changeText(screen.getByLabelText('确认新密码'), 'different');
  fireEvent.press(screen.getByRole('button', { name: '确认修改密码' }));
  await screen.findByText('两次输入的密码不一致。');
  expect(request).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText('确认新密码'), 'Changed-password-456');
  fireEvent.press(screen.getByRole('button', { name: '确认修改密码' }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(request).toHaveBeenCalledWith('/auth/password', 'POST', { current_password: 'Original-password-123', password: 'Changed-password-456' });
});

test('native regular-order retry reuses its request identifier after a network failure', async () => {
  const saved = jest.fn();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.find(button => button.text === '确认提交')?.onPress?.(); });
  request.mockRejectedValueOnce(new Error('网络连接失败')).mockResolvedValueOnce({ number: 'RK-001' });
  render(<OrderEditor type="out" initialProduct={product} products={[product]} onClose={jest.fn()} onSaved={saved} />);
  fireEvent.press(screen.getByRole('button', { name: '确认出库' }));
  await screen.findByText('网络连接失败');
  fireEvent.press(screen.getByRole('button', { name: '确认出库' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  const orders = request.mock.calls.filter(([path]) => path === '/orders');
  expect(orders).toHaveLength(2);
  expect(orders[0]?.[2]).toEqual(orders[1]?.[2]);
  expect(orders[0]?.[2]).toHaveProperty('request_id', expect.any(String));
  alert.mockRestore();
});
