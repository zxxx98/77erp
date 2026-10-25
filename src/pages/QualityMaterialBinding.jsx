import { t as pt } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { Input as AntInput, Checkbox as AntCheckbox } from '../ui/controls.jsx';

import { useState } from 'react';
import { Button, Modal } from '../components/common.jsx';
import { queryPath, useQuery } from '../queries.js';

const reasons = () => ({
  matched: pt("production.materialExactlyMatchedByUniqueKey"),
  missing_key: pt("production.templateHasNoUniqueKeySelectAMaterial"),
  empty_key: pt("production.noUniqueKeyValueFoundSelectAMaterial"),
  invalid_key: pt("production.uniqueKeyParseErrorCorrectTheFileOr"),
  multiple_keys: pt("production.uniqueKeyPropertyContainsDifferentValuesSelectThe"),
  ambiguous: pt("production.uniqueKeyMatchesMultipleMaterialsVerifyAndSelect"),
  not_found: pt("production.noMaterialCodeNameOrCustomerPartNumber"),
});

export function MaterialPicker({data,sheetName,onChoose,onClose,title=pt("production.selectBoundMaterial"),subtitle}) {
  useLocale();
  const [query,setQuery]=useState(''),[offset,setOffset]=useState(0);
  const search=useQuery(queryPath('/quality/products',{q:query,offset}),data,200);
  return <Modal title={title} subtitle={subtitle||pt("production.worksheetActiveMaterialsInCurrentWarehouse", { v0: sheetName })} wide onClose={onClose}>
    <div className="form-body quality-material-picker">
      <label>{pt("production.searchMaterials")}<AntInput autoFocus aria-label={pt("production.searchBindingMaterials")} maxLength={100} placeholder={pt("production.enterMaterialCodeNameSpecificationOrCustomerPart")} value={query} onChange={e=>{setQuery(e.target.value);setOffset(0);}}/></label>
      {search.error&&<div className="form-error" role="alert">{search.error}<Button onClick={search.retry}>{pt("production.retry")}</Button></div>}
      {search.loading?<p role="status">{pt("production.searchingMaterials")}</p>:<>
        <div className="quality-preview-table"><table><thead><tr><th>{pt("production.materialCode")}</th><th>{pt("production.materialName")}</th><th>{pt("production.specification")}</th><th>{pt("production.unit")}</th><th>{pt("production.actions")}</th></tr></thead><tbody>{search.result?.products.map(product=><tr key={product.id}>
          <td>{product.barcode}</td><td>{product.name}</td><td>{product.specification||'—'}</td><td>{product.unit}</td><td><Button onClick={()=>onChoose(product)}>{pt("production.selectThisMaterial")}</Button></td>
        </tr>)}</tbody></table></div>
        {!search.result?.products.length&&<p className="muted">{pt("production.noMaterialsFoundTryAnotherKeyword")}</p>}
        {!!search.result?.total&&<div className="quality-toolbar"><Button disabled={!offset} onClick={()=>setOffset(value=>value-20)}>{pt("production.previous")}</Button><span>{offset+1}–{Math.min(offset+20,search.result.total)} / {search.result.total}</span><Button disabled={offset+20>=search.result.total} onClick={()=>setOffset(value=>value+20)}>{pt("production.next")}</Button></div>}
      </>}
    </div><div className="modal-footer"><Button onClick={onClose}>{pt("production.clearSelection")}</Button></div>
  </Modal>;
}

export function QualityMaterialBinding({binding,sheetName,data,onChange,busy=false,readOnly=false,compact=false,onPreview,issueCount=0,reviewNeeded=false}) {
  useLocale();
  const [picking,setPicking]=useState(false);
  const enabled=readOnly?!!binding?.product:!!binding?.enabled;
  if(compact)return <section className="quality-sheet-summary" aria-label={pt("production.materialBinding", { v0: sheetName })}>
    <div className="quality-sheet-summary-name"><strong>{sheetName}</strong><small className={issueCount||reviewNeeded?'quality-binding-pending':'muted'}>{issueCount?pt("production.parseIssues2", { v0: issueCount }):reviewNeeded?pt("production.systemChecksRequireConfirmation"):pt("production.parsingPassed")}</small></div>
    <div className="quality-sheet-summary-material">{enabled?(binding?.product?<><strong>{binding.product.name} · {binding.product.barcode}</strong><small className="muted">{binding.product.specification||''} · {binding.mode==='auto'?pt("production.autoMatched"):pt("production.manuallySelected")}</small></>:<><span className="quality-binding-pending">{pt("production.noMaterialSelected")}</span><small className="muted">{reasons()[binding?.status]}</small></>):<span className="muted">{pt("production.thisSheetIsNotBoundToAMaterial")}</span>}</div>
    <div className="quality-sheet-summary-actions"><AntCheckbox className="quality-check" aria-label={pt("production.bindMaterial", { v0: sheetName })} disabled={busy} checked={enabled} onChange={e=>onChange({...binding,enabled:e.target.checked})}>{pt("production.bindMaterial2")}</AntCheckbox><Button disabled={busy} onClick={()=>setPicking(true)}>{binding?.product&&enabled?pt("production.changeBoundMaterial"):pt("production.selectMaterialManually")}</Button><Button disabled={busy} onClick={onPreview}>{pt("production.viewParseResults")}</Button></div>
    {picking&&<MaterialPicker data={data} sheetName={sheetName} onClose={()=>setPicking(false)} onChoose={product=>{onChange({...binding,enabled:true,mode:'manual',product_id:product.id,product});setPicking(false);}}/>}
  </section>;
  return <section className="panel quality-material-binding" aria-label={pt("production.materialBinding", { v0: sheetName })}>
    <div className="quality-material-binding-heading"><h3>{pt("production.bindMaterial2")}</h3>{!readOnly&&<AntCheckbox className="quality-check" aria-label={pt("production.bindMaterial", { v0: sheetName })} disabled={busy} checked={enabled} onChange={e=>onChange({...binding,enabled:e.target.checked})}>{pt("production.bindThisSheetToAMaterial")}</AntCheckbox>}</div>
    {binding?.keyValue&&<p className="muted">{pt("production.uniqueKey")}<strong>{binding.keyValue}</strong></p>}
    {enabled?<>
      {binding.product?<div className="quality-bound-material"><strong>{binding.product.name}</strong><span>{binding.product.barcode}</span><span className="muted">{binding.product.specification||'—'} · {binding.product.unit}</span><span className="muted">{binding.mode==='auto'?pt("production.autoMatched"):pt("production.manuallySelected")}</span></div>:<p className="quality-binding-pending">{pt("production.noMaterialSelected")}</p>}
      {!readOnly&&<div className="quality-material-binding-action"><p className="muted">{binding.mode==='manual'&&binding.product?pt("production.materialSelectedManuallyYouCanChangeIt"):reasons()[binding.status]}</p><Button disabled={busy} onClick={()=>setPicking(true)}>{binding.product?pt("production.changeBoundMaterial"):pt("production.selectMaterialManually")}</Button></div>}
    </>:<p className="muted">{pt("production.thisSheetIsNotBoundToAMaterial")}</p>}
    {picking&&<MaterialPicker data={data} sheetName={sheetName} onClose={()=>setPicking(false)} onChoose={product=>{onChange({...binding,enabled:true,mode:'manual',product_id:product.id,product});setPicking(false);}}/>}
  </section>;
}
