import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NotificationSettings } from '../src/NotificationSettings';
import { api } from '../src/native';
import { NotificationConfig } from '../../shared/notifications';

jest.mock('../src/native', () => ({ api: jest.fn() }));
const request = jest.mocked(api);

test('native notifications save selected types, protect unsaved edits and clear secret inputs', async () => {
  let config: NotificationConfig = { enabled: false, format: 'json', events: [], warehouse_ids: [], include_amounts: false, daily_time: '18:00', timezone: 'Asia/Shanghai', version: 1, has_url: false, has_secret: false, destination: '' };
  request.mockImplementation(async (path, method, body) => {
    if (path.endsWith('/deliveries')) return [];
    if (method === 'PUT') { const b = body as NotificationConfig; config = { ...config, enabled: b.enabled, events: b.events, version: 2, has_url: true, has_secret: true, destination: 'https://example.com' }; }
    return config;
  });
  const dirty = jest.fn(), busy = jest.fn();
  render(<NotificationSettings warehouses={[{ id: 1, name: '主仓库', created_at: '2026-10-14T00:00:00Z' }]} onDirty={dirty} onBusy={busy} />);
  expect(request).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: '打开通知设置' }));
  await screen.findByLabelText('Webhook 地址');
  fireEvent.press(screen.getByRole('checkbox', { name: '启用 Webhook 通知' }));
  fireEvent.press(screen.getByRole('checkbox', { name: '低库存预警' }));
  fireEvent.press(screen.getByRole('checkbox', { name: '采购入库' }));
  fireEvent.changeText(screen.getByLabelText('Webhook 地址'), 'https://example.com/hook?key=private');
  fireEvent.changeText(screen.getByLabelText('签名密钥（选填）'), 'private-signing-key');
  expect(screen.getByRole('button', { name: '发送测试通知' })).toBeDisabled();
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true));
  fireEvent.press(screen.getByRole('button', { name: '保存通知设置' }));
  await screen.findByText('通知设置已保存。');
  expect(request).toHaveBeenCalledWith('/settings/notifications', 'PUT', expect.objectContaining({ enabled: true, events: ['low_stock', 'purchase_in'], url: 'https://example.com/hook?key=private', secret: 'private-signing-key' }));
  expect(screen.getByLabelText('Webhook 地址')).toHaveProp('value', '');
  expect(screen.getByLabelText('签名密钥（选填）')).toHaveProp('value', '');
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
  expect(screen.getByRole('button', { name: '发送测试通知' })).toBeEnabled();
  fireEvent.press(screen.getByRole('button', { name: '发送测试通知' }));
  await screen.findByText('测试通知已加入发送队列，请查看发送记录。');
  expect(request).toHaveBeenCalledWith('/settings/notifications/test', 'POST', { version: 2 });
});
