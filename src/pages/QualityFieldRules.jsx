import { useRef, useState } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Button, Badge } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { choiceModeOf, choiceUncheckText, qualityTypeLabels, qualityTypes, textLines } from '../../shared/quality-template.js';

export function RuleSection({title,children}) {
  return <section className="quality-rule-section" aria-label={title}><h3>{title}</h3>{children}</section>;
}
function textRuleSummary(field,emptyLabel='未启用') {
  const parts=[];
  if(field.parseLine&&field.parseLine!=='all')parts.push(`第 ${field.parseLine} 行`);
  const ignored=String(field.ignoreContent||'').split(/\r?\n/).filter(Boolean).length;
  if(ignored)parts.push(`忽略 ${ignored} 项`);
  if(['string','number'].includes(field.type)&&(field.regexPattern||field.regexReplacement))parts.push('正则替换');
  return parts.join(' · ')||emptyLabel;
}
export function TypeRules({field,onChange,uniqueKeyOwner,sourceTexts=[],allowUniqueKey=true,properties,children}) {
  const lineCount=Math.max(1,...sourceTexts.map(text=>textLines(text).length),Number(field.parseLine)||1);
  const hasTypeSettings=['number','date','single','multi','measurements'].includes(field.type);
  const specialCount=field.specialValues?.length||0,itemCount=field.itemRules?.length||0;
  const showItemRules=properties&&(field.type==='string'||itemCount>0);
  return <>
    <RuleSection title="基本信息">{children}
    <label>数据类型<Select aria-label="数据类型" disabled={!!field.itemRules?.length} value={field.type} onChange={e=>onChange({type:e.target.value,...(!['string','number'].includes(e.target.value)?{regexPattern:undefined,regexReplacement:undefined}:{}),...(e.target.value==='measurements'?{separator:'/'}:{})})}>{qualityTypes.filter(type=>allowUniqueKey||type!=='uniqueKey').map(type=><option key={type} value={type} disabled={type==='uniqueKey'&&!!uniqueKeyOwner&&uniqueKeyOwner.id!==field.id}>{qualityTypeLabels[type]}</option>)}</Select></label>
    {(field.type==='uniqueKey'||uniqueKeyOwner&&uniqueKeyOwner.id!==field.id)&&<p className="muted">{field.type==='uniqueKey'?'按文本读取，保留编号前导零；整个模板最多配置一个唯一 KEY。':`唯一 KEY 已配置为“${uniqueKeyOwner.name}”；请先将其改为其他类型或移除，再配置新的唯一 KEY。`}</p>}
    <label className="quality-check"><input type="checkbox" checked={!!field.required} onChange={e=>onChange({required:e.target.checked})}/>必填</label>
    </RuleSection>
    {hasTypeSettings&&<RuleSection title="类型设置">
    {field.type==='measurements'&&<label>测量值分隔符<input aria-label="测量值分隔符" maxLength={10} value={(field.separator??'/').replaceAll('\n','\\n')} onChange={e=>onChange({separator:e.target.value.replaceAll('\\n','\n')})}/><small>如 2065/2061/2060；先用忽略内容去除“实测值”等前缀。各值单位须一致。</small></label>}
    {['number','measurements'].includes(field.type)&&<label>单位<input value={field.unit||''} maxLength={30} onChange={e=>onChange({unit:e.target.value})}/></label>}
    {field.type==='date'&&<label>文本日期格式<Select value={field.dateFormat||'YYYY-MM-DD'} onChange={e=>onChange({dateFormat:e.target.value})}>{['YYYY-MM-DD','YYYY/MM/DD','YYYY年MM月DD日'].map(v=><option key={v}>{v}</option>)}</Select></label>}
    {['single','multi'].includes(field.type)&&<>
      <label>选项拆分方式<Select aria-label="选项拆分方式" value={choiceModeOf(field)} onChange={e=>onChange({choiceMode:e.target.value})}><option value="markers">按选项标记拆分</option><option value="separator">按指定分隔符拆分</option></Select></label>
      {choiceModeOf(field)==='markers'&&<label>标记位置<Select aria-label="标记位置" value={field.markerPosition||'before'} onChange={e=>onChange({markerPosition:e.target.value})}><option value="before">文字前（■合格 □拒收）</option><option value="after">文字后（合格■ 拒收□）</option></Select></label>}
      <label>勾选字符<input aria-label="勾选字符" value={field.checkChar||''} maxLength={10} onChange={e=>onChange({checkChar:e.target.value})}/><small>填写原文中的选中标记，支持自定义符号或文字，例如 ●、☑、★、[x]。</small></label>
      <label>未选中标记（每行一个）<textarea aria-label="未选中标记" value={choiceUncheckText(field)} rows={2} maxLength={500} onChange={e=>onChange({uncheckChars:e.target.value})}/><small>按原文填写，例如 ○、☐、☆、[ ]；仅识别这里配置的标记，可以留空。</small></label>
      {choiceModeOf(field)==='separator'?<label>选项分隔符<input aria-label="选项分隔符" value={(field.separator??'\n').replaceAll('\n','\\n')} maxLength={10} onChange={e=>onChange({separator:e.target.value.replaceAll('\\n','\n')})}/><small>严格按此字符拆分，换行填写 \n，空格也会保留；填写不匹配时不会改用标记拆分。</small></label>:<p className="muted">按勾选字符和未选中标记划分选项，不使用分隔符；同一行和换行排列均支持。</p>}
      <label>允许选项（每行一个）<textarea aria-label="允许选项（每行一个）" value={field.options||''} placeholder={'CNY\nUSD\nEUR'} rows={3} maxLength={2000} onChange={e=>onChange({options:e.target.value})}/><small>填写选项文字，也兼容带已配置标记的复制文本，解析结果不含标记。</small></label>
    </>}
    </RuleSection>}
    <details className="quality-rule-disclosure quality-text-rules"><summary><strong>内容处理</strong><span>{textRuleSummary(field)}</span></summary><div className="quality-rule-content">
    <label>解析行<Select aria-label="解析行" value={field.parseLine??'all'} onChange={e=>onChange({parseLine:e.target.value==='all'?'all':Number(e.target.value)})}><option value="all">所有行</option>{Array.from({length:lineCount},(_,i)=><option key={i+1} value={i+1}>第 {i+1} 行</option>)}</Select><small>选择单元格内部的文字行，非 Excel 行号；先取行，再过滤忽略内容。对象属性按样表各记录的最大文字行数提供选项。</small></label>
    <label>忽略内容（每行一条）<textarea aria-label="忽略内容" value={field.ignoreContent??''} rows={2} maxLength={2000} onChange={e=>onChange({ignoreContent:e.target.value})}/><small>按填写顺序删除所有完全相同的内容，区分大小写，不使用正则表达式；留空则不处理。</small></label>
    {['string','number'].includes(field.type)&&<fieldset className="quality-special-values"><legend>正则替换</legend>
      <label>正则表达式<input aria-label="正则表达式" value={field.regexPattern??''} maxLength={1000} placeholder="例如：[0-9]+" onChange={e=>onChange({regexPattern:e.target.value})}/></label>
      <label>替换内容<textarea aria-label="正则替换内容" value={field.regexReplacement??''} maxLength={2000} rows={2} onChange={e=>onChange({regexReplacement:e.target.value})}/></label>
      <small>先取行、删除忽略内容，再替换全部匹配项。表达式直接填写，不加 /…/g；两项都留空表示不启用，替换内容留空表示删除。支持 $1、$2 分组引用、$& 完整匹配和 $$ 美元符号。可用 (?i) 忽略大小写；不支持前后查找和表达式内的反向引用。</small>
    </fieldset>}
    </div></details>
    {(field.type!=='uniqueKey'||showItemRules)&&<details className="quality-rule-disclosure quality-advanced-rules"><summary><strong>特殊规则</strong><span>{[specialCount?`${specialCount} 条映射`:null,itemCount?`${itemCount} 条项目规则`:null].filter(Boolean).join(' · ')||'未配置'}</span></summary><div className="quality-rule-content">
    {field.type!=='uniqueKey'&&<fieldset className="quality-special-values"><legend>特殊值映射</legend><small>取行、忽略内容及正则替换之后，按完整文字匹配；不把空白或未勾选自动视为不适用。</small>
      {(field.specialValues||[]).map((rule,index)=><div className="quality-inline" key={index}><input aria-label="特殊值原文" value={rule.text} maxLength={200} onChange={e=>onChange({specialValues:field.specialValues.map((r,i)=>i===index?{...r,text:e.target.value}:r)})}/><Select aria-label="特殊值状态" value={rule.status} onChange={e=>onChange({specialValues:field.specialValues.map((r,i)=>i===index?{...r,status:e.target.value}:r)})}><option value="not_applicable">不适用</option><option value="missing">未填写</option></Select><Button onClick={()=>onChange({specialValues:field.specialValues.filter((_,i)=>i!==index)})}>删除映射</Button></div>)}
      <Button disabled={(field.specialValues||[]).length>=20} onClick={()=>onChange({specialValues:[...(field.specialValues||[]),{text:'',status:'not_applicable'}]})}>添加特殊值</Button>
    </fieldset>}
      {showItemRules&&<ItemRules property={field} properties={properties} onChange={onChange} sourceTexts={sourceTexts}/>}
    </div></details>}
  </>;
}
function ItemRules({property,properties,onChange,sourceTexts}) {
  const candidates=properties.filter(p=>p.id!==property.id&&['string','uniqueKey'].includes(p.type)&&!p.itemRules?.length);
  const rules=property.itemRules||[];
  return <section className="quality-item-rules" aria-label="按检验项目配置"><h4>按检验项目配置</h4><p className="muted">精确匹配其他属性经过取行、忽略内容和正则替换处理后的文字。未匹配时使用上面的默认字符串规则；测量列表本期可保留为字符串。</p>
    {rules.map((rule,index)=><details key={index}><summary>{rule.equals||'新项目规则'} · {qualityTypeLabels[rule.config.type]}</summary><div className="quality-item-rule-content">
      <label>匹配属性<Select aria-label="匹配属性" value={rule.matchPropertyId} onChange={e=>onChange({itemRules:rules.map(r=>({...r,matchPropertyId:e.target.value}))})}><option value="" disabled>请选择项目名称属性</option>{candidates.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>
      <label>项目文字<input aria-label="项目文字" maxLength={200} value={rule.equals} onChange={e=>onChange({itemRules:rules.map((r,i)=>i===index?{...r,equals:e.target.value}:r)})}/></label>
      <TypeRules field={rule.config} allowUniqueKey={false} sourceTexts={sourceTexts} onChange={change=>onChange({itemRules:rules.map((r,i)=>i===index?{...r,config:{...r.config,...change}}:r)})}/>
      <Button onClick={()=>onChange({itemRules:rules.filter((_,i)=>i!==index)})}>删除项目规则</Button></div>
    </details>)}
    <Button disabled={!candidates.length||rules.length>=100||property.type!=='string'} onClick={()=>onChange({itemRules:[...rules,{matchPropertyId:rules[0]?.matchPropertyId||candidates[0].id,equals:'',config:{type:'string'}}]})}>添加项目规则</Button>
    {property.type!=='string'&&<small>请先将默认数据类型设为字符串，再添加项目规则。</small>}
  </section>;
}

export function ObjectProperties({field,onChange,sourceTexts,uniqueKeyOwner}) {
  const [selectedId,setSelectedId]=useState(null);
  const property=field.properties.find(p=>p.id===selectedId),listRef=useRef(null),headingRef=useRef(null);
  const select=id=>{setSelectedId(id);requestAnimationFrame(()=>headingRef.current?.focus());};
  const back=()=>{setSelectedId(null);requestAnimationFrame(()=>listRef.current?.querySelector(`[data-property-id="${selectedId}"]`)?.focus());};
  const update=change=>onChange({properties:field.properties.map(p=>p.id===selectedId?{...p,...change}:p)});
  return <section className="quality-object-properties" aria-label="对象属性编辑">
    {!property?<><h3>对象属性（{field.properties.length}）</h3><p className="muted">选择一个属性进行编辑。属性修改保留在当前字段草稿，最后点击“完成配置”。</p>
      <div className="quality-property-list" ref={listRef}>{field.properties.map(p=><button key={p.id} type="button" className="quality-property-item" data-property-id={p.id} onClick={()=>select(p.id)}>
        <span><strong>{p.name||'未命名属性'}</strong><small>{p.headerCell} · {textRuleSummary(p,'无内容处理')}{p.specialValues?.length?` · ${p.specialValues.length} 条映射`:''}{p.itemRules?.length?` · ${p.itemRules.length} 条项目规则`:''}</small></span>
        <span className="quality-property-status"><Badge tone="blue">{qualityTypeLabels[p.type]}</Badge>{p.required&&<Badge tone="orange">必填</Badge>}<ChevronRight size={16} aria-hidden="true"/></span>
      </button>)}</div></>:<>
      <div className="quality-property-heading"><Button icon={ArrowLeft} onClick={back}>返回属性列表</Button><h3 ref={headingRef} tabIndex={-1}>{property.name||'未命名属性'}</h3><small>{property.headerCell} · {qualityTypeLabels[property.type]}</small></div>
      <div className="quality-property-settings" key={property.id}>
        <TypeRules field={property} sourceTexts={sourceTexts[property.id]} uniqueKeyOwner={uniqueKeyOwner} properties={field.properties} onChange={update}>
          <label>属性名称<input aria-label="属性名称" value={property.name} maxLength={60} onChange={e=>update({name:e.target.value})}/></label>
          {property.headerPath&&<p className="quality-header-path">原始表头：{property.headerPath.map(node=>`${node.text||'（空白）'}（${node.region}）`).join(' → ')}</p>}
        </TypeRules>
      </div>
    </>}
  </section>;
}
