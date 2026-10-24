import { ConfigProvider as AntConfigProvider, Input as AntInput, Checkbox as AntCheckbox } from 'antd';

import { Button } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { checkLabels } from '../../shared/quality-checks.js';
import { qualityUid } from './quality-shared.jsx';
const bound=()=>({name:'样本',min:null,max:null,minInclusive:true,maxInclusive:true});
function Reference({label,value,onChange,fields,objectOnly=false,scalarOnly=false}){
  const options=fields.flatMap(field=>field.type==='object'?scalarOnly?[]:field.properties.map(p=>({label:`${field.name} / ${p.name}`,value:{fieldId:field.id,propertyId:p.id}})):objectOnly?[]:[{label:field.name,value:{fieldId:field.id}}]);
  const key=ref=>JSON.stringify([ref?.fieldId,ref?.propertyId]);
  const object=fields.find(f=>f.id===value?.fieldId&&f.type==='object');
  return <div className="quality-check-reference"><label>{label}<Select aria-label={label} value={key(value)} onChange={e=>onChange(options.find(o=>key(o.value)===e)?.value||{})}><option value={key(null)} disabled>请选择字段</option>{options.map(o=><option key={key(o.value)} value={key(o.value)}>{o.label}</option>)}</Select></label>
    {object&&<><label>匹配项目属性（可选）<Select aria-label={`${label} 匹配属性`} value={value.match?.propertyId||''} onChange={e=>onChange({...value,match:e?{propertyId:e,equals:value.match?.equals||''}:undefined})}><option value="">全部明细 / 同一条明细</option>{object.properties.filter(p=>['string','uniqueKey'].includes(p.type)&&!p.itemRules?.length).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>{value.match&&<label>项目匹配文字<AntInput aria-label={`${label} 项目文字`} maxLength={200} value={value.match.equals} onChange={e=>onChange({...value,match:{...value.match,equals:e.target.value}})}/></label>}</>}
  </div>;
}
export function QualityChecksEditor({definition,onChange,disabled}){
  const rules=definition.checks||[],fields=definition.fields;
  const update=(index,change)=>onChange({...definition,checks:rules.map((r,i)=>i===index?{...r,...change}:r)});
  const initial=kind=>kind==='range'?{source:{},mode:'samples',bounds:[bound()]}:kind==='sum'?{source:{},targets:[{}],emptyPolicy:'review'}:kind==='acceptance'?{source:{},limits:{}}:{items:{},observed:{},final:{},passValues:['OK','合格','OK是'],failValues:['NG','拒收','不合格','NG否']};
  return <details className="panel quality-checks-editor"><summary>自动核对规则（{rules.length}）</summary><p className="muted">核对结果独立于原报告；超限、差异和资料不足需要人工确认。公差按填写的数值执行，允收／拒收数直接读取报告，不自动推算抽样标准。</p>
    <AntConfigProvider componentDisabled={disabled}><fieldset disabled={disabled}>
      {rules.map((rule,index)=><details key={rule.id} className="quality-check-rule"><summary>{rule.name||'新核对规则'} · {checkLabels[rule.kind]}</summary>
        <label>规则名称<AntInput aria-label="核对规则名称" maxLength={60} value={rule.name} onChange={e=>update(index,{name:e.target.value})}/></label>
        <label>核对类型<Select aria-label="核对类型" value={rule.kind} onChange={e=>onChange({...definition,checks:rules.map((r,i)=>i===index?{id:r.id,name:r.name,kind:e,...initial(e)}:r)})}>{Object.entries(checkLabels).map(([id,name])=><option key={id} value={id}>{name}</option>)}</Select></label>
        {['range','sum','acceptance'].includes(rule.kind)&&<Reference label="核对来源" value={rule.source} fields={fields} objectOnly={rule.kind==='sum'} onChange={source=>update(index,{source})}/>}
        {rule.kind==='range'&&<>
          <label>测量含义<Select aria-label="测量含义" value={rule.mode} onChange={e=>update(index,{mode:e,bounds:e==='samples'?[rule.bounds[0]]:rule.bounds})}><option value="samples">同一项目多次测量，共用限值</option><option value="components">不同部位，按顺序分别设置限值</option></Select></label>
          {rule.bounds.map((b,i)=><div className="quality-check-bound" key={i}>
            <label>样本／部位名称<AntInput aria-label="测量名称" value={b.name} maxLength={60} onChange={e=>update(index,{bounds:rule.bounds.map((v,j)=>i===j?{...v,name:e.target.value}:v)})}/></label>
            {['min','max'].map(key=><div className="quality-limit-field" key={key}>{key==='min'?'下限':'上限'}（留空表示不限）<AntInput aria-label={key==='min'?'测量下限':'测量上限'} type="number" step="any" value={b[key]??''} onChange={e=>update(index,{bounds:rule.bounds.map((v,j)=>i===j?{...v,[key]:e.target.value===''?null:Number(e.target.value)}:v)})}/><span><AntCheckbox  checked={b[`${key}Inclusive`]!==false} onChange={e=>update(index,{bounds:rule.bounds.map((v,j)=>i===j?{...v,[`${key}Inclusive`]:e.target.checked}:v)})}>包含边界值</AntCheckbox></span></div>)}
            {rule.mode==='components'&&<Button disabled={rule.bounds.length===1} onClick={()=>update(index,{bounds:rule.bounds.filter((_,j)=>i!==j)})}>删除部位</Button>}
          </div>)}
          {rule.mode==='components'&&<Button disabled={rule.bounds.length>=100} onClick={()=>update(index,{bounds:[...rule.bounds,{...bound(),name:`部位 ${rule.bounds.length+1}`}]})}>添加部位</Button>}
          <AntCheckbox className="quality-check" checked={!!rule.requirement} onChange={e=>update(index,{requirement:e.target.checked?{source:{},expected:''}:undefined})}>绑定原检验要求，变化时提示复核</AntCheckbox>
          {rule.requirement&&<><Reference label="检验要求来源" value={rule.requirement.source} fields={fields} onChange={source=>update(index,{requirement:{...rule.requirement,source}})}/><label>配置时的检验要求<AntInput.TextArea aria-label="配置时的检验要求" maxLength={10000} value={rule.requirement.expected} onChange={e=>update(index,{requirement:{...rule.requirement,expected:e.target.value}})}/></label></>}
        </>}
        {rule.kind==='sum'&&<><label>空白缺陷数<Select aria-label="空白缺陷数" value={rule.emptyPolicy} onChange={e=>update(index,{emptyPolicy:e})}><option value="review">提示人工核对</option><option value="zero">明确按 0 计入</option></Select></label><p className="muted">明确标为不适用的值排除；映射为未填写的值始终提示核对。</p>{rule.targets.map((target,i)=><div key={i}><Reference label={`合计目标 ${i+1}`} scalarOnly value={target} fields={fields} onChange={value=>update(index,{targets:rule.targets.map((t,j)=>i===j?value:t)})}/><Button disabled={rule.targets.length===1} onClick={()=>update(index,{targets:rule.targets.filter((_,j)=>i!==j)})}>删除合计目标</Button></div>)}<Button disabled={rule.targets.length>=5} onClick={()=>update(index,{targets:[...rule.targets,{}]})}>添加合计目标</Button></>}
        {rule.kind==='acceptance'&&<Reference label="允收／拒收数来源" value={rule.limits} fields={fields} onChange={limits=>update(index,{limits})}/>}
        {rule.kind==='decision'&&<><Reference label="单项判定" objectOnly value={rule.items} fields={fields} onChange={items=>update(index,{items})}/><Reference label="检验结果" objectOnly value={rule.observed} fields={fields} onChange={observed=>update(index,{observed})}/><Reference label="报告最终判定" scalarOnly value={rule.final} fields={fields} onChange={final=>update(index,{final})}/>{['passValues','failValues'].map(key=><label key={key}>{key==='passValues'?'合格文字':'不合格文字'}（每行一个）<AntInput.TextArea value={rule[key].join('\n')} onChange={e=>update(index,{[key]:e.target.value.split('\n')})}/></label>)}</>}
        <Button onClick={()=>onChange({...definition,checks:rules.filter((_,i)=>i!==index)})}>删除核对规则</Button>
      </details>)}
      <Button disabled={rules.length>=100} onClick={()=>onChange({...definition,checks:[...rules,{id:qualityUid(),name:'',kind:'range',...initial('range')}]})}>添加核对规则</Button>
    </fieldset></AntConfigProvider>
  </details>;
}
