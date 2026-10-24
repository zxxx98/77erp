import React from 'react';
import { ProductImage } from './ProductImage.jsx';

const fields = [
  ['name', '物料名称'], ['barcode', '物料条码'], ['category', '物料分类'],
  ['unit', '计量单位'], ['unit_round_up', '单位是否取整'], ['cost', '参考采购价'], ['price', '参考销售价'],
  ['threshold', '安全库存'], ['specification', '规格型号'], ['note', '物料备注'], ['image', '物料图片'],
  ['inspection_date', '校验日期'], ['inspection_interval', '校验周期'], ['inspection_unit', '周期单位'], ['last_inspected_on', '上次校验'],
];

export function ProductConflict({ form, latest }) {
  return <div className="product-conflict">
    <p>你的填写内容已保留。核对最新信息后，可选择使用最新信息重新编辑；这会替换当前表单并清空同步仓库选择。</p>
    {latest && <>
      <strong>最新物料信息</strong>
      <dl>{fields.map(([key, label]) => <div key={key}>
        <dt>{label}</dt>
        <dd><small>当前填写</small>{key === 'image' && form[key] ? <ProductImage src={form[key]} alt="当前填写的物料图片" /> : <span>{String(form[key] ?? '') || '未填写'}</span>}</dd>
        <dd><small>最新信息</small>{key === 'image' && latest[key] ? <ProductImage src={latest[key]} alt="最新物料图片" /> : <span>{String(latest[key] ?? '') || '未填写'}</span>}</dd>
      </div>)}</dl>
    </>}
  </div>;
}
