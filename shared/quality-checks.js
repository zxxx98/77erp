const fail=message=>{throw new Error(message);};
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER;
const count=n=>Number.isSafeInteger(n)&&n>=0;
const text=(value,label,max=200)=>{if(typeof value!=='string'||!value.trim()||value.length>max)fail(`${label}无效。`);return value.trim();};
export const checkLabels={range:'测量公差',sum:'缺陷合计',acceptance:'允收／拒收',decision:'最终判定一致性'};
export function parseMeasurements(raw,separator='/'){
  if(!raw.trim())return null;
  const parts=raw.split(separator);
  if(parts.length>100||parts.some(part=>!/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(part.trim())))fail('测量值须按指定分隔符填写完整数字，不能含空项或其他文字。');
  const values=parts.map(Number);if(values.some(value=>!finite(value)))fail('测量值超出支持范围。');return values;
}
export function validateChecks(input,fields){
  if(input===undefined)return [];
  if(!Array.isArray(input)||input.length>100)fail('最多配置 100 条核对规则。');
  const ids=new Set();
  const ref=value=>{
    const field=fields.find(f=>f.id===value?.fieldId);if(!field)fail('核对规则引用的字段不存在。');
    const result={fieldId:field.id};
    if(field.type==='object'){
      if(!field.properties.some(p=>p.id===value.propertyId))fail('核对规则引用的对象属性不存在。');
      result.propertyId=value.propertyId;
      if(value.match){
        const key=field.properties.find(p=>p.id===value.match.propertyId);
        if(!key||!['string','uniqueKey'].includes(key.type)||key.itemRules?.length)fail('核对项目匹配属性无效。');
        result.match={propertyId:key.id,equals:text(value.match.equals,'核对项目文字')};
      }
    }else if(value.propertyId||value.match)fail('普通字段不能配置对象属性或项目匹配。');
    return result;
  };
  let decisions=0;
  return input.map(rule=>{
    if(!rule||!Object.hasOwn(checkLabels,rule.kind)||typeof rule.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(rule.id)||ids.has(rule.id))fail('核对规则类型或 ID 无效。');ids.add(rule.id);
    const base={id:rule.id,name:text(rule.name,'核对规则名称',60),kind:rule.kind};
    if(rule.kind==='range'){
      if(!['samples','components'].includes(rule.mode)||!Array.isArray(rule.bounds)||!rule.bounds.length||rule.bounds.length>100||rule.mode==='samples'&&rule.bounds.length!==1)fail('测量公差的模式或限值数量无效。');
      const bounds=rule.bounds.map(b=>{
        if(!b||b.min==null&&b.max==null||b.min!=null&&!finite(b.min)||b.max!=null&&!finite(b.max)||b.min!=null&&b.max!=null&&b.min>b.max)fail('公差上下限无效。');
        if(b.minInclusive!==undefined&&typeof b.minInclusive!=='boolean'||b.maxInclusive!==undefined&&typeof b.maxInclusive!=='boolean')fail('公差边界类型无效。');
        if(b.min!=null&&b.min===b.max&&(b.minInclusive===false||b.maxInclusive===false))fail('公差区间不能为空。');
        return {name:text(b.name,'测量名称',60),min:b.min??null,max:b.max??null,minInclusive:b.minInclusive!==false,maxInclusive:b.maxInclusive!==false};
      });
      const source=ref(rule.source);
      const requirement=rule.requirement?{source:ref(rule.requirement.source),expected:text(rule.requirement.expected,'原检验要求',10000)}:null;
      return {...base,source,mode:rule.mode,bounds,...(requirement?{requirement}:{})};
    }
    if(rule.kind==='sum'){
      const source=ref(rule.source);if(!source.propertyId)fail('缺陷合计来源必须是对象属性。');
      if(!Array.isArray(rule.targets)||!rule.targets.length||rule.targets.length>5||!['review','zero'].includes(rule.emptyPolicy))fail('合计目标或空白处理方式无效。');
      const targets=rule.targets.map(ref);if(targets.some(r=>r.propertyId))fail('缺陷合计目标须为普通字段。');
      return {...base,source,targets,emptyPolicy:rule.emptyPolicy};
    }
    if(rule.kind==='acceptance')return {...base,source:ref(rule.source),limits:ref(rule.limits)};
    if(++decisions>1)fail('每个模板最多配置一条最终判定核对规则。');
    const items=ref(rule.items),observed=ref(rule.observed),final=ref(rule.final);
    if(!items.propertyId||!observed.propertyId||items.fieldId!==observed.fieldId||final.propertyId)fail('最终判定须为普通字段，检验结果与单项判定须来自同一对象。');
    const labels=key=>{if(!Array.isArray(rule[key])||!rule[key].length||rule[key].length>20)fail('请配置合格及不合格文字。');return [...new Set(rule[key].map(v=>text(v,'判定文字',100)))];};
    const passValues=labels('passValues'),failValues=labels('failValues');if(passValues.some(v=>failValues.includes(v)))fail('合格与不合格文字不能重复。');
    return {...base,items,observed,final,passValues,failValues};
  });
}
export function remapChecks(checks,ids){
  const remap=ref=>({...ref,fieldId:ids.get(ref.fieldId),...(ref.propertyId?{propertyId:ids.get(ref.propertyId)}:{}),...(ref.match?{match:{...ref.match,propertyId:ids.get(ref.match.propertyId)}}:{})});
  return checks.map(rule=>({...rule,...Object.fromEntries(['source','limits','items','observed','final'].filter(key=>rule[key]).map(key=>[key,remap(rule[key])])),...(rule.targets?{targets:rule.targets.map(remap)}:{}),...(rule.requirement?{requirement:{...rule.requirement,source:remap(rule.requirement.source)}}:{})}));
}
export function needsQualityReview(result){return (result?.sheets||[result]).some(sheet=>sheet?.checks?.some(check=>['fail','review'].includes(check.status)));}

