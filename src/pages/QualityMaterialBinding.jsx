import { useState } from 'react';
import { Button, Modal } from '../components/common.jsx';
import { queryPath, useQuery } from '../queries.js';

const reasons = {
  matched: '已按唯一 KEY 精确匹配物料。',
  missing_key: '模板未配置唯一 KEY，请手动选择物料。',
  empty_key: '未解析到唯一 KEY 的值，请手动选择物料。',
  invalid_key: '唯一 KEY 解析有误，请修正文件或手动选择物料。',
  multiple_keys: '唯一 KEY 属性包含多个不同值，请手动选择整个 Sheet 对应的物料。',
  ambiguous: '唯一 KEY 命中多个物料，请核对后手动选择。',
  not_found: '未找到编码、名称或客户料号与唯一 KEY 相同的物料，请手动选择。',
};

export function MaterialPicker({data,sheetName,onChoose,onClose,title='选择绑定物料',subtitle}) {
  const [query,setQuery]=useState(''),[offset,setOffset]=useState(0);
  const search=useQuery(queryPath('/quality/products',{q:query,offset}),data,200);
  return <Modal title={title} subtitle={subtitle||`工作表：${sheetName} · 当前仓库已启用物料`} wide onClose={onClose}>
    <div className="form-body quality-material-picker">
      <label>搜索物料<input autoFocus aria-label="搜索绑定物料" maxLength={100} placeholder="输入物料编码、名称、规格或客户料号" value={query} onChange={e=>{setQuery(e.target.value);setOffset(0);}}/></label>
      {search.error&&<div className="form-error" role="alert">{search.error}<Button onClick={search.retry}>重试</Button></div>}
      {search.loading?<p role="status">正在查找物料…</p>:<>
        <div className="quality-preview-table"><table><thead><tr><th>物料编码</th><th>物料名称</th><th>规格</th><th>单位</th><th>操作</th></tr></thead><tbody>{search.result?.products.map(product=><tr key={product.id}>
          <td>{product.barcode}</td><td>{product.name}</td><td>{product.specification||'—'}</td><td>{product.unit}</td><td><Button onClick={()=>onChoose(product)}>选择此物料</Button></td>
        </tr>)}</tbody></table></div>
        {!search.result?.products.length&&<p className="muted">未找到物料，请更换关键词。</p>}
        {!!search.result?.total&&<div className="quality-toolbar"><Button disabled={!offset} onClick={()=>setOffset(value=>value-20)}>上一页</Button><span>{offset+1}–{Math.min(offset+20,search.result.total)} / {search.result.total}</span><Button disabled={offset+20>=search.result.total} onClick={()=>setOffset(value=>value+20)}>下一页</Button></div>}
      </>}
    </div><div className="modal-footer"><Button onClick={onClose}>取消选择</Button></div>
  </Modal>;
}

export function QualityMaterialBinding({binding,sheetName,data,onChange,busy=false,readOnly=false,compact=false,onPreview,issueCount=0,reviewNeeded=false}) {
  const [picking,setPicking]=useState(false);
  const enabled=readOnly?!!binding?.product:!!binding?.enabled;
  if(compact)return <section className="quality-sheet-summary" aria-label={`物料绑定 ${sheetName}`}>
    <div className="quality-sheet-summary-name"><strong>{sheetName}</strong><small className={issueCount||reviewNeeded?'quality-binding-pending':'muted'}>{issueCount?`${issueCount} 处解析问题`:reviewNeeded?'系统核对有待确认项':'解析通过'}</small></div>
    <div className="quality-sheet-summary-material">{enabled?(binding?.product?<><strong>{binding.product.name} · {binding.product.barcode}</strong><small className="muted">{binding.product.specification||''} · {binding.mode==='auto'?'自动匹配':'手动选择'}</small></>:<><span className="quality-binding-pending">尚未选择物料</span><small className="muted">{reasons[binding?.status]}</small></>):<span className="muted">此 Sheet 不绑定物料。</span>}</div>
    <div className="quality-sheet-summary-actions"><label className="quality-check"><input type="checkbox" aria-label={`绑定物料 ${sheetName}`} disabled={busy} checked={enabled} onChange={e=>onChange({...binding,enabled:e.target.checked})}/>绑定物料</label><Button disabled={busy} onClick={()=>setPicking(true)}>{binding?.product&&enabled?'更换绑定物料':'手动选择物料'}</Button><Button disabled={busy} onClick={onPreview}>查看解析结果</Button></div>
    {picking&&<MaterialPicker data={data} sheetName={sheetName} onClose={()=>setPicking(false)} onChoose={product=>{onChange({...binding,enabled:true,mode:'manual',product_id:product.id,product});setPicking(false);}}/>}
  </section>;
  return <section className="panel quality-material-binding" aria-label={`物料绑定 ${sheetName}`}>
    <div className="quality-material-binding-heading"><h3>绑定物料</h3>{!readOnly&&<label className="quality-check"><input type="checkbox" aria-label={`绑定物料 ${sheetName}`} disabled={busy} checked={enabled} onChange={e=>onChange({...binding,enabled:e.target.checked})}/>将此 Sheet 与物料绑定</label>}</div>
    {binding?.keyValue&&<p className="muted">唯一 KEY：<strong>{binding.keyValue}</strong></p>}
    {enabled?<>
      {binding.product?<div className="quality-bound-material"><strong>{binding.product.name}</strong><span>{binding.product.barcode}</span><span className="muted">{binding.product.specification||'—'} · {binding.product.unit}</span><span className="muted">{binding.mode==='auto'?'自动匹配':'手动选择'}</span></div>:<p className="quality-binding-pending">尚未选择物料</p>}
      {!readOnly&&<div className="quality-material-binding-action"><p className="muted">{binding.mode==='manual'&&binding.product?'已手动选择物料，可继续更换。':reasons[binding.status]}</p><Button disabled={busy} onClick={()=>setPicking(true)}>{binding.product?'更换绑定物料':'手动选择物料'}</Button></div>}
    </>:<p className="muted">此 Sheet 不绑定物料。</p>}
    {picking&&<MaterialPicker data={data} sheetName={sheetName} onClose={()=>setPicking(false)} onChoose={product=>{onChange({...binding,enabled:true,mode:'manual',product_id:product.id,product});setPicking(false);}}/>}
  </section>;
}
