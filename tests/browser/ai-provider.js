// Deterministic provider at the network boundary; production never imports this fixture.
export async function aiFetch(url, options) {
  if (url !== 'https://ai.77erp.test/v1/chat/completions') throw new Error('Unexpected AI destination');
  const { messages } = JSON.parse(options.body), last = messages.at(-1);
  let message = { content: '连接成功。' };
  if (last.role === 'tool') message = { content: '已生成预览，请核对后确认。' };
  else if (/^(调拨|盘点)参数：/.test(last.content)) {
    const name = last.content.startsWith('调拨') ? 'preview_transfer' : 'preview_stocktake';
    message = { content: null, tool_calls: [{ id: name, type: 'function', function: { name, arguments: last.content.split('参数：')[1] } }] };
  }
  else if (last.content === '展示表格测试') message = { content: '查询结果：\n\n| 物料名称 | 当前库存 |\n| --- | --- |\n| 不锈钢螺丝 | 24 个 |\n\n<script>window.alert(1)</script>' };
  else if (last.content.includes('导入上传表')) {
    const warehouse_id = Number(/当前仓库编号(\d+)/.exec(messages[0].content)?.[1]);
    message = { content: null, tool_calls: [{ id: 'excel-mapping', type: 'function', function: { name: 'preview_import', arguments: JSON.stringify({ warehouse_id, mapping: { name: 0, barcode: 1, category: 2, unit: 3, cost: 4, price: 5, threshold: 6, stock: 7 } }) } }] };
  }
  return new Response(JSON.stringify({ choices: [{ message }] }));
}
