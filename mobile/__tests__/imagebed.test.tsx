import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ImagebedSettings } from '../src/ImagebedSettings';
import { api, device, uploadProductImage } from '../src/native';

jest.mock('../src/native', () => ({ api: jest.fn(), device: { pickImage: jest.fn() }, uploadProductImage: jest.fn() }));
const config = { base_url: 'https://img.example.com', auth_type: 'token', upload_folder: '77erp/products', channel_name: '', has_secret: true };
beforeEach(() => { jest.clearAllMocks(); jest.mocked(api).mockResolvedValue(config); });

test('native settings load a masked configuration, preserve blank credentials and test uploads through native files', async () => {
  const busy = jest.fn(), dirty = jest.fn();
  render(<ImagebedSettings onBusy={busy} onDirty={dirty} />);
  await screen.findByLabelText('图床地址');
  expect(screen.getByLabelText('上传凭据')).toHaveProp('value', '');
  fireEvent.changeText(screen.getByLabelText('上传目录'), '77erp/new');
  fireEvent.press(screen.getByRole('button', { name: '保存图床配置' }));
  await screen.findByText('图床配置已保存。');
  expect(api).toHaveBeenCalledWith('/settings/imagebed', 'PUT', expect.objectContaining({ upload_folder: '77erp/new', secret: '' }));
  expect(dirty).toHaveBeenLastCalledWith(false);
  jest.mocked(device.pickImage).mockResolvedValue('file:///cache/77erp-product-test.jpg');
  jest.mocked(uploadProductImage).mockResolvedValue('https://img.example.com/file/test.jpg');
  fireEvent.press(screen.getByRole('button', { name: '选择图片测试上传' }));
  await screen.findByText('测试上传成功，图片已写入图床。');
  expect(uploadProductImage).toHaveBeenCalledWith('file:///cache/77erp-product-test.jpg');
  expect(screen.getByLabelText('图床测试图片')).toHaveProp('source', { uri: 'https://img.example.com/file/test.jpg' });
  expect(busy).toHaveBeenLastCalledWith(false);
});

test('native configuration failure keeps edits and credential text for retry', async () => {
  render(<ImagebedSettings onBusy={jest.fn()} onDirty={jest.fn()} />);
  await screen.findByLabelText('上传凭据');
  fireEvent.changeText(screen.getByLabelText('上传凭据'), 'replacement-token');
  jest.mocked(api).mockRejectedValueOnce(new Error('无法连接服务器。'));
  fireEvent.press(screen.getByRole('button', { name: '保存图床配置' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('无法连接服务器。'));
  expect(screen.getByLabelText('上传凭据')).toHaveProp('value', 'replacement-token');
  expect(screen.getByRole('button', { name: '保存图床配置' })).toBeEnabled();
});
