import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ProductImage } from '../src/ProductImage';
import { ProductEditor } from '../src/forms';
import { ProductRow } from '../src/ui';
import { categories, product } from './fixtures';

const image = 'data:image/jpeg;base64,/9j/';
jest.mock('../src/native', () => ({ api: jest.fn(), device: { pickImage: jest.fn() }, scanBarcode: jest.fn() }));

test('an image opens full screen, supports zoom controls and closes without changing its source', () => {
  render(<ProductImage uri={image} label="商品图片" style={{ width: 180, height: 180 }} />);
  const stopped = jest.fn();
  fireEvent.press(screen.getByRole('button', { name: '放大查看 商品图片' }), { stopPropagation: stopped });
  expect(stopped).toHaveBeenCalled();
  expect(screen.getByLabelText('商品图片 大图')).toHaveProp('source', { uri: image });
  expect(screen.getByRole('button', { name: '缩小图片' })).toBeDisabled();
  fireEvent.press(screen.getByRole('button', { name: '放大图片' }));
  expect(screen.getByLabelText('图片缩放比例')).toHaveTextContent('150%');
  for (let i = 0; i < 5; i++) fireEvent.press(screen.getByRole('button', { name: '放大图片' }));
  expect(screen.getByLabelText('图片缩放比例')).toHaveTextContent('400%');
  expect(screen.getByRole('button', { name: '放大图片' })).toBeDisabled();
  fireEvent.press(screen.getByRole('button', { name: '重置图片' }));
  expect(screen.getByLabelText('图片缩放比例')).toHaveTextContent('100%');
  fireEvent.press(screen.getByRole('button', { name: '关闭图片预览' }));
  expect(screen.queryByLabelText('商品图片 大图')).toBeNull();
  expect(screen.getByLabelText('商品图片')).toHaveProp('source', { uri: image });
});

test('previewing an unsaved image does not close the product editor or discard its changes', () => {
  const close = jest.fn();
  render(<ProductEditor product={{ ...product, image }} categories={categories} onClose={close} onSaved={jest.fn()} />);
  fireEvent.changeText(screen.getByLabelText('商品备注'), '未保存的备注');
  fireEvent.press(screen.getByRole('button', { name: '放大查看 商品图片预览' }), { stopPropagation: jest.fn() });
  expect(screen.getByLabelText('商品图片预览 大图')).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: '关闭图片预览' }));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByLabelText('商品备注')).toHaveProp('value', '未保存的备注');
  expect(screen.getByRole('button', { name: '保存商品' })).toBeOnTheScreen();
});

test('pressing a list thumbnail opens the image without opening the product row', () => {
  const openProduct = jest.fn(), stopped = jest.fn();
  render(<ProductRow product={{ ...product, image }} onPress={openProduct} />);
  fireEvent.press(screen.getByRole('button', { name: '放大查看 陶瓷杯' }), { stopPropagation: stopped });
  expect(stopped).toHaveBeenCalled();
  expect(openProduct).not.toHaveBeenCalled();
  expect(screen.getByLabelText('陶瓷杯 大图')).toBeOnTheScreen();
});
