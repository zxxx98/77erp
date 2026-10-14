import React from 'react';
import { Text, View } from 'react-native';
import { Product, ProductForm } from './model';
import { ProductImage } from './ProductImage';
import { Card, s } from './ui';

const fields: [keyof ProductForm, string][] = [
  ['name', '物料名称'], ['barcode', '物料条码'], ['category', '物料分类'],
  ['unit', '计量单位'], ['cost', '参考采购价'], ['price', '参考销售价'],
  ['threshold', '安全库存'], ['specification', '规格型号'], ['note', '物料备注'], ['image', '物料图片'],
];

export function ProductConflict({ form, latest }: { form: ProductForm; latest?: Product }) {
  return <Card>
    <Text style={s.subtitle}>物料信息有冲突</Text>
    <Text style={s.caption}>你的填写内容已保留。核对最新信息后，可选择使用最新信息重新编辑；这会替换当前表单并清空同步仓库选择。</Text>
    {!!latest && <>
      <Text style={s.subtitle}>最新物料信息</Text>
      {fields.map(([key, label]) => <View key={key}>
        <Text style={s.label}>{label}</Text>
        <Text style={s.caption}>当前填写：{key === 'image' ? '' : String(form[key] ?? '') || '未填写'}</Text>
        {key === 'image' && (form.image ? <ProductImage uri={form.image} label="当前填写的物料图片" style={{ width: 100, height: 100 }} /> : <Text style={s.caption}>未填写</Text>)}
        <Text style={s.caption}>最新信息：{key === 'image' ? '' : String(latest[key] ?? '') || '未填写'}</Text>
        {key === 'image' && (latest.image ? <ProductImage uri={latest.image} label="最新物料图片" style={{ width: 100, height: 100 }} /> : <Text style={s.caption}>未填写</Text>)}
      </View>)}
    </>}
  </Card>;
}
