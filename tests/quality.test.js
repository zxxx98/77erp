import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { createApp } from '../server/app.js';
import { parseAcceptance } from '../shared/quality-acceptance.js';
import { readQualityWorkbook } from '../server/quality-workbook.js';
import { adjacentRegion, choiceUncheckText, objectHeaders, parseRegion, preprocessText, previewChoice, previewDefinition, validateDefinition } from '../shared/quality-template.js';
import { sheetUniqueKey } from '../shared/quality-bindings.js';
const sample=await readFile(new URL('./fixtures/quality-template.xlsx',import.meta.url));
const workbook=await readQualityWorkbook(sample);
const verticalSample=await readFile(new URL('./fixtures/quality-template-vertical.xlsx',import.meta.url));
const verticalWorkbook=await readQualityWorkbook(verticalSample);
const verticalDefinition=()=>({sheetName:'竖向明细',fields:[{id:'items',name:'采购明细',labelRegion:'A1',type:'object',propertyRegion:'A3:A5',valueRegion:'B3:D5',properties:['名称','规格','数量'].map((name,i)=>({id:`p${i}`,name,type:'string'}))}]});
const object={id:'items',name:'采购明细',labelRegion:'A16:F16',labelText:'采购明细',type:'object',propertyRegion:'A17:F17',valueRegion:'A18:F20',configured:true,properties:['名称','规格','数量','单价（元）','小计（元）','备注'].map((name,i)=>({id:`p${i}`,name,type:'string',required:false}))};
const definition=()=>({sheetName:'Sheet1',fields:[structuredClone(object)]});
const credentials={account_id:'a'.repeat(32),bucket:'erp-backups',access_key:'test-access',secret_key:'test-secret'};
async function fixture(t) {
  const objects=new Map();
  const store={async put(c,key,bytes){objects.set(`${c.bucket}:${key}`,Buffer.from(bytes));},async head(c,key){assert.ok(objects.has(`${c.bucket}:${key}`));},async get(c,key){const b=objects.get(`${c.bucket}:${key}`);if(!b)throw new Error('missing');return b;},async remove(c,key){objects.delete(`${c.bucket}:${key}`);}};
  const instance=createApp(':memory:',{qualityStorage:store});
  const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await instance.notifications.stop();await instance.r2Backup.stop();server.closeAllConnections();await new Promise(r=>server.close(r));instance.db.close();});
  let cookie;
  const request=async(path,body,method=body===undefined?'GET':'POST',warehouse=1,session=cookie)=>{
    const multipart=body instanceof FormData;
    const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{...(multipart?{}:{'Content-Type':'application/json'}),'X-Warehouse-ID':String(warehouse),...(session?{Cookie:session}:{})},body:body===undefined?undefined:multipart?body:JSON.stringify(body)});
    const bytes=Buffer.from(await r.arrayBuffer()), isJson=r.headers.get('content-type')?.includes('application/json');
    return {status:r.status,data:isJson?JSON.parse(bytes.toString()):bytes,cookie:r.headers.get('set-cookie')?.split(';')[0]};
  };
  cookie=(await request('/auth/setup',{username:'admin',password:'Test-admin-123'})).cookie;
  const configure=async changes=>request('/settings/r2-backup',{...(await request('/settings/r2-backup')).data,...changes},'PUT');
  const upload=(def=definition(),file=sample,extra={})=>{const body=new FormData();body.append('file',new Blob([file]),'采购申请单示例.xlsx');body.append('name','采购验收单');body.append('definition',JSON.stringify(def));body.append('request_id',randomUUID());for(const [key,v] of Object.entries(extra))body.set(key,String(v));return body;};
  return {...instance,request,configure,upload,objects,store,cookie};
}

