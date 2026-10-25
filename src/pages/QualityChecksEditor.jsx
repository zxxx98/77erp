import { checkLabels } from '../i18n/production-display.js';
import { t as pt } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { ConfigProvider as AntConfigProvider } from 'antd';
import { Input as AntInput, Checkbox as AntCheckbox } from '../ui/controls.jsx';

import { Button } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';

import { qualityUid } from './quality-shared.jsx';
const bound=()=>({name:pt("production.sample"),min:null,max:null,minInclusive:true,maxInclusive:true});
function Reference({label,value,onChange,fields,objectOnly=false,scalarOnly=false}){
  useLocale();
  const options=fields.flatMap(field=>field.type==='object'?scalarOnly?[]:field.properties.map(p=>({label:`${field.name} / ${p.name}`,value:{fieldId:field.id,propertyId:p.id}})):objectOnly?[]:[{label:field.name,value:{fieldId:field.id}}]);
  const key=ref=>JSON.stringify([ref?.fieldId,ref?.propertyId]);
  const object=fields.find(f=>f.id===value?.fieldId&&f.type==='object');
  return <div className="quality-check-reference"><label>{label}<Select aria-label={label} value={key(value)} onChange={e=>onChange(options.find(o=>key(o.value)===e)?.value||{})}><option value={key(null)} disabled>{pt("production.selectAField")}</option>{options.map(o=><option key={key(o.value)} value={key(o.value)}>{o.label}</option>)}</Select></label>
    {object&&<><label>{pt("production.matchItemPropertyOptional")}<Select aria-label={pt("production.matchingProperty", { v0: label })} value={value.match?.propertyId||''} onChange={e=>onChange({...value,match:e?{propertyId:e,equals:value.match?.equals||''}:undefined})}><option value="">{pt("production.allDetailsSameDetailRow")}</option>{object.properties.filter(p=>['string','uniqueKey'].includes(p.type)&&!p.itemRules?.length).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>{value.match&&<label>{pt("production.itemMatchingText")}<AntInput aria-label={pt("production.itemText", { v0: label })} maxLength={200} value={value.match.equals} onChange={e=>onChange({...value,match:{...value.match,equals:e.target.value}})}/></label>}</>}
  </div>;
}
export function QualityChecksEditor({definition,onChange,disabled}){
  useLocale();
  const rules=definition.checks||[],fields=definition.fields;
  const update=(index,change)=>onChange({...definition,checks:rules.map((r,i)=>i===index?{...r,...change}:r)});
  const initial=kind=>kind==='range'?{source:{},mode:'samples',bounds:[bound()]}:kind==='sum'?{source:{},targets:[{}],emptyPolicy:'review'}:kind==='acceptance'?{source:{},limits:{}}:{items:{},observed:{},final:{},passValues:['OK','合格','OK是'],failValues:['NG','拒收','不合格','NG否']};
  return <details className="panel quality-checks-editor"><summary>{pt("production.automaticCheckRules")}{rules.length}）</summary><p className="muted">{pt("production.checkResultsAreIndependentOfTheOriginalReport")}</p>
    <AntConfigProvider componentDisabled={disabled}><fieldset disabled={disabled}>
      {rules.map((rule,index)=><details key={rule.id} className="quality-check-rule"><summary>{rule.name||pt("production.newCheckRule")} · {checkLabels[rule.kind]}</summary>
        <label>{pt("production.ruleName")}<AntInput aria-label={pt("production.checkRuleName")} maxLength={60} value={rule.name} onChange={e=>update(index,{name:e.target.value})}/></label>
        <label>{pt("production.checkType")}<Select aria-label={pt("production.checkType")} value={rule.kind} onChange={e=>onChange({...definition,checks:rules.map((r,i)=>i===index?{id:r.id,name:r.name,kind:e,...initial(e)}:r)})}>{Object.entries(checkLabels).map(([id,name])=><option key={id} value={id}>{name}</option>)}</Select></label>
        {['range','sum','acceptance'].includes(rule.kind)&&<Reference label={pt("production.checkSource")} value={rule.source} fields={fields} objectOnly={rule.kind==='sum'} onChange={source=>update(index,{source})}/>}
        {rule.kind==='range'&&<>
          <label>{pt("production.measurementMeaning")}<Select aria-label={pt("production.measurementMeaning")} value={rule.mode} onChange={e=>update(index,{mode:e,bounds:e==='samples'?[rule.bounds[0]]:rule.bounds})}><option value="samples">{pt("production.repeatedMeasurementsOfOneItemSharedLimits")}</option><option value="components">{pt("production.differentPartsSeparateLimitsInOrder")}</option></Select></label>
          {rule.bounds.map((b,i)=><div className="quality-check-bound" key={i}>
            <label>{pt("production.samplePartName")}<AntInput aria-label={pt("production.measurementName")} value={b.name} maxLength={60} onChange={e=>update(index,{bounds:rule.bounds.map((v,j)=>i===j?{...v,name:e.target.value}:v)})}/></label>
            {['min','max'].map(key=><div className="quality-limit-field" key={key}>{key==='min'?pt("production.lowerLimit"):pt("production.upperLimit")}{pt("production.blankMeansUnlimited")}<AntInput aria-label={key==='min'?pt("production.measurementLowerLimit"):pt("production.measurementUpperLimit")} type="number" step="any" value={b[key]??''} onChange={e=>update(index,{bounds:rule.bounds.map((v,j)=>i===j?{...v,[key]:e.target.value===''?null:Number(e.target.value)}:v)})}/><span><AntCheckbox  checked={b[`${key}Inclusive`]!==false} onChange={e=>update(index,{bounds:rule.bounds.map((v,j)=>i===j?{...v,[`${key}Inclusive`]:e.target.checked}:v)})}>{pt("production.includeBoundaryValue")}</AntCheckbox></span></div>)}
            {rule.mode==='components'&&<Button disabled={rule.bounds.length===1} onClick={()=>update(index,{bounds:rule.bounds.filter((_,j)=>i!==j)})}>{pt("production.removePart")}</Button>}
          </div>)}
          {rule.mode==='components'&&<Button disabled={rule.bounds.length>=100} onClick={()=>update(index,{bounds:[...rule.bounds,{...bound(),name:pt("production.part", { v0: rule.bounds.length+1 })}]})}>{pt("production.addPart")}</Button>}
          <AntCheckbox className="quality-check" checked={!!rule.requirement} onChange={e=>update(index,{requirement:e.target.checked?{source:{},expected:''}:undefined})}>{pt("production.bindOriginalInspectionRequirementsAndFlagChangesFor")}</AntCheckbox>
          {rule.requirement&&<><Reference label={pt("production.inspectionRequirementSource")} value={rule.requirement.source} fields={fields} onChange={source=>update(index,{requirement:{...rule.requirement,source}})}/><label>{pt("production.inspectionRequirementsAtConfiguration")}<AntInput.TextArea aria-label={pt("production.inspectionRequirementsAtConfiguration")} maxLength={10000} value={rule.requirement.expected} onChange={e=>update(index,{requirement:{...rule.requirement,expected:e.target.value}})}/></label></>}
        </>}
        {rule.kind==='sum'&&<><label>{pt("production.blankDefectCount")}<Select aria-label={pt("production.blankDefectCount")} value={rule.emptyPolicy} onChange={e=>update(index,{emptyPolicy:e})}><option value="review">{pt("production.requestManualReview")}</option><option value="zero">{pt("production.explicitlyCountAs0")}</option></Select></label><p className="muted">{pt("production.explicitlyNotApplicableValuesAreExcludedValuesMapped")}</p>{rule.targets.map((target,i)=><div key={i}><Reference label={pt("production.sumTarget", { v0: i+1 })} scalarOnly value={target} fields={fields} onChange={value=>update(index,{targets:rule.targets.map((t,j)=>i===j?value:t)})}/><Button disabled={rule.targets.length===1} onClick={()=>update(index,{targets:rule.targets.filter((_,j)=>i!==j)})}>{pt("production.removeSumTarget")}</Button></div>)}<Button disabled={rule.targets.length>=5} onClick={()=>update(index,{targets:[...rule.targets,{}]})}>{pt("production.addSumTarget")}</Button></>}
        {rule.kind==='acceptance'&&<Reference label={pt("production.acceptanceRejectionCountSource")} value={rule.limits} fields={fields} onChange={limits=>update(index,{limits})}/>}
        {rule.kind==='decision'&&<><Reference label={pt("production.individualDecision")} objectOnly value={rule.items} fields={fields} onChange={items=>update(index,{items})}/><Reference label={pt("production.inspectionResult")} objectOnly value={rule.observed} fields={fields} onChange={observed=>update(index,{observed})}/><Reference label={pt("production.finalReportDecision")} scalarOnly value={rule.final} fields={fields} onChange={final=>update(index,{final})}/>{['passValues','failValues'].map(key=><label key={key}>{key==='passValues'?pt("production.passText"):pt("production.failText")}{pt("production.onePerLine")}<AntInput.TextArea value={rule[key].join('\n')} onChange={e=>update(index,{[key]:e.target.value.split('\n')})}/></label>)}</>}
        <Button onClick={()=>onChange({...definition,checks:rules.filter((_,i)=>i!==index)})}>{pt("production.removeCheckRule")}</Button>
      </details>)}
      <Button disabled={rules.length>=100} onClick={()=>onChange({...definition,checks:[...rules,{id:qualityUid(),name:'',kind:'range',...initial('range')}]})}>{pt("production.addCheckRule")}</Button>
    </fieldset></AntConfigProvider>
  </details>;
}
