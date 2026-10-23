import { calculateBomNodes, bomUsageLabels } from '../../shared/bom-expansion.js';
import { bomLossMethodLabels } from '../../shared/bom.js';
import { ChevronDown } from 'lucide-react';

const count = value => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 6 });

export function BomStructure({ nodes = [], quantity }) {
  if (!nodes.length) return null;
  let rows;
  try { rows = calculateBomNodes(nodes, Number(quantity)).nodes; }
  catch (error) { return <p className="bom-warning">{error.message}</p>; }
  const groups = new Map();
  for (const node of rows) groups.set(node.parent_path, [...(groups.get(node.parent_path) || []), node]);
  const branch = parentPath => <ol className="bom-structure-list">{(groups.get(parentPath) || []).map(node => {
    const heading = <><strong>{node.path} · {node.name}</strong><span>{bomUsageLabels[node.usage_mode]} · 需求 {count(node.required)} {node.unit}</span></>;
    const recipe = <small>来源：{node.bom_name} #{node.bom_id} · 修订 {node.bom_version} · 基准产量 {count(node.bom_base_quantity)} {node.bom_base_unit}<br />净用量 {node.quantity_fraction || count(node.quantity)} {node.unit} · 损耗 {count(node.loss_rate)}% · {bomLossMethodLabels[node.loss_method]}</small>;
    return <li key={node.path}>{node.usage_mode === 'explode' ? <details className="bom-disclosure"><summary><span className="bom-disclosure-copy">{heading}</span><ChevronDown className="bom-disclosure-chevron" size={18} aria-hidden="true" /></summary>{recipe}
      <small>指定下级配方 #{node.child_bom_id}；本单不领用、不入库此半成品。</small>{branch(node.path)}</details> : <div>{heading}{recipe}</div>}</li>;
  })}</ol>;
  return <details className="bom-structure bom-disclosure"><summary><span>结构与各层需求</span><ChevronDown className="bom-disclosure-chevron" size={18} aria-hidden="true" /></summary>
    <p className="bom-hint">按毛需求展开；中间半成品库存未抵扣。汇总按未舍入值计算，各路径显示值之和可能略大于汇总值。</p>
    {branch('')}
  </details>;
}