test('explicit directions respect merge boundaries, preserve adjacent blanks and reject out of bounds',()=>{
  const sheet=workbook.sheets[0];
  assert.equal(adjacentRegion(sheet,'A16:F16','down'),'A17');
  assert.equal(adjacentRegion(sheet,'A16:F16','up'),'A15');
  assert.equal(adjacentRegion(sheet,'A16:F16','left'),null);
  assert.equal(adjacentRegion(sheet,'A8','right'),'B8:F8');
  assert.throws(()=>parseRegion('A0'));assert.throws(()=>parseRegion('CW2001'));
});
test('custom keys read values without a label anchor and retain normal validation',()=>{
  const input={sheetName:'Sheet1',fields:[{id:'company',name:'公司名',customKey:true,valueRegion:'B8:F8',type:'string',required:true}]};
  const original=structuredClone(workbook);original.sheets[0].cells.B8={text:'某某公司',value:'某某公司'};
  const def=validateDefinition(input,original,{publish:true});
  assert.deepEqual(validateDefinition(def,original,{publish:true}),def);
  assert.equal(def.fields[0].labelRegion,undefined);
  assert.equal(previewDefinition(def,original).value.公司名,'某某公司');
  const filled=structuredClone(original);filled.sheets[0].cells.B8={text:'另一家公司',value:'另一家公司'};
  const parsed=parseAcceptance(def,original,filled);
  assert.equal(parsed.value.公司名,'另一家公司');assert.deepEqual(parsed.issues,[]);
  filled.sheets[0].cells.B8={text:'',value:''};
  assert.match(parseAcceptance(def,original,filled).issues[0].message,/必填/);
  filled.sheets[0].merges=filled.sheets[0].merges.filter(region=>region!=='B8:F8');
  assert.ok(parseAcceptance(def,original,filled).issues.some(issue=>/合并单元格/.test(issue.message)));
  for(const change of [{name:''},{valueRegion:''},{valueRegion:'A2000'},{direction:'right'},{type:'object'},{customKey:false}])
    assert.throws(()=>validateDefinition({...input,fields:[{...input.fields[0],...change}]},original));
  assert.throws(()=>validateDefinition({...input,fields:[...input.fields,{...input.fields[0],id:'duplicate'}]},original),/名称不能重复/);
  const withLabel=validateDefinition({sheetName:'Sheet1',fields:[{id:'label',name:'单号',labelRegion:'A8',valueRegion:'B8:F8',type:'string'}]},original);
  filled.sheets[0].cells.A8={text:'改过的标题',value:'改过的标题'};
  assert.ok(parseAcceptance(withLabel,original,filled).issues.some(issue=>/字段标题/.test(issue.message)));
});
test('custom keys survive template save, publish, copy and reload',async t=>{
  const f=await fixture(t);await f.configure(credentials);
  const input={sheetName:'Sheet1',fields:[{id:'company',name:'公司名',customKey:true,valueRegion:'B8:F8',type:'string'}]};
  const created=await f.request('/quality/templates',f.upload(input));assert.equal(created.status,200);
  let row=created.data;
  const saved=await f.request(`/quality/templates/${row.id}/draft`,{name:row.name,note:row.note,version:row.version,definition:row.definition},'PUT');
  assert.equal(saved.status,200);row=saved.data;
  const published=await f.request(`/quality/templates/${row.id}/publish`,{version:row.version});assert.equal(published.status,200);
  for(const result of [published,await f.request(`/quality/templates/${row.id}`),await f.request(`/quality/templates/${row.id}/copy`,{})]){
    assert.equal(result.status,200);assert.equal(result.data.definition.fields[0].customKey,true);
    assert.equal(result.data.definition.fields[0].labelRegion,undefined);
  }
});
test('unique KEY preserves text and shares one template-wide slot with object properties',()=>{
  const key={id:'code',name:'单号',labelRegion:'A8',valueRegion:'B8:F8',type:'uniqueKey'};
  const wb=structuredClone(workbook);wb.sheets[0].cells.B8={text:'00128',value:128};
  const input={sheetName:'Sheet1',fields:[key,structuredClone(object)]};
  const def=validateDefinition(input,wb,{publish:true});
  assert.equal(def.fields[0].type,'uniqueKey');
  assert.equal(previewDefinition(def,wb).value.单号,'00128');
  assert.deepEqual(validateDefinition(def,wb),def);
  wb.sheets[0].cells.B8={text:'',value:''};
  assert.equal(previewDefinition(def,wb).value.单号,'');
  assert.deepEqual(previewDefinition(def,wb).issues,[]);
  def.fields[0].required=true;
  assert.match(previewDefinition(def,wb).issues[0].message,/必填/);
  for(const publish of [false,true]){
    const duplicate=structuredClone(input);
    duplicate.fields.push({...key,id:'code2',name:'第二单号'});
    assert.throws(()=>validateDefinition(duplicate,wb,{publish}),/整个模板只能配置一个唯一 KEY/);
    duplicate.fields.pop();duplicate.fields[1].properties[0].type='uniqueKey';
    assert.throws(()=>validateDefinition(duplicate,wb,{publish}),/整个模板只能配置一个唯一 KEY/);
    duplicate.fields.shift();
    assert.equal(validateDefinition(duplicate,wb,{publish}).fields[0].properties[0].type,'uniqueKey');
    duplicate.fields[0].properties[1].type='uniqueKey';
    assert.throws(()=>validateDefinition(duplicate,wb,{publish}),/整个模板只能配置一个唯一 KEY/);
  }
  const data=structuredClone(workbook);data.sheets=[...['一批','二批'].map(name=>({...structuredClone(workbook.sheets[0]),name}))];
  data.sheets.forEach((sheet,i)=>{sheet.cells.B8={text:`00${i+1}`,value:i+1};});
  const parsed=parseAcceptance(validateDefinition(input,workbook),workbook,data,{sheetNames:['一批','二批']});
  assert.equal(parsed.value.一批.单号,'001');assert.equal(parsed.value.二批.单号,'002');assert.deepEqual(parsed.issues,[]);
});
test('unique KEY persists through publish, copy and backup while invalid API updates leave the draft intact',async t=>{
  const f=await fixture(t);await f.configure(credentials);
  const input=definition();input.fields.unshift({id:'code',name:'单号',labelRegion:'A8',valueRegion:'B8:F8',type:'uniqueKey'});
  let row=(await f.request('/quality/templates',f.upload(input))).data;
  assert.equal(row.definition.fields[0].type,'uniqueKey');
  const invalid=structuredClone(row.definition);invalid.fields[1].properties[0].type='uniqueKey';
  assert.equal((await f.request('/quality/templates',f.upload(invalid))).status,400);
  for(const [path,method,body] of [
    [`/quality/templates/${row.id}/draft`,'PUT',{name:row.name,note:row.note,version:row.version,definition:invalid}],
    [`/quality/templates/${row.id}/preview`,'POST',{definition:invalid}]
  ]){
    const response=await f.request(path,body,method);
    assert.equal(response.status,400);assert.match(response.data.error,/只能配置一个唯一 KEY/);
  }
  assert.deepEqual((await f.request(`/quality/templates/${row.id}`)).data.definition,row.definition);
  row=(await f.request(`/quality/templates/${row.id}/publish`,{version:row.version})).data;
  assert.equal(row.definition.fields[0].type,'uniqueKey');
  assert.equal((await f.request(`/quality/templates/${row.id}/copy`,{})).data.definition.fields[0].type,'uniqueKey');
  const backup=(await f.request('/backup')).data;
  assert.equal((await f.request('/backup/preview',{backup})).status,200);
});
test('choice fields match inline markers and decorated options without splitting option text on spaces',()=>{
  const run=(raw,config={})=>{
    const wb=structuredClone(workbook);wb.sheets[0].cells.B6={text:raw,value:raw};
    const def=validateDefinition({sheetName:'Sheet1',fields:[{id:'currency',name:'币种',labelRegion:'A6',valueRegion:'B6',type:'single',checkChar:'●',uncheckChars:'○\n◯\n☐\n□',separator:'\n',options:'● CNY\n○ USD\n○ EUR',...config}]},wb,{publish:true});
    return previewDefinition(def,wb);
  };
  for(const [raw,config,expected] of [
    ['● CNY ○ USD ○ EUR',{},'CNY'],
    ['○ CNY ● USD ○ EUR',{options:'CNY\nUSD\nEUR'},'USD'],
    ['○ CNY\n○ USD\n● EUR',{},'EUR'],
    ['●CNY○USD○EUR',{},'CNY'],
    ['CNY ●',{options:'CNY'},'CNY'],
    ['○ CNY ○ USD ○ EUR',{},null],
    ['[x] CNY|[ ] USD',{checkChar:'[x]',separator:'|',options:'CNY\nUSD'},'CNY'],
    ['+ CNY|USD',{checkChar:'+',separator:'|',options:'CNY\nUSD'},'CNY'],
    ['★ CNY ☆ USD ☆ EUR',{checkChar:'★',uncheckChars:'☆',options:'★ CNY\n☆ USD\n☆ EUR'},'CNY'],
    ['[x] CNY [ ] USD [ ] EUR',{checkChar:'[x]',uncheckChars:'[ ]',options:'[x] CNY\n[ ] USD\n[ ] EUR'},'CNY'],
    ['已选 CNY 未选 USD',{checkChar:'已选',uncheckChars:'未选',options:'CNY\nUSD'},'CNY'],
    ['●CNY ○USD ○EUR',{choiceMode:'separator',separator:' '},'CNY'],
    ['● CNY\r\n○ USD\r\n○ EUR',{choiceMode:'separator',separator:'\n'},'CNY'],
    ['☑️ 到场安装 ☑ 三年质保 ☐ 上门培训',{type:'multi',checkChar:'☑',options:'☑ 到场安装\n☐ 三年质保\n☐ 上门培训'},['到场安装','三年质保']],
    ['✓ 免费上门安装;✓ 含税 到厂价',{type:'multi',checkChar:'✓',separator:';',options:'免费上门安装\n含税 到厂价'},['免费上门安装','含税 到厂价']],
  ]){
    const out=run(raw,config);assert.deepEqual(out.value.币种,expected,raw);assert.deepEqual(out.issues,[],raw);
  }
  assert.match(run('● CNY ● USD ○ EUR').issues[0].message,/单选命中多个/);
  assert.match(run('● CNYY ○ USD ○ EUR').issues[0].message,/未配置/);
  assert.match(run('● GBP ○ USD ○ EUR').issues[0].message,/未配置/);
  assert.match(run('CNY ● USD ○ EUR ○').issues[0].message,/标记应放在选项文字前/);
  for(const separator of ['乱填','|','\n'])assert.match(run('● CNY ○ USD ○ EUR',{choiceMode:'separator',separator}).issues[0].message,/分隔符与原文不匹配/);
  assert.equal(run('● CNY ○ USD ○ EUR',{choiceMode:'markers',separator:'乱填'}).value.币种,'CNY');
  assert.match(run('★ CNY ☆ USD',{checkChar:'★',uncheckChars:'',options:'CNY\nUSD'}).issues[0].message,/未配置/);
  assert.match(run('○ CNY ○ USD ○ EUR',{required:true}).issues[0].message,/必填/);
  assert.throws(()=>run('● CNY',{options:'● CNY\n○ CNY'}),/不能重复/);
  assert.throws(()=>run('● CNY',{options:'●'}),/实际选项文字/);
  assert.throws(()=>run('● CNY',{choiceMode:'separator',separator:''}),/请填写选项分隔符/);
  assert.throws(()=>run('● CNY',{uncheckChars:'●'}),/不能与勾选字符相同/);
  assert.throws(()=>run('● CNY',{choiceMode:'auto'}),/拆分方式无效/);
  const transient=structuredClone(workbook);transient.sheets[0].cells.B6={text:'● CNY\n○ USD',value:'● CNY\n○ USD'};
  assert.equal(previewDefinition({sheetName:'Sheet1',fields:[{id:'currency',name:'币种',type:'single',valueRegion:'B6',choiceMode:'separator',checkChar:'●',options:'CNY\nUSD'}]},transient).value.币种,'CNY');
});
test('sample objects map six properties to three records with string values and exclude totals',()=>{
  const def=validateDefinition(definition(),workbook,{publish:true}),p=previewDefinition(def,workbook);
  assert.equal(p.results[0].rows.length,3);assert.equal(p.value.采购明细[0].数量,'8');
  assert.equal(p.value.采购明细[0]['单价（元）'],'42,000.00');assert.equal(p.value.采购明细[2].备注,'');
  assert.equal(p.results[0].rows[2].row,20);assert.equal(p.issues.length,0);
  const wb=structuredClone(workbook);for(const addr of ['A19','B19','C19','D19','E19','F19'])delete wb.sheets[0].cells[addr];
  const out=previewDefinition(def,wb);assert.deepEqual(out.results[0].rows.map(r=>r.row),[18,20]);
  def.fields[0].properties[2].type='number';assert.equal(previewDefinition(def,wb).value.采购明细[0].数量,8);
  wb.sheets[0].cells.C18.text='12±0.2';assert.match(previewDefinition(def,wb).issues[0].message,/数字/);
});
test('object definitions reject incomplete steps, mismatched columns, duplicate attributes and merges',()=>{
  for(const mutate of [d=>{delete d.fields[0].propertyRegion;},d=>{d.fields[0].propertyRegion='A17:F18';},d=>{d.fields[0].valueRegion='A18:E20';},d=>{d.fields[0].properties[1].name='名称';},d=>{d.fields[0].properties[1].type='object';},d=>{d.fields[0].valueRegion='A16:F20';}]){
    const d=definition();mutate(d);assert.throws(()=>validateDefinition(d,workbook,{publish:true}));
  }
  const wb=structuredClone(workbook);wb.sheets[0].merges.push('A18:B18');assert.throws(()=>validateDefinition(definition(),wb));
});
test('vertical attributes read records by column, skip blank columns and preserve partial records',()=>{
  const def=validateDefinition(verticalDefinition(),verticalWorkbook,{publish:true}),p=previewDefinition(def,verticalWorkbook);
  assert.equal(def.fields[0].orientation,'vertical');
  assert.deepEqual(def.fields[0].properties.map(p=>[p.headerCell,p.rowOffset]),[['A3',0],['A4',1],['A5',2]]);
  assert.deepEqual(p.results[0].rows.map(r=>r.column),[2,4]);
  assert.deepEqual(p.value.采购明细,[{名称:'服务器',规格:'机架式',数量:'8'},{名称:'交换机',规格:'',数量:'4'}]);
  def.fields[0].properties[1].required=true;
  const issue=previewDefinition(def,verticalWorkbook).issues[0];
  assert.deepEqual([issue.region,issue.row,issue.column],['D4',4,4]);
  def.fields[0].properties[2].type='number';assert.equal(previewDefinition(def,verticalWorkbook).value.采购明细[0].数量,8);
  for(const region of ['B3:D4','A3:C5','B4:D6']){
    const invalid=verticalDefinition();invalid.fields[0].valueRegion=region;
    assert.throws(()=>validateDefinition(invalid,verticalWorkbook),/起止行一致/);
  }
  const merged=structuredClone(verticalWorkbook);merged.sheets[0].merges.push('B3:B4');
  assert.throws(()=>validateDefinition(verticalDefinition(),merged),/合并/);
});
test('one property supports an explicit vertical orientation and horizontal definitions stay compatible',()=>{
  const input=verticalDefinition();Object.assign(input.fields[0],{propertyRegion:'A3',valueRegion:'B3:D3',orientation:'vertical',properties:[{id:'name',name:'名称',type:'string'}]});
  const def=validateDefinition(input,verticalWorkbook,{publish:true});
  assert.deepEqual(previewDefinition(def,verticalWorkbook).value.采购明细,[{名称:'服务器'},{名称:'交换机'}]);
  const horizontal=validateDefinition(definition(),workbook);
  assert.equal(Object.hasOwn(horizontal.fields[0],'orientation'),false);
  assert.deepEqual(validateDefinition(horizontal,workbook),horizontal);
});
test('workbook reader preserves blank coordinates, formatting, dates and missing formula cache errors',async()=>{
  const wb=new ExcelJS.Workbook(),s=wb.addWorksheet('验收');s.getCell('C4').value=1234.5;s.getCell('C4').numFmt='#,##0.00';s.getCell('D6').value={formula:'1+1'};s.getCell('B8').value=new Date('2026-10-20T00:00:00Z');s.getCell('B8').numFmt='yyyy-mm-dd';
  const w=await readQualityWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(w.sheets[0].cells.C4.text,'1,234.50');assert.match(w.sheets[0].cells.D6.error,/缓存/);assert.equal(w.sheets[0].cells.B8.date,'2026-10-20');assert.equal(w.sheets[0].cells.A1,undefined);
  await assert.rejects(readQualityWorkbook(Buffer.from('not excel')));
});
test('R2 prefix defaults, stays independent, preserves old clients, and preview does not require credentials',async t=>{
  const f=await fixture(t);assert.equal((await f.request('/settings/r2-backup')).data.excel_prefix,'excel');
  assert.equal((await f.request('/quality/workbook-preview',f.upload())).status,200);
  assert.equal((await f.request('/quality/templates',f.upload())).status,503);
  assert.equal((await f.configure({...credentials,excel_prefix:'forms'})).status,200);
  for(const excel_prefix of ['','../bad','a//b','77erp'])assert.equal((await f.configure({excel_prefix})).status,400);
  const c=(await f.request('/settings/r2-backup')).data;delete c.excel_prefix;
  assert.equal((await f.request('/settings/r2-backup',c,'PUT')).data.excel_prefix,'forms');
});
test('template CRUD, immutable published downloads, file replacement, R2 errors and prefix changes',async t=>{
  const f=await fixture(t);await f.configure(credentials);
  const body=f.upload(),created=await f.request('/quality/templates',body);assert.equal(created.status,200,JSON.stringify(created.data));let row=created.data;
  assert.equal((await f.request('/quality/templates',body)).data.id,row.id);assert.equal(f.objects.size,1);
  assert.match([...f.objects.keys()][0],/erp-backups:excel\//);
  assert.equal((await f.request(`/quality/templates/${row.id}/download`)).status,409);
  assert.equal((await f.request(`/quality/templates/${row.id}/preview`,{definition:row.definition})).data.value.采购明细.length,3);
  row=(await f.request(`/quality/templates/${row.id}/publish`,{version:row.version})).data;
  assert.deepEqual((await f.request(`/quality/templates/${row.id}/download`)).data,sample);
  assert.equal((await f.request(`/quality/templates/${row.id}/publish`,{version:1})).status,409);
  const changed=structuredClone(row.definition);changed.fields[0].properties[2].type='number';
  const saved=await f.request(`/quality/templates/${row.id}/draft`,{name:row.name,note:'changed',definition:changed,version:row.version},'PUT');assert.equal(saved.status,200);row=saved.data;
  assert.equal(row.has_draft,true);
  const revision=f.db.prepare('SELECT definition FROM quality_template_revisions WHERE id=?').get(row.published_revision);
  assert.equal(JSON.parse(revision.definition).fields[0].properties[2].type,'string');
  await f.configure({excel_prefix:'forms'});assert.deepEqual((await f.request(`/quality/templates/${row.id}/download`)).data,sample);
  const replace=f.upload(undefined,sample,{version:row.version});const next=await f.request(`/quality/templates/${row.id}/file`,replace);assert.equal(next.status,200,JSON.stringify(next.data));
  row=next.data;assert.equal(row.definition.fields.length,0);assert.equal(row.has_draft,true);assert.equal(f.objects.size,2);
  assert.match([...f.objects.keys()][1],/erp-backups:forms\//);assert.deepEqual((await f.request(`/quality/templates/${row.id}/download`)).data,sample);
  assert.equal((await f.request(`/quality/templates/${row.id}/publish`,{version:row.version})).status,400);
  assert.equal((await f.request(`/quality/templates/${row.id}/copy`,{})).status,200);
  f.objects.clear();assert.equal((await f.request(`/quality/templates/${row.id}/download`)).status,502);
});
test('permission and warehouse checks protect all quality endpoints, including raw files',async t=>{
  const f=await fixture(t);await f.configure(credentials);const row=(await f.request('/quality/templates',f.upload())).data;
  const id=(await f.request('/users',{username:'worker',password:'Test-worker-123'})).data.id;
  const employee=(await f.request('/auth/login',{username:'worker',password:'Test-worker-123'},'POST',1,'')).cookie;
  assert.equal((await f.request('/quality/templates',undefined,'GET',1,employee)).status,403);
  const user=(await f.request('/users')).data.find(u=>u.id===id);
  await f.request(`/users/${id}/permissions`,{version:user.permissions_version,permissions:['quality']},'PUT');
  assert.equal((await f.request('/quality/templates',undefined,'GET',1,employee)).status,200);
  const warehouse=(await f.request('/warehouses',{name:'品质分仓'})).data.id;
  assert.equal((await f.request(`/quality/templates/${row.id}`,undefined,'GET',warehouse,employee)).status,404);
  assert.equal((await f.request(`/quality/templates/${row.id}/draft/download`,undefined,'GET',warehouse)).status,404);
  assert.equal((await f.request('/settings/r2-backup',undefined,'GET',1,employee)).status,403);
});
test('quality references and versions round trip backups, reject tampering and retain R2 on reset',async t=>{
  const f=await fixture(t);await f.configure(credentials);let row=(await f.request('/quality/templates',f.upload())).data;
  row=(await f.request(`/quality/templates/${row.id}/publish`,{version:row.version})).data;
  const backup=(await f.request('/backup')).data;assert.equal(backup.version, 22);assert.equal(backup.data.quality_template_files.length,1);assert.ok(!JSON.stringify(backup).includes('test-secret'));
  const bad=structuredClone(backup);bad.data.quality_templates[0].file_id=999;
  assert.equal((await f.request('/backup/preview',{backup:bad})).status,400);
  const preview=await f.request('/backup/preview',{backup});assert.equal(preview.status,200,JSON.stringify(preview.data));assert.equal(preview.data.quality_files,1);
  const restored=await f.request('/backup/restore',{backup,...preview.data,confirmation:'RESTORE_BUSINESS_DATA',request_id:randomUUID()});assert.equal(restored.status,200,JSON.stringify(restored.data));
  assert.deepEqual((await f.request(`/quality/templates/${row.id}/download`)).data,sample);
  assert.equal((await f.request(`/quality/templates/${row.id}/status`,{version:row.version,enabled:false})).status,409);
  assert.equal((await f.request('/settings/reset',{confirmation:'RESET_BUSINESS_DATA'})).status,200);
  assert.equal((await f.request('/quality/templates')).data.total,0);assert.equal(f.objects.size,1);
  const legacy=structuredClone(backup);legacy.version=16;for(const key of Object.keys(legacy.data))if(key.startsWith('quality_'))delete legacy.data[key];
  assert.equal((await f.request('/backup/preview',{backup:legacy})).status,200);
});
test('vertical configuration persists through publishing, copying and backup restore',async t=>{
  const f=await fixture(t);await f.configure(credentials);
  const created=await f.request('/quality/templates',f.upload(verticalDefinition(),verticalSample));
  assert.equal(created.status,200,JSON.stringify(created.data));
  let row=created.data;assert.equal(row.definition.fields[0].orientation,'vertical');
  row=(await f.request(`/quality/templates/${row.id}/publish`,{version:row.version})).data;
  assert.equal((await f.request(`/quality/templates/${row.id}`)).data.definition.fields[0].orientation,'vertical');
  const copied=await f.request(`/quality/templates/${row.id}/copy`,{});
  assert.equal(copied.status,200);assert.equal(copied.data.definition.fields[0].properties[2].rowOffset,2);
  const backup=(await f.request('/backup')).data,preview=await f.request('/backup/preview',{backup});
  assert.equal(preview.status,200,JSON.stringify(preview.data));
  const restored=await f.request('/backup/restore',{backup,...preview.data,confirmation:'RESTORE_BUSINESS_DATA',request_id:randomUUID()});
  assert.equal(restored.status,200,JSON.stringify(restored.data));
  const output=await f.request(`/quality/templates/${row.id}/preview`,{});
  assert.equal(output.status,200);assert.deepEqual(output.data.value.采购明细,[{名称:'服务器',规格:'机架式',数量:'8'},{名称:'交换机',规格:'',数量:'4'}]);
  assert.deepEqual((await f.request(`/quality/templates/${row.id}/download`)).data,verticalSample);
});

async function publishedAcceptanceFixture(t,def=definition(),bytes=sample) {
  const f=await fixture(t);await f.configure(credentials);
  let row=(await f.request('/quality/templates',f.upload(def,bytes))).data;
  const published=await f.request(`/quality/templates/${row.id}/publish`,{version:row.version});assert.equal(published.status,200,JSON.stringify(published.data));row=published.data;
  const body=(file=bytes,extra={})=>{
    const form=new FormData();form.append('file',new Blob([file]),'填写后的验收单.xlsx');
    for(const [key,value] of Object.entries({template_id:row.id,revision_id:row.published_revision,...extra}))form.append(key,String(value));
    return form;
  };
  const preview=async(file=bytes,extra={})=>f.request('/quality/acceptances/preview',body(file,extra));
  const save=async(p,file=bytes,extra={})=>f.request('/quality/acceptances',body(file,{name:'服务器到货验收',note:'已核对',preview_token:p.preview_token,request_id:randomUUID(),...extra}));
  return {...f,row,body,preview,save};
}
async function filledWorkbook(change) {
  const excel=new ExcelJS.Workbook();await excel.xlsx.load(sample);change(excel.worksheets[0],excel);
  return Buffer.from(await excel.xlsx.writeBuffer());
}
const materialDefinition=()=>({sheetName:'Sheet1',fields:[{id:'material',name:'物料标识',type:'uniqueKey',labelRegion:'A8',valueRegion:'B8:F8'}]});
async function material(f,extra={},warehouse=1) {
  const response=await f.request('/products',{name:'测试绑定物料',barcode:`MAT-${randomUUID().slice(0,8)}`,category:'品质物料',unit:'件',cost:10,price:20,threshold:0,...extra},'POST',warehouse);
  assert.equal(response.status,201,JSON.stringify(response.data));return (await f.request(`/products/${response.data.id}`,undefined,'GET',warehouse)).data.product;
}
const bindingBody=bindings=>JSON.stringify(bindings.map(binding=>({sheetName:binding.sheetName,mode:binding.mode,product_id:binding.product_id})));
test('material matching uses exact code, name or customer part and handles ambiguous, missing, invalid and multiple keys',async t=>{
  const f=await publishedAcceptanceFixture(t,materialDefinition());
  assert.equal((await f.request('/contacts',{name:'料号客户',role:'customer',active:1,person:'',phone:'',address:'',note:'',request_id:randomUUID()})).status,200);
  const customer=(await f.request('/contacts')).data.find(customer=>customer.name==='料号客户');
  const byCode=await material(f,{barcode:'MAT-001',name:'编码物料'});
  const byName=await material(f,{barcode:'MAT-002',name:'名称物料'});
  const byPart=await material(f,{barcode:'MAT-003',name:'客户物料',customer_part_numbers:[{customer_id:customer.id,part_number:'客户-001'}]});
  for(const [key,product] of [['MAT-001',byCode],['名称物料',byName],['客户-001',byPart]]){
    const file=await filledWorkbook(sheet=>{sheet.getCell('B8').value=key;});
    const p=(await f.preview(file)).data;
    assert.equal(p.bindings[0].product_id,product.id);assert.equal(p.bindings[0].mode,'auto');assert.equal(p.bindings[0].status,'matched');
    for(const field of ['cost','price','stock','inventory_value_cents'])assert.equal(field in p.bindings[0].product,false);
  }
  for(const [key,status] of [['MAT-00','not_found'],['','empty_key']]){
    const p=(await f.preview(await filledWorkbook(sheet=>{sheet.getCell('B8').value=key;}))).data;
    assert.equal(p.bindings[0].product_id,null);assert.equal(p.bindings[0].status,status);
  }
  await material(f,{name:'名称物料'});
  let file=await filledWorkbook(sheet=>{sheet.getCell('B8').value='名称物料';});
  assert.equal((await f.preview(file)).data.bindings[0].status,'ambiguous');
  await material(f,{name:'MAT-001'});
  file=await filledWorkbook(sheet=>{sheet.getCell('B8').value='MAT-001';});
  assert.equal((await f.preview(file)).data.bindings[0].status,'ambiguous','a code/name collision must not pick a winner');
  const zero=await material(f,{barcode:'00128'});
  file=await filledWorkbook(sheet=>{sheet.getCell('B8').value=128;sheet.getCell('B8').numFmt='00000';});
  assert.equal((await f.preview(file)).data.bindings[0].product_id,zero.id);
  const def=validateDefinition(definition(),workbook);assert.equal(sheetUniqueKey(def,previewDefinition(def,workbook)).keyStatus,'missing_key');
  def.fields[0].properties[0].type='uniqueKey';
  const parsed=previewDefinition(def,workbook);assert.equal(sheetUniqueKey(def,parsed).keyStatus,'multiple_keys');
  for(const row of parsed.results[0].rows)row.cells[0].value='00128';
  assert.deepEqual(sheetUniqueKey(def,parsed),{keyValue:'00128',keyStatus:'ready'});
  parsed.issues.push({fieldId:'items',propertyId:'p0'});assert.equal(sheetUniqueKey(def,parsed).keyStatus,'invalid_key');
});
test('each selected Sheet independently binds automatically, manually or not at all with immutable material snapshots',async t=>{
  const input=materialDefinition();input.fields[0].labelRegion='A11';input.fields[0].valueRegion='B11';
  const f=await publishedAcceptanceFixture(t,input);
  const automatic=await material(f,{name:'第一批供应商',barcode:'MAT-AUTO'}),manual=await material(f,{name:'手选物料',barcode:'MAT-MANUAL'});
  const selection={sheet_names:JSON.stringify(dataSheetNames)},p=(await f.preview(multiSample,selection)).data;
  assert.equal(p.bindings[0].product_id,automatic.id);assert.equal(p.bindings[1].status,'not_found');
  const choices=[p.bindings[0],{sheetName:'二批到货',mode:'manual',product_id:manual.id}];
  const extra={...selection,bindings:bindingBody(choices),request_id:randomUUID()};
  const response=await f.save(p,multiSample,extra);assert.equal(response.status,200,JSON.stringify(response.data));const saved=response.data;
  assert.deepEqual(saved.result,p.preview);assert.equal(saved.bindings[0].product.barcode,'MAT-AUTO');assert.equal(saved.bindings[1].product.name,'手选物料');
  assert.equal((await f.save(p,multiSample,extra)).data.id,saved.id);
  assert.equal((await f.save(p,multiSample,{...extra,bindings:bindingBody([choices[0],{sheetName:'二批到货',mode:'none',product_id:null}])})).status,400,'binding choices participate in idempotency');
  f.db.prepare('UPDATE products SET name=?,specification=?,active=0 WHERE id=?').run('改名后物料','新规格',manual.id);
  assert.deepEqual((await f.request(`/quality/acceptances/${saved.id}`)).data.bindings,saved.bindings);
  const deletion=await f.request(`/products/${automatic.id}`,{},'DELETE');assert.equal(deletion.status,400);assert.match(deletion.data.error,/已绑定验收单/);
  const p2=(await f.preview(multiSample,selection)).data;
  const skipped=await f.save(p2,multiSample,{...selection,bindings:bindingBody(p2.bindings.map(binding=>({...binding,mode:'none',product_id:null})))});
  assert.equal(skipped.status,200,JSON.stringify(skipped.data));assert.ok(skipped.data.bindings.every(binding=>binding.product===null));
  assert.deepEqual((await f.request(`/quality/acceptances/${saved.id}/download`)).data,multiSample);
  const backup=(await f.request('/backup')).data;assert.equal(backup.version,22);
  const bp=await f.request('/backup/preview',{backup});assert.equal(bp.status,200,JSON.stringify(bp.data));
  assert.equal((await f.request('/backup/restore',{backup,...bp.data,confirmation:'RESTORE_BUSINESS_DATA',request_id:randomUUID()})).status,200);
  assert.deepEqual((await f.request(`/quality/acceptances/${saved.id}`)).data.bindings,saved.bindings);
  for(const mutate of [
    bindings=>{bindings[1].product_id=999999;},bindings=>{bindings[1].sheetName='未解析工作表';},bindings=>bindings.pop(),
    bindings=>{bindings[0].keyValue='篡改';},bindings=>{bindings[0].product.id=manual.id;}
  ]){
    const bad=structuredClone(backup),row=bad.data.quality_acceptances.find(row=>row.id===saved.id),bindings=JSON.parse(row.bindings);mutate(bindings);row.bindings=JSON.stringify(bindings);
    assert.equal((await f.request('/backup/preview',{backup:bad})).status,400);
  }
  const legacy=structuredClone(backup);legacy.version=19;for(const row of legacy.data.quality_acceptances)delete row.bindings;
  assert.equal((await f.request('/backup/preview',{backup:legacy})).status,200);
});
test('material binding validation enforces selected Sheets, current warehouse, active status and fresh automatic matches',async t=>{
  const f=await publishedAcceptanceFixture(t,materialDefinition());
  const product=await material(f,{barcode:'MATCH-001'}),other=await material(f,{barcode:'MANUAL-001'});
  const file=await filledWorkbook(sheet=>{sheet.getCell('B8').value='MATCH-001';}),p=(await f.preview(file)).data;
  const make=(id,mode='manual',sheetName='Sheet1')=>bindingBody([{sheetName,mode,product_id:id}]);
  for(const bindings of ['{}','[]','bad',make(null),make(product.id,'auto','不存在'),bindingBody([p.bindings[0],p.bindings[0]])])
    assert.equal((await f.save(p,file,{bindings})).status,400);
  const warehouse=(await f.request('/warehouses',{name:'绑定分仓'})).data.id,foreign=await material(f,{barcode:'FOREIGN-001'},warehouse);
  for(const id of [foreign.id,999999])assert.equal((await f.save(p,file,{bindings:make(id)})).status,400);
  f.db.prepare('UPDATE products SET active=0 WHERE id=?').run(other.id);
  assert.equal((await f.save(p,file,{bindings:make(other.id)})).status,400);
  assert.equal((await f.save(p,file,{bindings:make(other.id,'auto')})).status,400);
  await material(f,{name:'MATCH-001'});
  assert.equal((await f.save(p,file,{bindings:make(product.id,'auto')})).status,409,'new collision invalidates automatic match');
  const manual=await f.save(p,file,{bindings:make(product.id)});assert.equal(manual.status,200,JSON.stringify(manual.data));
  assert.equal(manual.data.bindings[0].mode,'manual');
  const before=f.objects.size,put=f.store.put;
  f.store.put=async(c,key,bytes)=>{await put(c,key,bytes);f.db.prepare('UPDATE products SET active=0 WHERE id=?').run(product.id);};
  assert.equal((await f.save(p,file,{bindings:make(product.id)})).status,400);assert.equal(f.objects.size,before,'concurrent material change rolls back and removes uploaded original');
});
test('quality material search is warehouse scoped, paginated and exposes no financial fields to quality-only users',async t=>{
  const f=await fixture(t),product=await material(f,{name:'分页-可搜索物料',barcode:'SEARCH-001'});
  for(let i=0;i<23;i++)await material(f,{name:`分页-${i}`});
  const warehouse=(await f.request('/warehouses',{name:'其他物料仓'})).data.id;await material(f,{name:'其他仓物料'},warehouse);
  const id=(await f.request('/users',{username:'binder',password:'Test-worker-123'})).data.id,user=(await f.request('/users')).data.find(user=>user.id===id);
  await f.request(`/users/${id}/permissions`,{version:user.permissions_version,permissions:['quality']},'PUT');
  const cookie=(await f.request('/auth/login',{username:'binder',password:'Test-worker-123'},'POST',1,'')).cookie;
  const search=await f.request('/quality/products?q=SEARCH',undefined,'GET',1,cookie);assert.equal(search.status,200);assert.equal(search.data.products[0].id,product.id);
  assert.deepEqual(Object.keys(search.data.products[0]).sort(),['barcode','id','name','specification','unit']);
  const list=(await f.request('/quality/products?q=分页-',undefined,'GET',1,cookie)).data;assert.equal(list.products.length,20);assert.equal(list.total,24);
  assert.equal((await f.request('/quality/products?q=分页-&offset=20',undefined,'GET',1,cookie)).data.products.length,4);
  f.db.prepare('UPDATE products SET active=0 WHERE id=?').run(product.id);
  assert.equal((await f.request('/quality/products?q=SEARCH',undefined,'GET',1,cookie)).data.total,0);
});
test('acceptances parse all scalar types and objects from uploaded values, persist snapshots and exact originals',async t=>{
  const def=definition();def.fields[0].properties[2].type='number';
  def.fields.push(
    {id:'budget',name:'预算',type:'number',labelRegion:'A5',valueRegion:'B5',required:true},
    {id:'currency',name:'币种',type:'single',labelRegion:'A6',valueRegion:'B6',checkChar:'●',uncheckChars:'○',options:'CNY\nUSD\nEUR',required:true},
    {id:'delivery',name:'交付方式',type:'multi',labelRegion:'A7',valueRegion:'B7',checkChar:'☑',uncheckChars:'☐',options:'到场安装\n三年质保\n上门培训'},
    {id:'date',name:'验收日期',type:'date',labelRegion:'A4',valueRegion:'B4',required:true},
  );
  const f=await publishedAcceptanceFixture(t,def);
  const file=await filledWorkbook(sheet=>{sheet.getCell('B5').value='￥ 99,000.50';sheet.getCell('B4').value='2026-10-20';sheet.getCell('C18').value=12;sheet.getCell('B6').value='○ CNY ● USD ○ EUR';});
  const p=await f.preview(file);assert.equal(p.status,200,JSON.stringify(p.data));assert.deepEqual(p.data.preview.issues,[]);
  assert.equal(p.data.preview.value.预算,99000.5);assert.equal(p.data.preview.value.币种,'USD');assert.equal(p.data.preview.value.验收日期,'2026-10-20');
  assert.deepEqual(p.data.preview.value.交付方式,['到场安装','三年质保']);assert.equal(p.data.preview.value.采购明细[0].数量,12);
  assert.equal(f.objects.size,1,'preview does not upload any original');
  const rid=randomUUID(),saved=await f.save(p.data,file,{request_id:rid});assert.equal(saved.status,200,JSON.stringify(saved.data));
  assert.deepEqual(saved.data.result,p.data.preview);assert.match(saved.data.number,/^QA-\d{8}-[A-F0-9]{12}$/);assert.equal(saved.data.revision,1);
  assert.deepEqual((await f.request(`/quality/acceptances/${saved.data.id}/download`)).data,file);
  assert.equal((await f.save(p.data,file,{request_id:rid})).data.id,saved.data.id);assert.equal(f.objects.size,2,'retries reuse the saved record');
  assert.equal((await f.request('/quality/acceptances?q=服务器到货')).data.total,1);
  assert.match([...f.objects.keys()][1],/\/acceptances\//);
  // Draft changes do not affect the chosen published version or saved records.
  const changed=structuredClone(f.row.definition);changed.fields[0].properties[2].type='string';
  const draft=await f.request(`/quality/templates/${f.row.id}/draft`,{name:'新版模板名称',note:'',definition:changed,version:f.row.version},'PUT');
  assert.equal(draft.status,200);assert.equal((await f.request('/quality/acceptance-templates')).data.templates[0].name,'采购验收单');
  assert.equal((await f.preview(file)).data.preview.value.采购明细[0].数量,12);
  await f.request(`/quality/templates/${f.row.id}/publish`,{version:draft.data.version});
  const detail=(await f.request(`/quality/acceptances/${saved.data.id}`)).data;
  assert.equal(detail.revision,1);assert.equal(detail.template_name,'采购验收单');assert.equal(detail.result.value.采购明细[0].数量,12);
  f.objects.delete([...f.objects.keys()][1]);assert.equal((await f.request(`/quality/acceptances/${saved.data.id}/download`)).status,502);
});
test('acceptance errors locate invalid values, missing sheets, moved headers and altered merged cells and block saving',async t=>{
  const def=definition();def.fields[0].properties[2]={...def.fields[0].properties[2],type:'number',required:true};
  const f=await publishedAcceptanceFixture(t,def);
  for(const [change,region,message] of [
    [sheet=>{sheet.getCell('C18').value='十二台';},'C18',/数字/],
    [sheet=>{sheet.getCell('C18').value=null;},'C18',/必填/],
    [sheet=>{sheet.getCell('C17').value='搬动的表头';},'C17',/字段标题或对象属性/],
    [sheet=>{sheet.unMergeCells('A16:F16');},'A18:F20',/合并单元格/],
    [sheet=>{sheet.name='其他工作表';},'A1',/缺少工作表/],
  ]){
    const file=await filledWorkbook(change),p=await f.preview(file);assert.equal(p.status,200,JSON.stringify(p.data));
    assert.ok(p.data.preview.issues.some(issue=>issue.region===region&&message.test(issue.message)),JSON.stringify(p.data.preview));
    assert.equal((await f.save(p.data,file)).status,400);
  }
  assert.equal((await f.request('/quality/acceptances')).data.total,0);assert.equal(f.objects.size,1);
});
test('local previews save without a server token, reparse the original file and validate template access',async t=>{
  const f=await publishedAcceptanceFixture(t);
  const path=`/quality/acceptance-templates/${f.row.id}?revision_id=${f.row.published_revision}`;
  const context=await f.request(path);assert.equal(context.status,200);assert.deepEqual(context.data.definition,f.row.definition);
  const warehouse=(await f.request('/warehouses',{name:'本地解析分仓'})).data.id;
  assert.equal((await f.request(path,undefined,'GET',warehouse)).status,404);
  assert.equal((await f.request(`/quality/acceptance-templates/${f.row.id}?revision_id=0`)).status,409);
  assert.equal((await f.request('/quality/binding-suggestions',{keys:[{sheetName:'Sheet1',keyStatus:'missing_key',keyValue:''}]})).data.bindings[0].status,'missing_key');
  assert.equal((await f.request('/quality/binding-suggestions',{keys:[null]})).status,400);
  const invalid=await filledWorkbook(sheet=>{sheet.getCell('A16').value='被改动的字段标题';});
  assert.equal((await f.request('/quality/acceptances',f.body(invalid,{name:'无效本地预览',request_id:randomUUID(),result:'{}'}))).status,400);
  const originalNow=Date.now;
  let saved;
  try{
    Date.now=()=>originalNow()+60*60*1000;
    saved=await f.request('/quality/acceptances',f.body(sample,{name:'本地预览保存',request_id:randomUUID(),result:JSON.stringify({value:'伪造'})}));
  }finally{Date.now=originalNow;}
  assert.equal(saved.status,200,JSON.stringify(saved.data));assert.ok(Array.isArray(saved.data.result.value.采购明细));
});
test('acceptance confirmations bind file, actor, warehouse, active revision and expiry, and cannot trust client results',async t=>{
  const f=await publishedAcceptanceFixture(t);let p=(await f.preview()).data;
  assert.equal((await f.save({...p,preview_token:'fake'})).status,409);
  const other=await filledWorkbook(sheet=>{sheet.getCell('C18').value=99;});assert.equal((await f.save(p,other)).status,409);
  const userId=(await f.request('/users',{username:'quality-worker',password:'Test-worker-123'})).data.id;
  const user=(await f.request('/users')).data.find(u=>u.id===userId);
  await f.request(`/users/${userId}/permissions`,{version:user.permissions_version,permissions:['quality']},'PUT');
  const employee=(await f.request('/auth/login',{username:'quality-worker',password:'Test-worker-123'},'POST',1,'')).cookie;
  const employeeBody=f.body(sample,{name:'越权确认',preview_token:p.preview_token,request_id:randomUUID()});
  assert.equal((await f.request('/quality/acceptances',employeeBody,'POST',1,employee)).status,409);
  const warehouse=(await f.request('/warehouses',{name:'验收分仓'})).data.id;
  assert.equal((await f.request('/quality/acceptances/preview',f.body(),'POST',warehouse)).status,404);
  const originalNow=Date.now;
  try{Date.now=()=>originalNow()+16*60*1000;assert.equal((await f.save(p)).status,409);}finally{Date.now=originalNow;}
  p=(await f.preview()).data;
  const changed=structuredClone(f.row.definition);changed.fields[0].name='采购明细新版';
  const draft=(await f.request(`/quality/templates/${f.row.id}/draft`,{name:f.row.name,note:'',definition:changed,version:f.row.version},'PUT')).data;
  const published=(await f.request(`/quality/templates/${f.row.id}/publish`,{version:draft.version})).data;
  assert.equal((await f.save(p)).status,409);assert.equal((await f.preview()).status,409);
  p=(await f.preview(sample,{revision_id:published.published_revision})).data;
  const save=await f.save(p,sample,{revision_id:published.published_revision,result:JSON.stringify({value:{采购明细:'伪造'}})});
  assert.equal(save.status,200,JSON.stringify(save.data));assert.ok(Array.isArray(save.data.result.value.采购明细新版));
  assert.equal((await f.request(`/quality/acceptances/${save.data.id}`,undefined,'GET',warehouse)).status,404);
  assert.equal((await f.request(`/quality/acceptances/${save.data.id}/download`,undefined,'GET',warehouse)).status,404);
  await f.request(`/quality/templates/${f.row.id}/status`,{enabled:false,version:published.version});
  assert.equal((await f.request('/quality/acceptance-templates')).data.templates.length,0);
  assert.equal((await f.preview(sample,{revision_id:published.published_revision})).status,409);
  assert.equal((await f.request(`/quality/acceptances/${save.data.id}`)).status,200,'disabled templates retain history');
});
test('acceptance storage failure and concurrent template changes never leave partial records or leaked objects',async t=>{
  const f=await publishedAcceptanceFixture(t),p=(await f.preview()).data;
  const put=f.store.put;f.store.put=async()=>{throw new Error('offline');};
  assert.equal((await f.save(p)).status,502);assert.equal((await f.request('/quality/acceptances')).data.total,0);
  f.store.put=async(c,key,bytes)=>{await put(c,key,bytes);f.db.prepare('UPDATE quality_templates SET enabled=0 WHERE id=?').run(f.row.id);};
  assert.equal((await f.save(p)).status,409);assert.equal(f.objects.size,1);assert.equal((await f.request('/quality/acceptances')).data.total,0);
});
test('acceptances round trip backup, reject tampered results and foreign revisions, and keep originals on reset',async t=>{
  const f=await publishedAcceptanceFixture(t,verticalDefinition(),verticalSample),p=(await f.preview()).data;
  const saved=(await f.save(p)).data;assert.ok(saved.id);assert.equal(saved.result.value.采购明细.length,2);
  const backup=(await f.request('/backup')).data;assert.equal(backup.version, 22);assert.equal(backup.data.quality_acceptances.length,1);
  const other=(await f.request(`/quality/templates/${f.row.id}/copy`,{})).data;
  await f.request(`/quality/templates/${other.id}/publish`,{version:other.version});
  const withOther=(await f.request('/backup')).data;
  for(const mutate of [
    a=>{a.result=JSON.stringify({...JSON.parse(a.result),value:{采购明细:[]}});},
    a=>{a.revision_id=withOther.data.quality_template_revisions.find(r=>r.template_id===other.id).id;},
    a=>{a.file_id=99999;},
    a=>{a.warehouse_id=99999;},
  ]){const bad=structuredClone(withOther);mutate(bad.data.quality_acceptances[0]);assert.equal((await f.request('/backup/preview',{backup:bad})).status,400);}
  const preview=await f.request('/backup/preview',{backup});assert.equal(preview.status,200,JSON.stringify(preview.data));assert.equal(preview.data.quality_acceptances,1);
  const restored=await f.request('/backup/restore',{backup,...preview.data,confirmation:'RESTORE_BUSINESS_DATA',request_id:randomUUID()});assert.equal(restored.status,200,JSON.stringify(restored.data));
  assert.deepEqual((await f.request(`/quality/acceptances/${saved.id}`)).data.result,saved.result);
  assert.deepEqual((await f.request(`/quality/acceptances/${saved.id}/download`)).data,verticalSample);
  const legacy=structuredClone(backup);legacy.version=17;delete legacy.data.quality_acceptances;
  assert.equal((await f.request('/backup/preview',{backup:legacy})).status,200);
  const objectCount=f.objects.size;await f.request('/settings/reset',{confirmation:'RESET_BUSINESS_DATA'});
  assert.equal((await f.request('/quality/acceptances')).data.total,0);assert.equal(f.objects.size,objectCount);
});

const multiSample=await readFile(new URL('./fixtures/quality-template-multisheet.xlsx',import.meta.url));
const multiWorkbook=await readQualityWorkbook(multiSample);
const dataSheetNames=['一批到货','二批到货'];
const repeatedDefinition=()=>({sheetName:'Sheet1',fields:[
  {...structuredClone(object),properties:object.properties.map((property,i)=>({...property,type:i===2?'number':'string'}))},
  {id:'company',name:'公司名称',type:'string',labelRegion:'A11',valueRegion:'B11',required:true},
]});
async function changeMulti(change) {const book=new ExcelJS.Workbook();await book.xlsx.load(multiSample);change(book);return Buffer.from(await book.xlsx.writeBuffer());}
test('one single-sheet definition applies unchanged to multiple arbitrarily named data sheets',()=>{
  const def=validateDefinition(repeatedDefinition(),workbook,{publish:true});
  assert.equal(def.schemaVersion,1);assert.equal(def.sheets,undefined);
  assert.throws(()=>validateDefinition({schemaVersion:2,sheets:[def]},workbook),/仅支持配置一个工作表/);
  const parsed=parseAcceptance(def,workbook,multiWorkbook,{sheetNames:dataSheetNames});
  assert.deepEqual(parsed.issues,[]);assert.equal(parsed.sheets.length,2);assert.equal(parsed.schemaVersion,2);
  assert.equal(parsed.value.一批到货.公司名称,'第一批供应商');assert.equal(parsed.value.二批到货.公司名称,'第二批供应商');
  assert.equal(parsed.value.一批到货.采购明细[0].数量,8);assert.equal(parsed.value.二批到货.采购明细[0].数量,12);
  assert.deepEqual(def,validateDefinition(repeatedDefinition(),workbook,{publish:true}),'parsing never rewrites template rules');
  for(const sheetNames of [[],['一批到货','一批到货']])assert.throws(()=>parseAcceptance(def,workbook,multiWorkbook,{sheetNames}),/请选择/);
});
test('sheet selection excludes instruction pages and errors identify each data sheet without requiring template sheet names',async()=>{
  const def=validateDefinition(repeatedDefinition(),workbook,{publish:true});
  const all=parseAcceptance(def,workbook,multiWorkbook,{sheetNames:multiWorkbook.sheets.map(sheet=>sheet.name)});
  assert.ok(all.issues.some(issue=>issue.sheetName==='填写说明'));
  const invalid=await changeMulti(book=>{book.getWorksheet('二批到货').getCell('C18').value='十二';book.getWorksheet('一批到货').getCell('B11').value='';});
  const parsed=parseAcceptance(def,workbook,await readQualityWorkbook(invalid),{sheetNames:dataSheetNames});
  assert.ok(parsed.issues.some(issue=>issue.sheetName==='二批到货'&&issue.region==='C18'&&/数字/.test(issue.message)));
  assert.ok(parsed.issues.some(issue=>issue.sheetName==='一批到货'&&issue.region==='B11'&&/必填/.test(issue.message)));
  assert.equal(parsed.value.一批到货.采购明细.length,3);
});
test('selected sheets are signed into confirmation, normalized to workbook order and saved as one immutable acceptance',async t=>{
  const f=await publishedAcceptanceFixture(t,repeatedDefinition());
  const selected={sheet_names:JSON.stringify(dataSheetNames)};
  const p=await f.preview(multiSample,selected);assert.equal(p.status,200,JSON.stringify(p.data));assert.deepEqual(p.data.preview.issues,[]);
  assert.deepEqual(p.data.sheet_names,dataSheetNames);assert.equal(p.data.definition.sheetName,'Sheet1');assert.equal(p.data.definition.sheets,undefined);
  assert.equal((await f.save(p.data,multiSample,{sheet_names:JSON.stringify(['一批到货'])})).status,409,'cannot confirm a different subset using this preview');
  assert.equal((await f.save(p.data,multiSample)).status,409,'cannot drop the selection to bypass confirmation');
  for(const names of [[],['不存在'],['一批到货','一批到货']])assert.equal((await f.preview(multiSample,{sheet_names:JSON.stringify(names)})).status,400);
  const all=await f.preview(multiSample,{sheet_names:'*'});assert.ok(all.data.preview.issues.some(issue=>issue.sheetName==='填写说明'));
  assert.equal((await f.save(all.data,multiSample,{sheet_names:'*'})).status,400);
  const request_id=randomUUID(),saved=await f.save(p.data,multiSample,{sheet_names:JSON.stringify([...dataSheetNames].reverse()),request_id});
  assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal((await f.request('/quality/acceptances')).data.total,1);
  assert.deepEqual(saved.data.result,p.data.preview);assert.deepEqual((await f.request(`/quality/acceptances/${saved.data.id}/download`)).data,multiSample);
  assert.equal((await f.save(p.data,multiSample,{...selected,request_id})).data.id,saved.data.id);
  const detail=(await f.request(`/quality/templates/${f.row.id}`)).data;assert.equal(detail.definition.schemaVersion,1);assert.equal(detail.definition.fields.length,2);
  const changed=structuredClone(detail.definition);changed.fields[0].properties[2].type='string';
  const draft=(await f.request(`/quality/templates/${f.row.id}/draft`,{name:detail.name,note:'更新规则',definition:changed,version:detail.version},'PUT')).data;
  await f.request(`/quality/templates/${f.row.id}/publish`,{version:draft.version});
  assert.deepEqual((await f.request(`/quality/acceptances/${saved.data.id}`)).data.result,saved.data.result);
});
test('grouped acceptances and old flat acceptances both survive backups, with no multi-sheet template migration',async t=>{
  const f=await publishedAcceptanceFixture(t,repeatedDefinition());
  const old=(await f.save((await f.preview()).data)).data;assert.equal(old.result.schemaVersion,undefined);
  const selection={sheet_names:JSON.stringify(dataSheetNames)},p=(await f.preview(multiSample,selection)).data;
  const saved=(await f.save(p,multiSample,selection)).data;assert.ok(saved.id);
  const backup=(await f.request('/backup')).data;assert.equal(backup.version, 22);assert.equal(backup.data.quality_acceptances.length,2);
  const preview=await f.request('/backup/preview',{backup});assert.equal(preview.status,200,JSON.stringify(preview.data));
  const bad=structuredClone(backup);const row=bad.data.quality_acceptances.find(a=>a.id===saved.id);const result=JSON.parse(row.result);result.value.一批到货.公司名称='篡改';row.result=JSON.stringify(result);
  assert.equal((await f.request('/backup/preview',{backup:bad})).status,400);
  const restored=await f.request('/backup/restore',{backup,...preview.data,confirmation:'RESTORE_BUSINESS_DATA',request_id:randomUUID()});assert.equal(restored.status,200,JSON.stringify(restored.data));
  assert.deepEqual((await f.request(`/quality/acceptances/${old.id}`)).data.result,old.result);
  assert.deepEqual((await f.request(`/quality/acceptances/${saved.id}`)).data.result,saved.result);
  assert.deepEqual((await f.request(`/quality/acceptances/${saved.id}/download`)).data,multiSample);
  const legacy=structuredClone(backup);legacy.version=18;legacy.data.quality_acceptances=legacy.data.quality_acceptances.filter(a=>a.id===old.id);
  assert.equal((await f.request('/backup/preview',{backup:legacy})).status,200);
});

const chartDefinition=()=>({sheetName:'Sheet1',fields:[
  {id:'date',name:'检验日期',type:'date',labelRegion:'A4',valueRegion:'B4'},
  {id:'rate',name:'合格率',type:'number',unit:'%',labelRegion:'A5',valueRegion:'B5'},
]});
const chartConfig=(kind='ordinary')=>({schemaVersion:1,kind,chartType:'line',objectId:null,x:{fieldId:'date'},dateField:{fieldId:'date'},bucket:'day',groupBy:null,metric:{aggregation:'avg',value:{fieldId:'rate'}}});
async function chartAcceptance(f,rate,product=null,date='2026-10-20') {
  const file=await filledWorkbook(sheet=>{sheet.getCell('B4').value=date;sheet.getCell('B5').value=`${rate}%`;});
  const p=await f.preview(file);assert.equal(p.status,200,JSON.stringify(p.data));
  const saved=await f.save(p.data,file,{bindings:bindingBody([{sheetName:'Sheet1',mode:product?'manual':'none',product_id:product?.id||null}])});
  assert.equal(saved.status,200,JSON.stringify(saved.data));return saved.data;
}
test('quality charts CRUD, saved and sample preview, source tracing and version conflicts',async t=>{
  const f=await publishedAcceptanceFixture(t,chartDefinition()),a=await material(f),b=await material(f);
  const first=await chartAcceptance(f,95,a),second=await chartAcceptance(f,99,a);await chartAcceptance(f,80,b);
  const payload={name:'合格率趋势',template_id:f.row.id,revision_id:f.row.published_revision,config:chartConfig(),request_id:randomUUID()};
  const sources=await f.request('/quality/chart-sources');assert.equal(sources.data.sources[0].revision_id,f.row.published_revision);
  assert.equal((await f.request(`/quality/chart-sources/${f.row.published_revision}`)).data.definition.fields[1].unit,'%');
  const preview=await f.request('/quality/charts/preview',{...payload,product_id:a.id});assert.equal(preview.status,200,JSON.stringify(preview.data));assert.equal(preview.data.rows[0].value,97);assert.equal(preview.data.unit,'%');
  assert.equal((await f.request('/quality/charts/preview',{...payload,sample:true})).data.sample,true);
  const response=await f.request('/quality/charts',payload);assert.equal(response.status,200,JSON.stringify(response.data));let chart=response.data;
  assert.equal((await f.request('/quality/charts',payload)).data.id,chart.id);
  assert.equal((await f.request('/quality/charts',{...payload,name:'不同请求'})).status,400);
  assert.equal((await f.request('/quality/charts?q=趋势&kind=ordinary')).data.total,1);
  assert.equal((await f.request(`/quality/charts/${chart.id}/data?product_id=${a.id}`)).data.rows[0].value,97);
  assert.equal((await f.request(`/quality/charts/${chart.id}/data?acceptance_id=${first.id}`)).data.rows[0].value,95);
  assert.equal((await f.request(`/quality/charts/${chart.id}/data?from=2026-10-21`)).data.rows.length,0);
  assert.equal((await f.request(`/quality/charts/${chart.id}/data?from=2026-02-30`)).status,400);
  const trace=(await f.request(`/quality/charts/${chart.id}/sources?x=2026-10-20&series=${encodeURIComponent('统计值')}&product_id=${a.id}`)).data;
  assert.deepEqual(trace.sources.map(row=>row.acceptanceId),[first.id,second.id]);assert.equal(trace.sources[0].sheetName,'Sheet1');
  const edited=await f.request(`/quality/charts/${chart.id}`,{...payload,name:'合格率月趋势',config:{...payload.config,bucket:'month'},version:chart.version},'PUT');assert.equal(edited.status,200);chart=edited.data;
  assert.equal((await f.request(`/quality/charts/${chart.id}`,{...payload,version:1},'PUT')).status,409);
  assert.equal((await f.request(`/quality/charts/${chart.id}/data`)).data.rows[0].x,'2026-10');
  const disabled=await f.request(`/quality/charts/${chart.id}/status`,{version:chart.version,enabled:false});assert.equal(disabled.status,200);
  assert.equal((await f.request(`/quality/charts/${chart.id}`,{version:chart.version},'DELETE')).status,409);
  assert.equal((await f.request(`/quality/charts/${chart.id}`,{version:disabled.data.version},'DELETE')).status,200);
});
test('material chart applicability depends on saved template-bound Sheets, not dates or preview material',async t=>{
  const f=await publishedAcceptanceFixture(t,chartDefinition()),a=await material(f),b=await material(f);
  const payload={name:'物料合格率',template_id:f.row.id,revision_id:f.row.published_revision,config:chartConfig('material'),product_id:a.id,request_id:randomUUID()};
  const response=await f.request('/quality/charts',payload);assert.equal(response.status,200,JSON.stringify(response.data));let chart=response.data;
  assert.ok(!JSON.stringify(chart.config).includes('product_id'));
  assert.equal((await f.request(`/quality/products/${a.id}/charts`)).data.charts.length,0);
  await chartAcceptance(f,95,null);assert.equal((await f.request(`/quality/products/${a.id}/charts`)).data.charts.length,0);
  await chartAcceptance(f,95,a);await chartAcceptance(f,80,b);
  assert.equal((await f.request(`/quality/products/${a.id}/charts`)).data.charts[0].id,chart.id);
  assert.equal((await f.request(`/quality/products/${b.id}/charts`)).data.charts[0].id,chart.id);
  assert.equal((await f.request(`/quality/charts/${chart.id}/data`)).status,400);
  assert.equal((await f.request(`/quality/charts/${chart.id}/data?product_id=${a.id}&from=2027-01-01`)).data.rows.length,0);
  assert.equal((await f.request(`/quality/products/${a.id}/charts?from=2027-01-01`)).data.charts.length,1);
  assert.equal((await f.request(`/quality/charts/${chart.id}/data?product_id=${b.id}`)).data.rows[0].value,80);
  f.db.prepare('UPDATE products SET active=0 WHERE id=?').run(a.id);assert.equal((await f.request(`/quality/charts/${chart.id}/data?product_id=${a.id}`)).data.rows[0].value,95);
  chart=(await f.request(`/quality/charts/${chart.id}/status`,{enabled:false,version:chart.version})).data;
  assert.equal((await f.request(`/quality/products/${b.id}/charts`)).data.charts.length,0);
});
test('chart routes enforce warehouse and permissions; backup v22 roundtrips charts and accepts legacy v20',async t=>{
  const f=await publishedAcceptanceFixture(t,chartDefinition());
  const payload={name:'备份品质图表',template_id:f.row.id,revision_id:f.row.published_revision,config:chartConfig(),request_id:randomUUID()};
  const created=await f.request('/quality/charts',payload);assert.equal(created.status,200,JSON.stringify(created.data));const chart=created.data;
  const other=(await f.request('/warehouses',{name:'图表另仓'})).data.id;
  assert.equal((await f.request(`/quality/charts/${chart.id}`,undefined,'GET',other)).status,404);
  assert.equal((await f.request('/quality/charts',{...payload,request_id:randomUUID()},'POST',other)).status,404);
  const uid=(await f.request('/users',{username:'chart-worker',password:'Test-worker-123'})).data.id;
  const cookie=(await f.request('/auth/login',{username:'chart-worker',password:'Test-worker-123'},'POST',1,'')).cookie;
  assert.equal((await f.request('/quality/charts',undefined,'GET',1,cookie)).status,403);
  const user=(await f.request('/users')).data.find(user=>user.id===uid);
  await f.request(`/users/${uid}/permissions`,{version:user.permissions_version,permissions:['quality']},'PUT');
  assert.equal((await f.request('/quality/charts',undefined,'GET',1,cookie)).status,200);
  const backup=(await f.request('/backup')).data;assert.equal(backup.version,22);assert.equal(backup.data.quality_charts.length,1);
  for(const mutate of [r=>{r.revision_id=999999;},r=>{r.warehouse_id=other;},r=>{const c=JSON.parse(r.config);c.metric.value.fieldId='missing';r.config=JSON.stringify(c);}]){
    const bad=structuredClone(backup);mutate(bad.data.quality_charts[0]);assert.equal((await f.request('/backup/preview',{backup:bad})).status,400);
  }
  const bp=await f.request('/backup/preview',{backup});assert.equal(bp.status,200,JSON.stringify(bp.data));assert.equal(bp.data.quality_charts,1);
  assert.equal((await f.request('/backup/restore',{backup,...bp.data,confirmation:'RESTORE_BUSINESS_DATA',request_id:randomUUID()})).status,200);
  const restored=(await f.request(`/quality/charts/${chart.id}`)).data;assert.deepEqual(restored.config,chart.config);assert.notEqual(restored.version,chart.version);
  const legacy=structuredClone(backup);legacy.version=20;delete legacy.data.quality_charts;assert.equal((await f.request('/backup/preview',{backup:legacy})).status,200);
  assert.equal((await f.request('/settings/reset',{confirmation:'RESET_BUSINESS_DATA'})).status,200);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM quality_charts').get().n,0);
});

const mergedSample=await readFile(new URL('./fixtures/quality-template-merged-objects.xlsx',import.meta.url));
const mergedWorkbook=await readQualityWorkbook(mergedSample);
function mergedDefinition(vertical=true){return {sheetName:vertical?'竖向合并':'横向合并',fields:[{id:'defects',name:'缺陷统计',labelRegion:'A1:B2',type:'object',propertyRegion:vertical?'A1:B6':'A1:F2',valueRegion:vertical?'C1:H6':'A3:F8',properties:['缺点等级','允收/拒收','不良数'].map((name,i)=>({id:`defect${i}`,name,type:i===2?'number':'string'}))}]};}
test('merged logical properties support vertical and horizontal objects, paired text and numeric zeros without duplicate records',()=>{
 for(const vertical of [true,false]){
  const def=validateDefinition(mergedDefinition(vertical),mergedWorkbook,{publish:true}),field=def.fields[0],parsed=previewDefinition(def,mergedWorkbook);
  assert.deepEqual(validateDefinition(def,mergedWorkbook),def);assert.equal(field.orientation,vertical?'vertical':'horizontal');
  assert.deepEqual(field.properties.map(p=>vertical?p.rowOffset:p.columnOffset),[0,2,4]);
  assert.deepEqual(parsed.issues,[]);assert.equal(parsed.results[0].rows.length,3);
  assert.deepEqual(parsed.results[0].rows.map(r=>vertical?r.column:r.row),[3,5,7]);
  assert.deepEqual(parsed.value.缺陷统计.map(r=>[r['允收/拒收'],r.不良数]),[['0 / 1',0],['2/3',0],['5/6',0]]);
  assert.equal(parsed.results[0].rows[0].cells[2].region,vertical?'C5:D6':'E3:F4');
  const broken=structuredClone(mergedWorkbook),sheet=broken.sheets.find(s=>s.name===def.sheetName);sheet.cells[vertical?'C5':'E3']={text:'无效',value:'无效'};
  const issue=previewDefinition(def,broken).issues[0];assert.equal(issue.region,vertical?'C5:D6':'E3:F4');
  const partial=mergedDefinition(vertical);partial.fields[0].propertyRegion=vertical?'A1:A6':'A1:F1';assert.throws(()=>validateDefinition(partial,mergedWorkbook),/完整合并/);
 }
});
test('merged object regions reject cells spanning properties or record boundaries and report changed import layouts',()=>{
 const input=mergedDefinition(),def=validateDefinition(input,mergedWorkbook),bad=structuredClone(mergedWorkbook),sheet=bad.sheets[0];
 sheet.merges=sheet.merges.filter(r=>!['C1:D2','C3:D4'].includes(r));sheet.merges.push('C1:D4');
 assert.throws(()=>validateDefinition(input,bad),/合并.*对齐/);
 const result=parseAcceptance(def,mergedWorkbook,bad,{sheetNames:['竖向合并']});
 assert.ok(result.issues.some(issue=>/合并单元格/.test(issue.message)));assert.equal(result.sheets[0].results[0].rows.length,0);
 const headers=mergedDefinition();headers.fields[0].propertyRegion='A1:D6';assert.throws(()=>validateDefinition(headers,mergedWorkbook),/一行或一列/);
});
test('merged logical records preserve formula errors and count one selected single merged property once per record',()=>{
 const input=mergedDefinition(),wb=structuredClone(mergedWorkbook);input.fields[0].properties=input.fields[0].properties.slice(0,1);Object.assign(input.fields[0],{propertyRegion:'A1:B2',valueRegion:'C1:H2',orientation:'vertical'});
 const def=validateDefinition(input,wb);assert.equal(previewDefinition(def,wb).results[0].rows.length,3);
 wb.sheets[0].cells.C1={text:'',value:null,error:'公式没有缓存值'};
 const parsed=previewDefinition(def,wb);assert.equal(parsed.results[0].rows.length,3);assert.equal(parsed.issues[0].region,'C1:D2');assert.match(parsed.issues[0].message,/公式/);
});
test('merged object rules survive publish, acceptance parsing and backup restore with unchanged Excel originals',async t=>{
 const f=await publishedAcceptanceFixture(t,mergedDefinition(),mergedSample),p=await f.preview(mergedSample);
 assert.equal(p.status,200,JSON.stringify(p.data));assert.equal(p.data.preview.value.缺陷统计.length,3);
 const saved=await f.save(p.data,mergedSample);assert.equal(saved.status,200,JSON.stringify(saved.data));
 assert.deepEqual((await f.request(`/quality/acceptances/${saved.data.id}/download`)).data,mergedSample);
 const backup=(await f.request('/backup')).data,bp=await f.request('/backup/preview',{backup});assert.equal(bp.status,200,JSON.stringify(bp.data));
 assert.equal((await f.request('/backup/restore',{backup,...bp.data,confirmation:'RESTORE_BUSINESS_DATA',request_id:randomUUID()})).status,200);
 assert.deepEqual((await f.request(`/quality/acceptances/${saved.data.id}`)).data.result,saved.data.result);
 assert.deepEqual((await f.request(`/quality/templates/${f.row.id}/download`)).data,mergedSample);
});

const multiheaderSample=await readFile(new URL('./fixtures/quality-template-multiheaders.xlsx',import.meta.url));
const multiheaderWorkbook=await readQualityWorkbook(multiheaderSample);
function multiheaderDefinition(vertical=false){return {sheetName:vertical?'竖向多级':'检验明细',fields:[{id:'inspections',name:'检验明细',labelRegion:vertical?'A1:B1':'A1:A2',type:'object',headerMode:'multi',orientation:vertical?'vertical':'horizontal',propertyRegion:vertical?'A1:B7':'A1:G2',valueRegion:vertical?'C1:E7':'A3:G5',properties:['检验项目','检验要求','检验结果','缺点件数 / CR','缺点件数 / MA','缺点件数 / MI','判定'].map((name,i)=>({id:`inspection${i}`,name,type:i>=3&&i<=5?'number':'string'}))}]};}
test('multi-level headers flatten mixed row/column spans into stable leaf properties in either orientation',()=>{
 for(const vertical of [false,true]){
  const def=validateDefinition(multiheaderDefinition(vertical),multiheaderWorkbook,{publish:true}),field=def.fields[0];
  assert.deepEqual(validateDefinition(def,multiheaderWorkbook),def);assert.equal(field.headerMode,'multi');assert.equal(field.properties.length,7);
  assert.deepEqual(field.properties[4].headerPath.map(node=>node.region),vertical?['A4:A6','B5']:['D1:F1','E2']);
  assert.match(field.properties[4].headerPath[0].text,/缺点件数/);assert.equal(field.properties[4].headerPath[1].text,'MA');
  assert.equal(field.properties[4][vertical?'rowOffset':'columnOffset'],4);
  const parsed=previewDefinition(def,multiheaderWorkbook);assert.deepEqual(parsed.issues,[]);assert.equal(parsed.results[0].rows.length,3);
  assert.deepEqual(parsed.value.检验明细.map(row=>[row['缺点件数 / CR'],row['缺点件数 / MA'],row['缺点件数 / MI']]),[[null,0,null],[1,2,3],[null,0,null]]);
  assert.deepEqual(parsed.results[0].rows.map(row=>vertical?row.column:row.row),[3,4,5]);
  assert.deepEqual(parsed.results[0].rows[1].cells[4].region,vertical?'D5':'E4');
 }
});
test('three-level groups preserve full ancestry and distinguish repeated leaf labels across branches',()=>{
 const input={sheetName:'三级表头',fields:[{id:'deep',name:'三级统计',type:'object',labelRegion:'A1:A3',headerMode:'multi',orientation:'horizontal',propertyRegion:'A1:E3',valueRegion:'A4:E5',properties:['检验项目','缺陷 / 外观 / CR','缺陷 / 外观 / MA','缺陷 / 尺寸 / MA','缺陷 / 尺寸 / MI'].map((name,i)=>({id:`deep${i}`,name,type:i?'number':'string'}))}]};
 const def=validateDefinition(input,multiheaderWorkbook,{publish:true});assert.deepEqual(def.fields[0].properties[3].headerPath.map(node=>node.text),['缺陷','尺寸','MA']);
 const p=previewDefinition(def,multiheaderWorkbook);assert.deepEqual(p.issues,[]);assert.equal(p.value.三级统计[0]['缺陷 / 尺寸 / MA'],8);
 const renamed=structuredClone(def);renamed.fields[0].properties[3].name='尺寸主要缺点';assert.equal(validateDefinition(renamed,multiheaderWorkbook).fields[0].properties[3].id,'deep3');
});
test('multi-level configuration requires explicit mode and direction, complete noncrossing groups and valid header paths',()=>{
 const plain=multiheaderDefinition();delete plain.fields[0].headerMode;assert.throws(()=>validateDefinition(plain,multiheaderWorkbook),/一行或一列/);
 const missing=multiheaderDefinition();delete missing.fields[0].orientation;assert.throws(()=>validateDefinition(missing,multiheaderWorkbook),/排列方向/);
 const partial=multiheaderDefinition();partial.fields[0].propertyRegion='A1:E2';assert.throws(()=>validateDefinition(partial,multiheaderWorkbook),/完整合并/);
 const wrong=multiheaderDefinition();wrong.fields[0].properties.pop();assert.throws(()=>validateDefinition(wrong,multiheaderWorkbook),/属性数量/);
 const tampered=validateDefinition(multiheaderDefinition(),multiheaderWorkbook);tampered.fields[0].properties[4].headerPath[0].text='伪造分组';assert.throws(()=>validateDefinition(tampered,multiheaderWorkbook),/路径/);
 const wb=structuredClone(multiheaderWorkbook),sheet=wb.sheets.find(s=>s.name==='三级表头');sheet.merges=sheet.merges.filter(r=>!['B3','C3','D3'].includes(r));sheet.merges.push('C3:D3');
 const crossed={sheetName:'三级表头',fields:[{id:'cross',name:'交叉',type:'object',labelRegion:'A1:A3',headerMode:'multi',orientation:'horizontal',propertyRegion:'A1:E3',valueRegion:'A4:E5',properties:[]}]};
 assert.throws(()=>validateDefinition(crossed,wb),/分组/);
});
test('acceptance parsing validates every parent header and merge, including multiple Sheets using one template',()=>{
 const def=validateDefinition(multiheaderDefinition(),multiheaderWorkbook),renamed=structuredClone(multiheaderWorkbook);renamed.sheets[0].cells.D1.text='另一组缺点';
 const wrong=parseAcceptance(def,multiheaderWorkbook,renamed,{sheetNames:['检验明细']});assert.ok(wrong.issues.some(issue=>issue.region==='D1:F1'&&/标题/.test(issue.message)));
 const data=structuredClone(multiheaderWorkbook);data.sheets=[1,2].map(i=>({...structuredClone(multiheaderWorkbook.sheets[0]),name:`批次${i}`}));
 const parsed=parseAcceptance(def,multiheaderWorkbook,data,{sheetNames:['批次1','批次2']});assert.deepEqual(parsed.issues,[]);assert.equal(parsed.sheets.length,2);assert.equal(parsed.sheets[1].results[0].rows.length,3);
});
test('multi-level template publication, copy, acceptance, chart and backup retain flattened fields and exact originals',async t=>{
 const f=await publishedAcceptanceFixture(t,multiheaderDefinition(),multiheaderSample),p=await f.preview(multiheaderSample);assert.equal(p.status,200,JSON.stringify(p.data));
 const saved=await f.save(p.data,multiheaderSample);assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.result.value.检验明细[1]['缺点件数 / MA'],2);
 const copied=await f.request(`/quality/templates/${f.row.id}/copy`,{});assert.equal(copied.status,200,JSON.stringify(copied.data));assert.notEqual(copied.data.definition.fields[0].properties[4].id,'inspection4');assert.deepEqual(copied.data.definition.fields[0].properties[4].headerPath,f.row.definition.fields[0].properties[4].headerPath);
 const chart=await f.request('/quality/charts',{name:'主要缺点统计',template_id:f.row.id,revision_id:f.row.published_revision,request_id:randomUUID(),config:{...chartConfig(),objectId:'inspections',x:{fieldId:'inspections',propertyId:'inspection0'},dateField:null,metric:{aggregation:'sum',value:{fieldId:'inspections',propertyId:'inspection4'}}}});assert.equal(chart.status,200,JSON.stringify(chart.data));
 const output=await f.request(`/quality/charts/${chart.data.id}/data`);assert.equal(output.status,200,JSON.stringify(output.data));assert.equal(output.data.rows.find(row=>row.x==='插头型号').value,2);assert.equal(output.data.stats.records,3);
 const backup=(await f.request('/backup')).data,bp=await f.request('/backup/preview',{backup});assert.equal(bp.status,200,JSON.stringify(bp.data));
 assert.equal((await f.request('/backup/restore',{backup,...bp.data,confirmation:'RESTORE_BUSINESS_DATA',request_id:randomUUID()})).status,200);
 assert.deepEqual((await f.request(`/quality/acceptances/${saved.data.id}`)).data.result,saved.data.result);assert.deepEqual((await f.request(`/quality/templates/${f.row.id}/download`)).data,multiheaderSample);
});

const reportLayoutWorkbook=await readQualityWorkbook(await readFile(new URL('./fixtures/quality-template-report-layout.xlsx',import.meta.url)));
function reportLayoutDefinition(includeProject=true,valueRegion='A11:O31'){
 const sheet=reportLayoutWorkbook.sheets[0],propertyRegion=includeProject?'A9:O10':'B9:O10';
 return {sheetName:sheet.name,fields:[{id:'report',name:'检验明细',type:'object',labelRegion:'A9:A10',headerMode:'multi',orientation:'horizontal',propertyRegion,valueRegion,properties:objectHeaders(sheet,propertyRegion,'horizontal','multi').cells.map((_,i)=>({id:`report${i}`,name:`属性${i}`,type:'string'}))}]};
}
test('report-style multilevel headers explain exact mismatched ranges and reject the merged footer without dropping records',()=>{
 assert.throws(()=>objectHeaders(reportLayoutWorkbook.sheets[0],'A11:O31','horizontal','multi'),error=>['20 层','A11:O31','先仅框选表头并确认属性','明细记录数不受此表头层数限制'].every(text=>error.message.includes(text)));
 const mismatch=reportLayoutDefinition(false,'A11:O32');
 assert.throws(()=>validateDefinition(mismatch,reportLayoutWorkbook),error=>['B9:O10','A11:O32','B～O','返回重选属性'].every(text=>error.message.includes(text)));
 for(const includeProject of [false,true]){
  const start=includeProject?'A':'B',footer=reportLayoutDefinition(includeProject,`${start}11:O32`);
  assert.throws(()=>validateDefinition(footer,reportLayoutWorkbook),error=>['B32:J32','B9:G10','备注或合计行'].every(text=>error.message.includes(text)));
  const definition=validateDefinition(reportLayoutDefinition(includeProject,`${start}11:O31`),reportLayoutWorkbook,{publish:true});
  assert.equal(definition.fields[0].properties.length,includeProject?7:6);
  const preview=previewDefinition(definition,reportLayoutWorkbook);assert.deepEqual(preview.issues,[]);assert.equal(preview.results[0].rows.length,21);assert.equal(preview.results[0].rows.at(-1).row,31);
 }
 const vertical=verticalDefinition();vertical.fields[0].valueRegion='B3:D4';
 assert.throws(()=>validateDefinition(vertical,verticalWorkbook),error=>error.message.includes('A3:A5')&&error.message.includes('B3:D4'));
});

test('choice rules have no implicit unchecked markers and retain an explicitly empty configuration',()=>{
 const config={type:'single',checkChar:'●',options:'CNY\nUSD'};
 assert.equal(choiceUncheckText(config),'');assert.equal(choiceUncheckText({...config,uncheckChars:''}),'');assert.equal(choiceUncheckText({...config,uncheckChars:'○'}),'○');
 const input={sheetName:'Sheet1',fields:[{id:'currency',name:'币种',labelRegion:'A6',valueRegion:'B6',...config}]};
 const definition=validateDefinition(input,workbook,{publish:true});assert.equal(definition.fields[0].uncheckChars,'');
 const parsed=previewChoice('● CNY ○ USD',config);assert.equal(parsed.parts.length,1);assert.equal(parsed.parts[0].label,'CNY ○ USD');assert.match(parsed.error,/未配置/);
 const separated=previewChoice('●CNY|USD',{...config,choiceMode:'separator',separator:'|'});assert.equal(separated.value,'CNY');assert.deepEqual(separated.parts.map(part=>part.status),['selected','unmarked']);
 assert.equal(validateDefinition({...input,fields:[{...input.fields[0],uncheckChars:''}]},workbook).fields[0].uncheckChars,'');
});
test('choice split previews preserve raw parts, labels, markers, selection and allowed-option matches for the actual parser',()=>{
 const config={type:'single',choiceMode:'markers',checkChar:'★',uncheckChars:'☆',options:'CNY\nUSD\nEUR'};
 const parsed=previewChoice('★ CNY ☆ USD ☆ EUR',config);assert.equal(parsed.value,'CNY');assert.equal(parsed.error,undefined);
 assert.deepEqual(parsed.parts.map(({raw,label,marker,status,matched})=>[raw,label,marker,status,matched]),[
  ['★ CNY ','CNY','★','selected',true],['☆ USD ','USD','☆','unselected',true],['☆ EUR','EUR','☆','unselected',true]
 ]);
 const multi=previewChoice('☑️ 到场安装 ☑ 三年质保 ☐ 上门培训',{type:'multi',checkChar:'☑',uncheckChars:'☐',options:'到场安装\n三年质保\n上门培训'});
 assert.deepEqual(multi.value,['到场安装','三年质保']);assert.deepEqual(multi.parts.map(part=>part.status),['selected','selected','unselected']);assert.equal(multi.parts[0].marker,'☑️');
 const suffix=previewChoice('CNY ★',config);assert.equal(suffix.value,'CNY');assert.equal(suffix.parts[0].raw,'CNY ★');assert.equal(suffix.parts[0].label,'CNY');
 const strict=previewChoice('★CNY|☆USD|☆EUR',{...config,choiceMode:'separator',separator:'|'});assert.equal(strict.parts.length,3);assert.equal(strict.value,'CNY');
 const wrong=previewChoice('★ CNY ☆ USD',{...config,choiceMode:'separator',separator:'乱填'});assert.match(wrong.error,/分隔符与原文不匹配/);assert.equal(wrong.parts[0].raw,'★ CNY ☆ USD');assert.equal(wrong.parts[0].status,'invalid');
 const unknown=previewChoice('★ GBP ☆ USD',config);assert.match(unknown.error,/未配置/);assert.equal(unknown.parts[0].label,'GBP');assert.equal(unknown.parts[0].matched,false);
 const conflict=previewChoice('★ CNY ★ USD',config);assert.match(conflict.error,/单选命中多个/);assert.equal(conflict.parts.filter(part=>part.status==='selected').length,2);
 for(const raw of ['★ CNY ☆ USD ☆ EUR','★ GBP ☆ USD','★ CNY ★ USD']){
  const wb=structuredClone(workbook);wb.sheets[0].cells.B6={text:raw,value:raw};const preview=previewDefinition({sheetName:'Sheet1',fields:[{id:'currency',name:'币种',valueRegion:'B6',...config}]},wb),split=previewChoice(raw,config);
  assert.deepEqual(preview.value.币种,split.value);assert.equal(preview.issues[0]?.message,split.error);
 }
});


test('text processing selects literal cell text lines before conversion for every scalar type',()=>{
  for(const [type,raw,ignoreContent,expected,extra] of [
    ['string','名称：服务器\r\nMáy chủ','名称：','服务器',{}],
    ['uniqueKey','编号：00128\nMã số','编号：','00128',{}],
    ['number','金额：￥ 128,000.50\nSố tiền','金额：',128000.5,{}],
    ['date','日期：2026-10-20\nNgày','日期：','2026-10-20',{}],
    ['single','结果：●合格 ○不合格\nKết quả','结果：','合格',{checkChar:'●',uncheckChars:'○',options:'合格\n不合格'}],
    ['multi','结果：●合格 ●复检\nKết quả','结果：',['合格','复检'],{checkChar:'●',options:'合格\n复检'}],
  ]){
    const wb=structuredClone(workbook);wb.sheets[0].cells.B6={text:raw,value:999,date:'2000-01-01'};
    const def=validateDefinition({sheetName:'Sheet1',fields:[{id:'text',name:'文本',labelRegion:'A6',valueRegion:'B6',type,parseLine:1,ignoreContent,...extra}]},wb,{publish:true});
    const parsed=previewDefinition(def,wb);
    assert.deepEqual(parsed.issues,[],type);assert.deepEqual(parsed.value.文本,expected,type);
    assert.equal(parsed.results[0].raw,raw);assert.deepEqual(validateDefinition(def,wb),def);
  }
});
test('line and ignore rules preserve blank line positions and literal removal without changing legacy results',()=>{
  assert.equal(preprocessText('\n中文\r\nTiếng Việt',{parseLine:2}),'中文');
  assert.equal(preprocessText('中文\rTiếng Việt',{parseLine:2}),'Tiếng Việt');
  assert.equal(preprocessText('中文\n\nTiếng Việt',{parseLine:2}),'');
  assert.equal(preprocessText('  [x].*12台[x].*  ',{ignoreContent:'[x].*\n台'}),'12');
  assert.equal(preprocessText('aab',{ignoreContent:'aa\nb'}),'');
  assert.equal(preprocessText('全部\n内容',{}),'全部\n内容');
  assert.throws(()=>preprocessText('仅一行',{parseLine:2}),/只有 1 行/);
  assert.equal(preprocessText('',{parseLine:2}),'');
  const wb=structuredClone(workbook);wb.sheets[0].cells.B6={text:'0',value:0};
  const run=config=>previewDefinition(validateDefinition({sheetName:'Sheet1',fields:[{id:'n',name:'数字',labelRegion:'A6',valueRegion:'B6',type:'number',...config}]},wb),wb);
  assert.equal(run({parseLine:1}).value.数字,0);
  assert.equal(run({ignoreContent:'0'}).value.数字,null);
  assert.match(run({ignoreContent:'0',required:true}).issues[0].message,/必填/);
  assert.match(run({parseLine:2}).issues[0].message,/第 2 行/);
  assert.deepEqual(run({}),run({parseLine:'all',ignoreContent:''}));
  for(const config of [{parseLine:0},{parseLine:1.2},{parseLine:'1'},{parseLine:32768},{ignoreContent:[]},{ignoreContent:'x'.repeat(2001)}])assert.throws(()=>run(config),/解析行|忽略内容/);
});
test('horizontal and vertical object properties apply text processing per logical cell and retain source errors',()=>{
  for(const vertical of [false,true]){
    const wb=structuredClone(vertical?verticalWorkbook:workbook),def=vertical?verticalDefinition():definition();
    const addr=vertical?'B3':'A18';wb.sheets[0].cells[addr]={text:'名称：服务器\nMáy chủ',value:'名称：服务器\nMáy chủ'};
    Object.assign(def.fields[0].properties[0],{parseLine:1,ignoreContent:'名称：'});
    const normalized=validateDefinition(def,wb,{publish:true}),parsed=previewDefinition(normalized,wb);
    assert.equal(parsed.value.采购明细[0].名称,'服务器');assert.equal(parsed.results[0].rows[0].cells[0].raw,'名称：服务器\nMáy chủ');
    normalized.fields[0].properties[0].parseLine=3;
    const error=previewDefinition(normalized,wb).issues[0];assert.equal(error.region,addr);assert.match(error.message,/第 3 行/);
  }
});
test('text rules persist through publication, copies, multi-sheet acceptance and backup while originals stay intact',async t=>{
  const bytes=await filledWorkbook((sheet,excel)=>{
    sheet.getCell('B8').value='编号：00128\nMã số';sheet.getCell('A18').value='名称：服务器\nMáy chủ';
    const second=excel.addWorksheet('二批');second.model={...sheet.model,name:'二批',mergeCells:sheet.model.merges};
  });
  const def=definition();def.fields.unshift({id:'code',name:'单号',labelRegion:'A8',valueRegion:'B8:F8',type:'uniqueKey',parseLine:1,ignoreContent:'编号：'});
  Object.assign(def.fields[1].properties[0],{parseLine:1,ignoreContent:'名称：'});
  const f=await publishedAcceptanceFixture(t,def,bytes);
  const copy=await f.request(`/quality/templates/${f.row.id}/copy`,{});assert.equal(copy.status,200);assert.equal(copy.data.definition.fields[0].ignoreContent,'编号：');
  const p=await f.preview(bytes,{sheet_names:JSON.stringify(['Sheet1','二批'])});assert.equal(p.status,200,JSON.stringify(p.data));
  assert.deepEqual(p.data.preview.issues,[]);assert.equal(p.data.preview.sheets.length,2);
  for(const sheet of p.data.preview.sheets){assert.equal(sheet.value.单号,'00128');assert.equal(sheet.value.采购明细[0].名称,'服务器');}
  const saved=await f.save(p.data,bytes,{sheet_names:JSON.stringify(['Sheet1','二批'])});assert.equal(saved.status,200,JSON.stringify(saved.data));
  const backup=(await f.request('/backup')).data,bp=await f.request('/backup/preview',{backup});assert.equal(bp.status,200,JSON.stringify(bp.data));
  assert.equal((await f.request('/backup/restore',{backup,...bp.data,confirmation:'RESTORE_BUSINESS_DATA',request_id:randomUUID()})).status,200);
  assert.deepEqual((await f.request(`/quality/acceptances/${saved.data.id}`)).data.result,saved.data.result);
  assert.deepEqual((await f.request(`/quality/acceptances/${saved.data.id}/download`)).data,bytes);
});

test('multi-cell acceptance values reject errors beyond the first logical cell',async()=>{
  for(const merged of [false,true])for(const errorValue of [{error:'#VALUE!'},{formula:'1+1'}]){
    const excel=new ExcelJS.Workbook(),sheet=excel.addWorksheet('检查');
    sheet.getCell('A1').value='检验结论';sheet.getCell('B1').value='尺寸正常';
    if(merged)sheet.mergeCells('C1:D1');
    const original=await readQualityWorkbook(await excel.xlsx.writeBuffer());
    const def=validateDefinition({sheetName:'检查',fields:[{id:'result',name:'结论',type:'string',labelRegion:'A1',valueRegion:merged?'B1:D1':'B1:C1',selectionMode:'manual'}]},original,{publish:true});
    sheet.getCell('C1').value=errorValue;
    const uploaded=await readQualityWorkbook(await excel.xlsx.writeBuffer());
    const parsed=parseAcceptance(def,original,uploaded);
    assert.equal(parsed.issues.length,1);
    assert.match(parsed.issues[0].message,/C1.*(Excel 单元格错误|公式缺少缓存值)/);
    assert.equal(parsed.results[0].value,null);
    sheet.getCell('C1').value='外观正常';
    const valid=parseAcceptance(def,original,await readQualityWorkbook(await excel.xlsx.writeBuffer()));
    assert.deepEqual(valid.issues,[]);assert.equal(valid.results[0].value,'尺寸正常\n外观正常');
  }
});

test('explicit suffix markers support report spacing, multiple choices and reject ambiguous input',()=>{
  const config={type:'single',choiceMode:'markers',markerPosition:'after',checkChar:'■',uncheckChars:'□',options:'合格\n拒收'};
  for(const raw of ['合格 ■        拒收 □','合格■拒收□','合格 ■\n拒收 □'])assert.equal(previewChoice(raw,config).value,'合格');
  assert.equal(previewChoice('合格□ 拒收■',config).value,'拒收');
  assert.equal(previewChoice('合格□ 拒收□',config).value,null);
  assert.match(previewChoice('合格■ 拒收■',config).error,/多个/);
  assert.match(previewChoice('未知■ 拒收□',config).error,/不匹配/);
  assert.match(previewChoice('■合格 □拒收',config).error,/后置/);
  assert.match(previewChoice('合格■ 拒收□ 未说明',config).error,/后置/);
  assert.match(previewChoice('合格 拒收',config).error,/不匹配/);
  assert.deepEqual(previewChoice('作业指导书□样板■图纸■',{...config,type:'multi',options:'作业指导书\n样板\n图纸'}).value,['样板','图纸']);
  assert.equal(previewChoice('合格■ 拒收□',{...config,options:'合格■\n拒收□'}).value,'合格');
  assert.equal(previewChoice('合格☑️拒收☐',{...config,checkChar:'☑',uncheckChars:'☐'}).value,'合格');
  assert.match(previewChoice('合格■拒收□',{...config,markerPosition:undefined}).error,/标记应放在/);
});

test('special values distinguish explicit not-applicable, missing and zero without splitting slash values',()=>{
  const run=(raw,extra={})=>{
    const wb=structuredClone(workbook);wb.sheets[0].cells.B6={text:raw,value:raw};
    const def=validateDefinition({sheetName:'Sheet1',fields:[{id:'n',name:'数量',labelRegion:'A6',valueRegion:'B6',type:'number',required:true,specialValues:[{text:'/',status:'not_applicable'},{text:'未填',status:'missing'}],...extra}]},wb,{publish:true});
    return previewDefinition(def,wb);
  };
  assert.deepEqual(run('/').issues,[]);assert.equal(run('/').results[0].status,'not_applicable');assert.equal(run('/').value.数量,null);
  assert.match(run('未填').issues[0].message,/必填/);assert.equal(run('未填',{required:false}).results[0].status,'missing');
  assert.match(run('').issues[0].message,/必填/);assert.equal(run('0').value.数量,0);
  assert.equal(run('值：/\n说明',{parseLine:1,ignoreContent:'值：'}).results[0].status,'not_applicable');
  assert.match(run('36/56/75').issues[0].message,/数字格式/);
  assert.equal(run('36/56/75',{type:'string'}).value.数量,'36/56/75');
  for(const extra of [{specialValues:[{text:'',status:'missing'}]},{specialValues:[{text:'/',status:'pass'}]},{specialValues:[{text:'/',status:'missing'},{text:' / ',status:'not_applicable'}]},{type:'uniqueKey'}])assert.throws(()=>run('/',extra),/特殊值|唯一 KEY/);
});

const shippingBytes=await readFile(new URL('./fixtures/quality-hangjia-shipping.xlsx',import.meta.url));
const shippingWorkbook=await readQualityWorkbook(shippingBytes);
const shippingDefinition=JSON.parse(await readFile(new URL('../docs/examples/hangjia-shipping-template.json',import.meta.url),'utf8'));
test('shipping report configuration parses 24 fields and 21 mixed inspection rows without inferring measurements or missing checks',()=>{
  const def=validateDefinition(shippingDefinition,shippingWorkbook,{publish:true});assert.deepEqual(def,shippingDefinition);
  const parsed=parseAcceptance(def,shippingWorkbook,shippingWorkbook);assert.deepEqual(parsed.issues,[]);
  assert.equal(parsed.value.客户料号,'251-01204040JV');assert.equal(parsed.value.检验批量,4136);assert.equal(parsed.value.抽验数量,200);assert.equal(parsed.value.最终判定,'合格');assert.deepEqual(parsed.value.检验依据,['图纸']);
  const items=parsed.results.find(r=>r.id==='items');assert.equal(items.rows.length,21);assert.equal(items.rows.at(-1).row,31);
  const cell=(row,id)=>items.rows.find(r=>r.row===row).cells.find(c=>c.id===id);
  assert.equal(cell(11,'result').value,'OK是');assert.equal(cell(13,'result').value,'36/56/75');assert.equal(cell(15,'result').value,'2065/2061/2060');assert.equal(cell(23,'result').value,'实测值 8.71/8.69');
  assert.equal(cell(16,'result').value,null);assert.equal(cell(16,'result').status,undefined);assert.equal(cell(16,'MA').status,'not_applicable');
  const bad=structuredClone(shippingWorkbook);bad.sheets[0].cells.H11={text:'OK是■ NG否■',value:'OK是■ NG否■'};
  const issue=parseAcceptance(def,shippingWorkbook,bad).issues[0];assert.equal(issue.propertyId,'result');assert.equal(issue.region,'H11:J11');assert.match(issue.message,/单选命中多个/);
});

test('item rule validation rejects invalid references, duplicate matches and nested or unique-key rules',()=>{
  const run=mutate=>{const def=structuredClone(shippingDefinition);mutate(def.fields.find(f=>f.id==='items'));return validateDefinition(def,shippingWorkbook,{publish:true});};
  for(const mutate of [
    f=>f.properties[2].itemRules[0].matchPropertyId='missing',f=>f.properties[2].itemRules[0].matchPropertyId='result',
    f=>f.properties[2].itemRules.push(structuredClone(f.properties[2].itemRules[0])),
    f=>f.properties[2].itemRules[0].config.type='uniqueKey',f=>f.properties[2].itemRules[0].config.itemRules=[],
    f=>f.properties[2].type='number',f=>f.properties[2].itemRules[1].matchPropertyId='requirement',
    f=>f.properties[2].itemRules[0].config.markerPosition='auto',
  ])assert.throws(()=>run(mutate),/规则|匹配|标记位置|默认类型/);
});

test('shipping rules survive copy, publication, multi-sheet import, material binding and backup restore',async t=>{
  const f=await publishedAcceptanceFixture(t,shippingDefinition,shippingBytes);
  const copy=await f.request(`/quality/templates/${f.row.id}/copy`,{});assert.equal(copy.status,200,JSON.stringify(copy.data));
  const copiedItems=copy.data.definition.fields.find(field=>field.type==='object');
  for(const rule of copiedItems.properties[2].itemRules)assert.equal(rule.matchPropertyId,copiedItems.properties[0].id);
  assert.notEqual(copiedItems.properties[0].id,'item');
  assert.equal((await f.request(`/quality/templates/${copy.data.id}/publish`,{version:copy.data.version})).status,200);
  const excel=new ExcelJS.Workbook();await excel.xlsx.load(shippingBytes);const sheet=excel.worksheets[0];
  sheet.getCell('D34').value='审核：新审核人\nXét duyệt:';sheet.getCell('K34').value='检验：新检验人\nKiểm tra:';
  const second=excel.addWorksheet('第二批');second.model={...sheet.model,name:'第二批',mergeCells:sheet.model.merges};
  const bytes=Buffer.from(await excel.xlsx.writeBuffer()),names=JSON.stringify([sheet.name,'第二批']);
  const product=await f.request('/products',{name:'报告物料',barcode:'251-01204040JV',category:'测试',unit:'条',cost:0,price:0,threshold:0});assert.equal(product.status,201,JSON.stringify(product.data));
  const p=await f.preview(bytes,{sheet_names:names});assert.equal(p.status,200,JSON.stringify(p.data));assert.deepEqual(p.data.preview.issues,[]);
  assert.equal(p.data.bindings[0].product_id,product.data.id);assert.equal(p.data.preview.sheets[0].value.报告审核人,'新审核人');
  const saved=await f.save(p.data,bytes,{sheet_names:names,bindings:JSON.stringify(p.data.bindings.map(b=>({sheetName:b.sheetName,mode:'auto',product_id:b.product_id})))});assert.equal(saved.status,200,JSON.stringify(saved.data));
  sheet.getCell('H11').value='OK是■ NG否■';
  const invalidBytes=Buffer.from(await excel.xlsx.writeBuffer()),invalidPreview=await f.preview(invalidBytes,{sheet_names:names});
  assert.equal(invalidPreview.status,200);assert.match(invalidPreview.data.preview.issues[0].message,/单选命中多个/);
  assert.equal((await f.save(invalidPreview.data,invalidBytes,{sheet_names:names})).status,400);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM quality_acceptances').get().n,1);
  const backup=(await f.request('/backup')).data,bp=await f.request('/backup/preview',{backup});assert.equal(bp.status,200,JSON.stringify(bp.data));
  assert.equal((await f.request('/backup/restore',{backup,...bp.data,confirmation:'RESTORE_BUSINESS_DATA',request_id:randomUUID()})).status,200);
  assert.deepEqual((await f.request(`/quality/acceptances/${saved.data.id}`)).data.result,saved.data.result);
  assert.deepEqual((await f.request(`/quality/acceptances/${saved.data.id}/download`)).data,bytes);
});

test('project matching works by processed name in horizontal rows and vertical columns, with fallback and positioned errors',()=>{
  for(const vertical of [false,true]){
    const wb=structuredClone(vertical?verticalWorkbook:workbook),def=vertical?verticalDefinition():definition(),sheet=wb.sheets[0];
    const key=vertical?'B3':'A18',target=vertical?'B4':'B18';
    sheet.cells[key]={text:'项目：外观\nAppearance',value:'项目：外观\nAppearance'};
    sheet.cells[target]={text:'合格■ 拒收□',value:'合格■ 拒收□'};
    const props=def.fields[0].properties;props[0].parseLine=1;props[0].ignoreContent='项目：';
    props[1].itemRules=[{matchPropertyId:props[0].id,equals:'外观',config:{type:'single',choiceMode:'markers',markerPosition:'after',checkChar:'■',uncheckChars:'□',options:'合格\n拒收',required:true}}];
    const normalized=validateDefinition(def,wb,{publish:true});
    assert.deepEqual(validateDefinition(normalized,wb,{publish:true}),normalized);
    const preview=()=>previewDefinition(normalized,wb);
    assert.equal(preview().results[0].rows[0].cells[1].value,'合格');
    sheet.cells[target]={text:'合格■ 拒收■',value:'合格■ 拒收■'};
    const issue=preview().issues.find(i=>i.propertyId===props[1].id);assert.equal(issue.region,target);assert.match(issue.message,/多个/);
    sheet.cells[key]={text:'另一个项目',value:'另一个项目'};
    assert.equal(preview().results[0].rows[0].cells[1].value,'合格■ 拒收■');assert.equal(preview().results[0].rows[0].cells[1].ruleIndex,undefined);
  }
});

test('quality checks require explicit confirmation, preserve immutable results and survive copy and v22 backup restore',async t=>{
  const def=JSON.parse(await readFile(new URL('../docs/examples/hangjia-shipping-checks.json',import.meta.url),'utf8'));
  const f=await publishedAcceptanceFixture(t,def,shippingBytes),names=JSON.stringify([def.sheetName]);
  const p=await f.preview(shippingBytes,{sheet_names:names});assert.equal(p.status,200,JSON.stringify(p.data));
  assert.deepEqual(p.data.preview.issues,[]);assert.equal(p.data.preview.sheets[0].checks.at(-1).status,'review');
  const refused=await f.save(p.data,shippingBytes,{sheet_names:names});assert.equal(refused.status,400);assert.match(refused.data.error,/核对系统/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM quality_acceptances').get().n,0);
  const request_id=randomUUID(),saved=await f.save(p.data,shippingBytes,{sheet_names:names,checks_acknowledged:'true',request_id});assert.equal(saved.status,200,JSON.stringify(saved.data));
  assert.equal(saved.data.checks_acknowledged,1);assert.equal(saved.data.result.sheets[0].value.最终判定,'合格');
  const retry=await f.save(p.data,shippingBytes,{sheet_names:names,checks_acknowledged:'true',request_id});assert.equal(retry.data.id,saved.data.id);
  const copy=await f.request(`/quality/templates/${f.row.id}/copy`,{});assert.equal(copy.status,200,JSON.stringify(copy.data));
  assert.notEqual(copy.data.definition.checks[0].source.fieldId,'items');
  assert.equal((await f.request(`/quality/templates/${copy.data.id}/publish`,{version:copy.data.version})).status,200);
  const copiedPreview=await f.request(`/quality/templates/${copy.data.id}/preview`,{});assert.equal(copiedPreview.status,200);assert.equal(copiedPreview.data.checks[0].status,'pass');assert.equal(copiedPreview.data.checks.at(-1).status,'review');
  const next=structuredClone(def);next.checks.find(c=>c.id==='length').bounds[0].max=2062;
  const draft=await f.request(`/quality/templates/${f.row.id}/draft`,{version:f.row.version,name:f.row.name,note:'新限值',definition:next},'PUT');assert.equal(draft.status,200);
  assert.equal((await f.request(`/quality/templates/${f.row.id}/publish`,{version:draft.data.version})).status,200);
  assert.deepEqual((await f.request(`/quality/acceptances/${saved.data.id}`)).data.result,saved.data.result);
  const backup=(await f.request('/backup')).data;assert.equal(backup.version,22);
  const missing=structuredClone(backup);missing.data.quality_acceptances[0].checks_acknowledged=0;
  assert.equal((await f.request('/backup/preview',{backup:missing})).status,400);
  const tampered=structuredClone(backup);const snapshot=JSON.parse(tampered.data.quality_acceptances[0].result);snapshot.sheets[0].checks[0].status='fail';tampered.data.quality_acceptances[0].result=JSON.stringify(snapshot);
  assert.equal((await f.request('/backup/preview',{backup:tampered})).status,400);
  const bp=await f.request('/backup/preview',{backup});assert.equal(bp.status,200,JSON.stringify(bp.data));
  assert.equal((await f.request('/backup/restore',{backup,...bp.data,confirmation:'RESTORE_BUSINESS_DATA',request_id:randomUUID()})).status,200);
  const restored=(await f.request(`/quality/acceptances/${saved.data.id}`)).data;assert.equal(restored.checks_acknowledged,1);assert.deepEqual(restored.result,saved.data.result);
});

test('v21 acceptance backups default to unacknowledged without changing old snapshots',async t=>{
  const f=await publishedAcceptanceFixture(t),p=await f.preview();const saved=await f.save(p.data);assert.equal(saved.status,200);
  const backup=(await f.request('/backup')).data;backup.version=21;
  for(const row of backup.data.quality_acceptances)delete row.checks_acknowledged;
  const bp=await f.request('/backup/preview',{backup});assert.equal(bp.status,200,JSON.stringify(bp.data));
  assert.equal((await f.request('/backup/restore',{backup,...bp.data,confirmation:'RESTORE_BUSINESS_DATA',request_id:randomUUID()})).status,200);
  const restored=(await f.request(`/quality/acceptances/${saved.data.id}`)).data;assert.equal(restored.checks_acknowledged,0);assert.deepEqual(restored.result,saved.data.result);
});

test('regex replacement runs after line and literal processing, before numeric and special-value conversion',()=>{
  const run=(raw,config={})=>{
    const wb=structuredClone(workbook);wb.sheets[0].cells.B6={text:raw,value:999};
    const def=validateDefinition({sheetName:'Sheet1',fields:[{id:'r',name:'替换',labelRegion:'A6',valueRegion:'B6',type:'string',...config}]},wb,{publish:true});
    assert.deepEqual(validateDefinition(def,wb),def);
    return previewDefinition(def,wb);
  };
  assert.equal(run('名称：ABC-12 ABC-34\n说明',{parseLine:1,ignoreContent:'名称：',regexPattern:'ABC-(\\d+)',regexReplacement:'编号$1'}).value.替换,'编号12 编号34');
  assert.equal(run('12.5 kg',{type:'number',regexPattern:'\\s*kg$',regexReplacement:''}).value.替换,12.5);
  assert.equal(run('数量0',{type:'number',regexPattern:'数量',regexReplacement:''}).value.替换,0);
  assert.match(run('数量12x',{type:'number',regexPattern:'数量',regexReplacement:''}).issues[0].message,/数字格式/);
  assert.match(run('删除',{regexPattern:'.+',regexReplacement:'',required:true}).issues[0].message,/必填/);
  assert.equal(run('N/A',{regexPattern:'(?i)n/a',regexReplacement:'/',specialValues:[{text:'/',status:'not_applicable'}]}).results[0].status,'not_applicable');
  assert.equal(run('a a',{regexPattern:'a',regexReplacement:'$$$&'}).value.替换,'$a $a');
  assert.equal(run('a b',{regexPattern:' ',regexReplacement:'-'}).value.替换,'a-b');
  assert.equal(run('中文',{regexPattern:'z',regexReplacement:'x'}).value.替换,'中文');
  assert.equal(run('ab',{regexPattern:'^|$',regexReplacement:'_'}).value.替换,'_ab_');
  assert.equal(run('a'.repeat(9999)+'!',{regexPattern:'(a+)+$',regexReplacement:''}).value.替换.length,10000);
  assert.match(run('a'.repeat(6000),{regexPattern:'a',regexReplacement:'aa'}).issues[0].message,/10000/);
  for(const config of [{regexPattern:'['},{regexPattern:'(?<=a)b'},{regexPattern:'(a)\\1'},{regexPattern:123},{regexPattern:'a'.repeat(1001)},{regexPattern:'a',regexReplacement:[]},{regexPattern:'a',regexReplacement:'x'.repeat(2001)},{regexReplacement:'x'},{type:'date',regexPattern:'a'}])assert.throws(()=>run('a',config),/正则/);
  assert.deepEqual(run('原文'),run('原文',{regexPattern:'',regexReplacement:''}));
});

test('regex rules on object properties and item configs persist through publish, save, copy and backup',async t=>{
  const def=definition(),props=def.fields[0].properties;
  Object.assign(props[0],{regexPattern:'^(.+)$',regexReplacement:'物料-$1'});
  Object.assign(props[2],{type:'number',regexPattern:'^8$',regexReplacement:'80'});
  props[1].itemRules=[{matchPropertyId:props[0].id,equals:'物料-机架式服务器',config:{type:'string',regexPattern:'^(.+)$',regexReplacement:'$1（已处理）'}}];
  const f=await publishedAcceptanceFixture(t,def);
  const p=await f.preview();assert.equal(p.status,200,JSON.stringify(p.data));
  assert.equal(p.data.preview.value.采购明细[0].名称,'物料-机架式服务器');assert.equal(p.data.preview.value.采购明细[0].数量,80);
  assert.match(p.data.preview.value.采购明细[0].规格,/（已处理）$/);
  const saved=await f.save(p.data);assert.equal(saved.status,200,JSON.stringify(saved.data));assert.deepEqual(saved.data.result,p.data.preview);
  const copy=await f.request(`/quality/templates/${f.row.id}/copy`,{});assert.equal(copy.status,200);assert.equal(copy.data.definition.fields[0].properties[0].regexReplacement,'物料-$1');
  assert.equal(copy.data.definition.fields[0].properties[1].itemRules[0].config.regexPattern,'^(.+)$');
  const backup=(await f.request('/backup')).data;assert.equal((await f.request('/backup/preview',{backup})).status,200);
});

test('acceptance deletion is permission and warehouse scoped, excludes chart data and preserves backup originals',async t=>{
  const f=await publishedAcceptanceFixture(t,chartDefinition());
  const first=await chartAcceptance(f,95),second=await chartAcceptance(f,99);
  const path=`/quality/acceptances/${second.id}`;
  const warehouse=(await f.request('/warehouses',{name:'删除隔离仓'})).data.id;
  assert.equal((await f.request(path,{},'DELETE',warehouse)).status,404);
  assert.equal((await f.request(path,{},'DELETE',1,'')).status,401);
  const id=(await f.request('/users',{username:'delete-worker',password:'Test-worker-123'})).data.id;
  const employee=(await f.request('/auth/login',{username:'delete-worker',password:'Test-worker-123'},'POST',1,'')).cookie;
  assert.equal((await f.request(path,{},'DELETE',1,employee)).status,403);
  const user=(await f.request('/users')).data.find(user=>user.id===id);
  await f.request(`/users/${id}/permissions`,{version:user.permissions_version,permissions:['quality']},'PUT');
  const backup=(await f.request('/backup')).data,objects=f.objects.size;
  assert.equal((await f.request(path,{},'DELETE',1,employee)).status,200);
  assert.equal((await f.request(path)).status,404);
  assert.equal((await f.request(`${path}/download`)).status,404);
  assert.equal((await f.request(path,{},'DELETE')).status,404);
  assert.equal((await f.request('/quality/acceptances')).data.total,1);
  assert.equal((await f.request(`/quality/acceptances/${first.id}`)).status,200);
  assert.deepEqual((await f.request(`/quality/chart-acceptances?template_id=${f.row.id}`)).data.acceptances.map(row=>row.id),[first.id]);
  const chart=await f.request('/quality/charts/preview',{name:'删除后统计',template_id:f.row.id,revision_id:f.row.published_revision,config:chartConfig()});
  assert.equal(chart.status,200);assert.equal(chart.data.rows[0].value,95);
  assert.equal(f.objects.size,objects);
  assert.equal((await f.request(`/quality/templates/${f.row.id}/download`)).status,200);
  const after=(await f.request('/backup')).data;
  assert.equal(after.data.quality_acceptances.length,1);
  assert.equal((await f.request('/backup/preview',{backup:after})).status,200);
  const p=await f.request('/backup/preview',{backup});
  assert.equal((await f.request('/backup/restore',{backup,...p.data,confirmation:'RESTORE_BUSINESS_DATA',request_id:randomUUID()})).status,200);
  assert.equal((await f.request(`${path}/download`)).status,200);
});
test('deleted acceptance IDs are never reused or returned for an earlier save retry',async t=>{
  const f=await publishedAcceptanceFixture(t),p=(await f.preview()).data,request_id=randomUUID();
  const saved=await f.save(p,sample,{request_id});assert.equal(saved.status,200);
  assert.equal((await f.request(`/quality/acceptances/${saved.data.id}`,{},'DELETE')).status,200);
  const next=await f.save(p);assert.equal(next.status,200);assert.ok(next.data.id>saved.data.id);
  assert.equal((await f.save(p,sample,{request_id})).status,404);
  assert.equal((await f.request('/quality/acceptances')).data.total,1);
});
