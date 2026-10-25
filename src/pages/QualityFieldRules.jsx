import { qualityTypeLabels } from '../i18n/production-display.js';
import { t as pt } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { FormField } from './../ui/FormField.jsx';
import { Checkbox as AntCheckbox, Input as AntInput, Button as AntButton } from '../ui/controls.jsx';

import { useRef, useState } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Button, Badge } from '../components/common.jsx';
import { Select } from '../Dropdown.jsx';
import { choiceModeOf, choiceUncheckText, objectOrientation, qualityTypes, textLines } from '../../shared/quality-template.js';
import { qualityDateFormats, qualityDateTimeFormats, booleanValuesOf } from '../../shared/quality-value-types.js';

export function RuleSection({title,children}) {
  useLocale();
  return <section className="quality-rule-section" aria-label={title}><h3>{title}</h3>{children}</section>;
}
function textRuleSummary(field,emptyLabel=pt("production.notEnabled")) {
  const parts=[];
  if(field.parseLine&&field.parseLine!=='all')parts.push(pt("production.line", { v0: field.parseLine }));
  const ignored=String(field.ignoreContent||'').split(/\r?\n/).filter(Boolean).length;
  if(ignored)parts.push(pt("production.ignoreItems", { v0: ignored }));
  if(['string','number'].includes(field.type)&&(field.regexPattern||field.regexReplacement))parts.push(pt("production.regexReplacement"));
  return parts.join(' · ')||emptyLabel;
}
export function TypeRules({field,onChange,uniqueKeyOwner,sourceTexts=[],allowUniqueKey=true,properties,children}) {
  useLocale();
  const lineCount=Math.max(1,...sourceTexts.map(text=>textLines(text).length),Number(field.parseLine)||1);
  const hasTypeSettings=['number','date','datetime','boolean','single','multi','measurements'].includes(field.type);
  const specialCount=field.specialValues?.length||0,itemCount=field.itemRules?.length||0;
  const showItemRules=properties&&(field.type==='string'||itemCount>0);
  return <>
    <RuleSection title={pt("production.basicInformation")}>{children}
    <label>{pt("production.dataType")}<Select aria-label={pt("production.dataType")} disabled={!!field.itemRules?.length} value={field.type} onChange={e=>onChange({type:e,...(!['string','number'].includes(e)?{regexPattern:undefined,regexReplacement:undefined}:{}),...(['date','datetime'].includes(e)?{dateFormat:e==='datetime'?qualityDateTimeFormats[0]:qualityDateFormats[0]}:{}),...(e==='measurements'?{separator:'/'}:{})})}>{qualityTypes.filter(type=>allowUniqueKey||type!=='uniqueKey').map(type=><option key={type} value={type} disabled={type==='uniqueKey'&&!!uniqueKeyOwner&&uniqueKeyOwner.id!==field.id}>{qualityTypeLabels[type]}</option>)}</Select></label>
    {(field.type==='uniqueKey'||uniqueKeyOwner&&uniqueKeyOwner.id!==field.id)&&<p className="muted">{field.type==='uniqueKey'?pt("production.readAsTextToPreserveLeadingZerosOnly"):pt("production.uniqueKeyIsAlreadyChangeItsTypeOr", { v0: uniqueKeyOwner.name })}</p>}
    <AntCheckbox className="quality-check" checked={!!field.required} onChange={e=>onChange({required:e.target.checked})}>{pt("production.required")}</AntCheckbox>
    </RuleSection>
    {hasTypeSettings&&<RuleSection title={pt("production.typeSettings")}>
    {field.type==='measurements'&&<label>{pt("production.measurementDelimiter")}<AntInput aria-label={pt("production.measurementDelimiter")} maxLength={10} value={(field.separator??'/').replaceAll('\n','\\n')} onChange={e=>onChange({separator:e.target.value.replaceAll('\\n','\n')})}/><small>{pt("production.eG206520612060RemovePrefixesSuch")}</small></label>}
    {field.type==='number'&&<label>{pt("production.numberMode")}<Select aria-label={pt("production.numberMode")} value={field.numberMode||'decimal'} onChange={e=>onChange({numberMode:e,...(e==='percent'?{unit:'%'}:{})})}><option value="decimal">{pt("production.regularNumber")}</option><option value="percent">{pt("production.percentage9595")}</option></Select></label>}
    {field.type==='number'&&field.numberMode==='percent'?<p className="muted">{pt("production.label95And95BothParseAs95With")}</p>:['number','measurements'].includes(field.type)&&<label>{pt("production.unit")}<AntInput value={field.unit||''} maxLength={30} onChange={e=>onChange({unit:e.target.value})}/></label>}
    {['date','datetime'].includes(field.type)&&<label>{pt("production.text")}{field.type==='datetime'?pt("production.dateAndTime"):pt("production.date")}{pt("production.format")}<Select aria-label={pt("production.dateFormat")} value={field.dateFormat||(field.type==='datetime'?qualityDateTimeFormats[0]:qualityDateFormats[0])} onChange={e=>onChange({dateFormat:e})}>{(field.type==='datetime'?qualityDateTimeFormats:qualityDateFormats).map(v=><option key={v}>{v}</option>)}</Select><small>{pt("production.textMustFollowTheSelectedFormatDayMonth")} {field.type==='datetime'?'YYYY-MM-DDTHH:mm:ss':'YYYY-MM-DD'}。</small></label>}
    {field.type==='boolean'&&<>{[['trueValues',pt("production.trueText")],['falseValues',pt("production.falseText")]].map(([key,label])=><label key={key}>{label}{pt("production.onePerLine")}<AntInput.TextArea aria-label={label} value={booleanValuesOf(field)[key]} rows={3} maxLength={2000} onChange={e=>onChange({[key]:e.target.value})}/></label>)}<p className="muted">{pt("production.matchesWholeCellTextCaseInsensitiveInEnglish")}</p></>}
    {['single','multi'].includes(field.type)&&<>
      <label>{pt("production.optionSplitMode")}<Select aria-label={pt("production.optionSplitMode")} value={choiceModeOf(field)} onChange={e=>onChange({choiceMode:e})}><option value="markers">{pt("production.splitByOptionMarkers")}</option><option value="separator">{pt("production.splitBySpecifiedDelimiter")}</option><option value="plain">{pt("production.exactWholeCellMatchPlain")}</option></Select></label>
      {choiceModeOf(field)==='markers'&&<label>{pt("production.markerPosition")}<Select aria-label={pt("production.markerPosition")} value={field.markerPosition||'before'} onChange={e=>onChange({markerPosition:e})}><option value="before">{pt("production.beforeTextPassReject")}</option><option value="after">{pt("production.afterTextPassReject")}</option></Select></label>}
      {choiceModeOf(field)!=='plain'&&<>
      <label>{pt("production.selectedMarker")}<AntInput aria-label={pt("production.selectedMarker")} value={field.checkChar||''} maxLength={10} onChange={e=>onChange({checkChar:e.target.value})}/><small>{pt("production.enterTheSelectedMarkerFromTheSourceCustom")}</small></label>
      <label>{pt("production.unselectedMarkersOnePerLine")}<AntInput.TextArea aria-label={pt("production.unselectedMarkers")} value={choiceUncheckText(field)} rows={2} maxLength={500} onChange={e=>onChange({uncheckChars:e.target.value})}/><small>{pt("production.enterSourceMarkersSuchAsOrOnlyConfigured")}</small></label>
      {choiceModeOf(field)==='separator'?<label>{pt("production.optionDelimiter")}<AntInput aria-label={pt("production.optionDelimiter")} value={(field.separator??'\n').replaceAll('\n','\\n')} maxLength={10} onChange={e=>onChange({separator:e.target.value.replaceAll('\\n','\n')})}/><small>{pt("production.splitStrictlyByThisCharacterEnterNFor")}</small></label>:<p className="muted">{pt("production.splitBySelectedAndUnselectedMarkersWithoutDelimiters")}</p>}
      </>}
      {choiceModeOf(field)==='plain'&&<p className="muted">{pt("production.trimmedWholeCellTextMustExactlyMatchOne")}</p>}
      <label>{pt("production.allowedOptionsOnePerLine")}<AntInput.TextArea aria-label={pt("production.allowedOptionsOnePerLine")} value={field.options||''} placeholder={'CNY\nUSD\nEUR'} rows={3} maxLength={2000} onChange={e=>onChange({options:e.target.value})}/><small>{choiceModeOf(field)==='plain'?pt("production.enterCompleteOptionTextRetainingSymbolsMatchingIs"):pt("production.enterOptionTextCopiedTextWithConfiguredMarkers")}</small></label>
    </>}
    </RuleSection>}
    <details className="quality-rule-disclosure quality-text-rules"><summary><strong>{pt("production.contentProcessing")}</strong><span>{textRuleSummary(field)}</span></summary><div className="quality-rule-content">
    <label>{pt("production.textLineToParse")}<Select aria-label={pt("production.textLineToParse")} value={field.parseLine??'all'} onChange={e=>onChange({parseLine:e==='all'?'all':Number(e)})}><option value="all">{pt("production.allLines")}</option>{Array.from({length:lineCount},(_,i)=><option key={i+1} value={i+1}>{pt("production.batch")} {i+1} {pt("production.rows")}</option>)}</Select><small>{pt("production.selectATextLineWithinTheCellNot")}</small></label>
    <label>{pt("production.ignoredContentOnePerLine")}<AntInput.TextArea aria-label={pt("production.ignoredContent")} value={field.ignoreContent??''} rows={2} maxLength={2000} onChange={e=>onChange({ignoreContent:e.target.value})}/><small>{pt("production.removeEveryExactOccurrenceInEnteredOrderCase")}</small></label>
    {['string','number'].includes(field.type)&&<fieldset className="quality-special-values"><legend>{pt("production.regexReplacement")}</legend>
      <label>{pt("production.regularExpression")}<AntInput aria-label={pt("production.regularExpression")} value={field.regexPattern??''} maxLength={1000} placeholder={pt("production.eG09")} onChange={e=>onChange({regexPattern:e.target.value})}/></label>
      <label>{pt("production.replacement")}<AntInput.TextArea aria-label={pt("production.regexReplacementText")} value={field.regexReplacement??''} maxLength={2000} rows={2} onChange={e=>onChange({regexReplacement:e.target.value})}/></label>
      <small>{pt("production.selectLinesRemoveIgnoredContentThenReplaceAll")}</small>
    </fieldset>}
    </div></details>
    {(field.type!=='uniqueKey'||showItemRules)&&<details className="quality-rule-disclosure quality-advanced-rules"><summary><strong>{pt("production.specialRules")}</strong><span>{[specialCount?pt("production.mappings", { v0: specialCount }):null,itemCount?pt("production.itemRules", { v0: itemCount }):null].filter(Boolean).join(' · ')||pt("production.notConfigured")}</span></summary><div className="quality-rule-content">
    {field.type!=='uniqueKey'&&<fieldset className="quality-special-values"><legend>{pt("production.specialValueMappings")}</legend><small>{pt("production.matchCompleteTextAfterLineSelectionIgnoredContent")}</small>
      {(field.specialValues||[]).map((rule,index)=><div className="quality-inline" key={index}><AntInput aria-label={pt("production.originalSpecialValue")} value={rule.text} maxLength={200} onChange={e=>onChange({specialValues:field.specialValues.map((r,i)=>i===index?{...r,text:e.target.value}:r)})}/><Select aria-label={pt("production.specialValueStatus")} value={rule.status} onChange={e=>onChange({specialValues:field.specialValues.map((r,i)=>i===index?{...r,status:e}:r)})}><option value="not_applicable">{pt("production.notApplicable")}</option><option value="missing">{pt("production.notEntered")}</option></Select><Button onClick={()=>onChange({specialValues:field.specialValues.filter((_,i)=>i!==index)})}>{pt("production.removeMapping")}</Button></div>)}
      <Button disabled={(field.specialValues||[]).length>=20} onClick={()=>onChange({specialValues:[...(field.specialValues||[]),{text:'',status:'not_applicable'}]})}>{pt("production.addSpecialValue")}</Button>
    </fieldset>}
      {showItemRules&&<ItemRules property={field} properties={properties} onChange={onChange} sourceTexts={sourceTexts}/>}
    </div></details>}
  </>;
}
function ItemRules({property,properties,onChange,sourceTexts}) {
  useLocale();
  const candidates=properties.filter(p=>p.id!==property.id&&['string','uniqueKey'].includes(p.type)&&!p.itemRules?.length);
  const rules=property.itemRules||[];
  return <section className="quality-item-rules" aria-label={pt("production.configureByInspectionItem")}><h4>{pt("production.configureByInspectionItem")}</h4><p className="muted">{pt("production.exactlyMatchAnotherPropertySTextAfterLine")}</p>
    {rules.map((rule,index)=><details key={index}><summary>{rule.equals||pt("production.newItemRule")} · {qualityTypeLabels[rule.config.type]}</summary><div className="quality-item-rule-content">
      <label>{pt("production.matchingProperty2")}<Select aria-label={pt("production.matchingProperty2")} value={rule.matchPropertyId} onChange={e=>onChange({itemRules:rules.map(r=>({...r,matchPropertyId:e}))})}><option value="" disabled>{pt("production.selectTheItemNameProperty")}</option>{candidates.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>
      <label>{pt("production.itemText2")}<AntInput aria-label={pt("production.itemText2")} maxLength={200} value={rule.equals} onChange={e=>onChange({itemRules:rules.map((r,i)=>i===index?{...r,equals:e.target.value}:r)})}/></label>
      <TypeRules field={rule.config} allowUniqueKey={false} sourceTexts={sourceTexts} onChange={change=>onChange({itemRules:rules.map((r,i)=>i===index?{...r,config:{...r.config,...change}}:r)})}/>
      <Button onClick={()=>onChange({itemRules:rules.filter((_,i)=>i!==index)})}>{pt("production.removeItemRule")}</Button></div>
    </details>)}
    <Button disabled={!candidates.length||rules.length>=100||property.type!=='string'} onClick={()=>onChange({itemRules:[...rules,{matchPropertyId:rules[0]?.matchPropertyId||candidates[0].id,equals:'',config:{type:'string'}}]})}>{pt("production.addItemRule")}</Button>
    {property.type!=='string'&&<small>{pt("production.setTheDefaultTypeToStringBeforeAdding")}</small>}
  </section>;
}

export function ObjectTerminationRules({field,onChange}) {
  useLocale();
  const mode=field.termination?.mode||'fixed',vertical=objectOrientation(field)==='vertical',unit=vertical?pt("production.columns"):pt("production.rows");
  return <section className="quality-rule-section" aria-label={pt("production.objectTerminationStrategy")}><h3>{pt("production.valueRangeTerminationStrategy")}</h3>
    <label>{pt("production.terminationStrategy")}<Select aria-label={pt("production.objectTerminationStrategy")} value={mode} onChange={e=>onChange({termination:e==='fixed'?undefined:e==='blank'?{mode:'blank',blankCount:1}:e==='label'?{mode:'label',endLabel:'合计'}:{mode:'usedRange'}})}>
      <option value="fixed">{pt("production.fixedSelectedRange")}</option><option value="blank">{pt("production.readUntilConsecutiveBlanks")}{unit}</option><option value="label">{pt("production.readUntilSpecifiedEndLabel")}</option><option value="usedRange">{pt("production.readUntilWorksheetUsedRangeEnds")}</option>
    </Select></label>
    {mode==='blank'&&<label>{pt("production.consecutiveBlank")}{unit}{pt("production.count")}<FormField value={field.termination.blankCount} type="number" min={1} max={2000} label={pt("production.consecutiveBlankCount", { v0: unit })}><AntInput aria-label={pt("production.consecutiveBlankCount", { v0: unit })} type="number" min={1} max={2000} value={field.termination.blankCount} onChange={e=>onChange({termination:{mode,blankCount:Number(e.target.value)}})}/></FormField><small>{pt("production.aRecordIsBlankOnlyWhenAllProperties")}{unit}{pt("production.terminatingBlank")}{unit}{pt("production.areExcludedFromTheReadRange")}</small></label>}
    {mode==='label'&&<label>{pt("production.endLabel")}<AntInput aria-label={pt("production.endLabel")} maxLength={200} value={field.termination.endLabel} onChange={e=>onChange({termination:{mode,endLabel:e.target.value}})}/><small>{pt("production.stopWhenAnyPropertySEntireCellText")}{unit}。</small></label>}
    {mode!=='fixed'&&<p className="muted">{pt("production.startAtTheSelectedFirst")}{unit}{pt("production.andReadInRecordDirectionUntilTheEnd")}{unit}{pt("production.countOnlineInputLocationsUseTheSelectedRange")}</p>}
  </section>;
}

export function ObjectProperties({field,onChange,sourceTexts,uniqueKeyOwner}) {
  useLocale();
  const [selectedId,setSelectedId]=useState(null);
  const property=field.properties.find(p=>p.id===selectedId),listRef=useRef(null),headingRef=useRef(null);
  const select=id=>{setSelectedId(id);requestAnimationFrame(()=>headingRef.current?.focus());};
  const back=()=>{setSelectedId(null);requestAnimationFrame(()=>listRef.current?.querySelector(`[data-property-id="${selectedId}"]`)?.focus());};
  const update=change=>onChange({properties:field.properties.map(p=>p.id===selectedId?{...p,...change}:p)});
  return <section className="quality-object-properties" aria-label={pt("production.objectPropertyEditor")}>
    {!property?<><h3>{pt("production.objectProperties")}{field.properties.length}）</h3><p className="muted">{pt("production.selectAPropertyToEditChangesStayIn")}</p>
      <div className="quality-property-list" ref={listRef}>{field.properties.map(p=><AntButton type="text" key={p.id} htmlType="button" className="quality-property-item" data-property-id={p.id} onClick={()=>select(p.id)}>
        <span><strong>{p.name||pt("production.unnamedProperty")}</strong><small>{p.headerCell} · {textRuleSummary(p,pt("production.noContentProcessing"))}{p.specialValues?.length?pt("production.mappings2", { v0: p.specialValues.length }):''}{p.itemRules?.length?pt("production.itemRules2", { v0: p.itemRules.length }):''}</small></span>
        <span className="quality-property-status"><Badge tone="blue">{qualityTypeLabels[p.type]}</Badge>{p.required&&<Badge tone="orange">{pt("production.required")}</Badge>}<ChevronRight size={16} aria-hidden="true"/></span>
      </AntButton>)}</div></>:<>
      <div className="quality-property-heading"><Button icon={ArrowLeft} onClick={back}>{pt("production.backToProperties")}</Button><h3 ref={headingRef} tabIndex={-1}>{property.name||pt("production.unnamedProperty")}</h3><small>{property.headerCell} · {qualityTypeLabels[property.type]}</small></div>
      <div className="quality-property-settings" key={property.id}>
        <TypeRules field={property} sourceTexts={sourceTexts[property.id]} uniqueKeyOwner={uniqueKeyOwner} properties={field.properties} onChange={update}>
          <label>{pt("production.propertyName")}<AntInput aria-label={pt("production.propertyName")} value={property.name} maxLength={60} onChange={e=>update({name:e.target.value})}/></label>
          {property.headerPath&&<p className="quality-header-path">{pt("production.originalHeader")}{property.headerPath.map(node=>`${node.text||pt("production.blank2")}（${node.region}）`).join(' → ')}</p>}
        </TypeRules>
      </div>
    </>}
  </section>;
}