// Deterministic checks on immutable parsed values, never a rewrite of the report verdict.
export function evaluateChecks(definition,parsed){
  const output=[];let rules;
  try{rules=validateChecks(definition.checks,definition.fields);}catch(error){return [{id:'configuration',name:'核对规则配置',kind:'configuration',status:'review',message:error.message,locations:[]}];}
  const select=(ref,context)=>{
    const field=parsed.results.find(f=>f.id===ref.fieldId);if(!field)return [];
    const points=ref.propertyId?(field.rows||[]).filter(row=>!ref.match||String(row.cells.find(c=>c.id===ref.match.propertyId)?.value??'').trim()===ref.match.equals)
      .filter(row=>!context||context.fieldId!==ref.fieldId||context.row===(row.row??null)&&context.column===(row.column??null))
      .map(row=>({...row.cells.find(c=>c.id===ref.propertyId),row:row.row??null,column:row.column??null,fieldId:ref.fieldId,propertyId:ref.propertyId})):[{...field,fieldId:ref.fieldId}];
    return points.map(point=>({...point,invalid:parsed.issues.some(issue=>issue.fieldId===point.fieldId&&(!issue.propertyId||issue.propertyId===point.propertyId||!point.propertyId)&&(!issue.propertyId||!issue.region||issue.region===point.region))}));
  };
  const locate=p=>({fieldId:p.fieldId,...(p.propertyId?{propertyId:p.propertyId}:{}),region:p.region||'A1',...(p.row!=null?{row:p.row}:{}),...(p.column!=null?{column:p.column}:{})});
  const emit=(rule,status,message,points=[],extra={})=>{const item={id:rule.id,name:rule.name,kind:rule.kind,status,message,locations:points.map(locate),...extra};output.push(item);return item;};
  const one=(ref,context)=>{const values=select(ref,context);return values.length===1?values[0]:null;};
  for(const rule of rules){
    if(rule.kind==='decision')continue;
    const points=select(rule.source);
    if(!points.length){emit(rule,'review','没有找到需要核对的数据。');continue;}
    if(rule.kind==='range')for(const point of points){
      if(point.invalid){emit(rule,'review','测量来源存在解析错误。',[point]);continue;}
      if(point.status==='not_applicable'){emit(rule,'not_applicable','测量项目明确标记为不适用。',[point]);continue;}
      if(!Array.isArray(point.value)||!point.value.length||point.value.some(v=>!finite(v))){emit(rule,'review','缺少有效的测量值列表。',[point]);continue;}
      if(rule.requirement){const requirement=one(rule.requirement.source,point);if(!requirement||requirement.invalid||typeof requirement.value!=='string'||requirement.value.trim()!==rule.requirement.expected){emit(rule,'review','检验要求已变化或缺失，请重新确认公差配置。',[point,...(requirement?[requirement]:[])]);continue;}}
      if(rule.mode==='components'&&point.value.length!==rule.bounds.length){emit(rule,'review',`应有 ${rule.bounds.length} 个部位测量值，实际 ${point.value.length} 个。`,[point]);continue;}
      const measurements=point.value.map((value,index)=>{
        const b=rule.bounds[rule.mode==='samples'?0:index],pass=(b.min===null||(b.minInclusive?value>=b.min:value>b.min))&&(b.max===null||(b.maxInclusive?value<=b.max:value<b.max));
        return {...b,name:rule.mode==='samples'?`${b.name} ${index+1}`:b.name,value,pass};
      });
      const field=definition.fields.find(f=>f.id===point.fieldId),property=point.propertyId?field?.properties.find(p=>p.id===point.propertyId):field;
      const unit=(property?.itemRules?.[point.ruleIndex]?.config||property)?.unit||'';
      const failed=measurements.filter(m=>!m.pass);emit(rule,failed.length?'fail':'pass',failed.length?`${failed.length} 个测量值超出配置限值。`:`${measurements.length} 个测量值均在配置限值内。`,[point],{measurements,unit});
    }
    if(rule.kind==='sum'){
      const targets=rule.targets.map(ref=>one(ref));let sum=0,unknown=false,used=0;
      for(const p of points){if(p.invalid){unknown=true;continue;}if(p.status==='not_applicable')continue;if(p.value===null||p.value===''){if(rule.emptyPolicy==='review'||p.status==='missing')unknown=true;else used++;continue;}if(!count(p.value)){unknown=true;continue;}sum+=p.value;used++;}
      if(!count(sum)||!used)unknown=true;
      if(unknown||targets.some(p=>!p||p.invalid||!count(p.value)))emit(rule,'review','缺陷数包含缺失或无效数据，不能确认合计。',[...points,...targets.filter(Boolean)]);
      else {const mismatch=targets.some(p=>p.value!==sum);emit(rule,mismatch?'fail':'pass',`明细合计 ${sum}；报告填写 ${targets.map(p=>p.value).join(' / ')}${rule.emptyPolicy==='zero'?'（按配置将空白计为 0）':''}。`,[...points,...targets],{sum,reported:targets.map(p=>p.value)});}
    }
    if(rule.kind==='acceptance'){
      const p=points.length===1?points[0]:null,limits=one(rule.limits),match=typeof limits?.value==='string'?/^(\d+)\s*[/／]\s*(\d+)$/.exec(limits.value.trim()):null;
      const ac=match?Number(match[1]):null,re=match?Number(match[2]):null;
      if(!p||p.invalid||!count(p.value)||!limits||limits.invalid||!count(ac)||!count(re)||ac>=re)emit(rule,'review','不良数或报告允收／拒收数无效。',[...points,...(limits?[limits]:[])]);
      else emit(rule,p.value<=ac?'pass':p.value>=re?'fail':'review',`不良数 ${p.value}，允收 ${ac} / 拒收 ${re}；${p.value<=ac?'达到允收条件':p.value>=re?'达到拒收条件':'位于允收与拒收之间，需人工确认'}。`,[p,limits]);
    }
  }
  for(const rule of rules.filter(r=>r.kind==='decision')){
    const items=select(rule.items),final=one(rule.final),classify=p=>!p||p.invalid?null:rule.passValues.includes(p.value)?true:rule.failValues.includes(p.value)?false:null;
    let unknown=!items.length,failed=false,conflict=false,applicable=0;const details=[],problemPoints=[];let pendingItems=0;
    for(const item of items){
      const observed=one(rule.observed,item);let measured=classify(observed),reported=classify(item);
      if(observed?.status==='not_applicable'&&!observed.invalid){if(reported!==null){conflict=true;problemPoints.push(item);details.push(`${item.region} 不适用项目仍填写了判定`);}continue;}
      applicable++;
      if(Array.isArray(observed?.value)){
        const range=output.filter(c=>c.kind==='range'&&c.locations.some(p=>p.fieldId===observed.fieldId&&p.region===observed.region));
        measured=range.some(c=>c.status==='fail')?false:range.length&&range.every(c=>c.status==='pass')?true:null;
      }
      if(measured===false||reported===false)failed=true;
      if(measured===null||reported===null){unknown=true;pendingItems++;problemPoints.push(item,...(observed?[observed]:[]));}
      if(measured!==null&&reported!==null&&measured!==reported){conflict=true;problemPoints.push(item,...(observed?[observed]:[]));details.push(`${item.region} 的单项判定与结果不一致`);}
    }
    if(!applicable)unknown=true;
    const prior=output.slice();if(prior.some(c=>['range','acceptance'].includes(c.kind)&&c.status==='fail'))failed=true;
    if(prior.some(c=>c.status==='review'||c.kind==='sum'&&c.status==='fail'))unknown=true;
    const expected=failed?false:unknown?null:true,reported=classify(final);
    const mismatch=reported!==null&&expected!==null&&reported!==expected;
    const status=conflict||mismatch?'fail':expected===null||reported===null||unknown?'review':'pass';
    const message=[`原报告最终判定：${final?.value??'未填写'}`,`系统核对：${expected===null?'数据不足，不能确认合格':expected?'已核对项目满足配置条件':'存在不合格或拒收条件'}`,...details,...(pendingItems?[`${pendingItems} 个项目的结果或单项判定尚未完成核对`]:[]),...(unknown?['部分项目缺失、要求变化或合计待核对']:[])].join('；');
    emit(rule,status,message,[...(problemPoints.length?problemPoints:items),...(final?[final]:[])],{pendingItems,reported:final?.value??null,expected:expected===null?null:expected?'pass':'fail'});
  }
  return output;
}
