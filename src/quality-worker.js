import { readQualityWorkbook } from '../shared/quality-workbook.js';
import { parseAcceptance } from '../shared/quality-acceptance.js';
import { acceptanceSheetResults, sheetUniqueKey } from '../shared/quality-bindings.js';
import { createOnlineWorkbook } from '../shared/quality-online.js';
import { readDesignerWorkbook, writeDesignerWorkbook } from '../shared/quality-designer.js';

self.onmessage = async ({data}) => {
  try {
    if(data.designer){
      const source=data.file?new Uint8Array(await data.file.arrayBuffer()):null;
      if(source)await readQualityWorkbook(source);
      if(data.designer.action==='load')self.postMessage({result:{model:await readDesignerWorkbook(source)}});
      else if(data.designer.action==='save'){
        const buffer=await writeDesignerWorkbook(source,data.designer.commands);
        const file=new File([buffer],data.designer.filename||data.defaultTemplateFilename||'在线模板.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
        self.postMessage({result:{file,filename:file.name,workbook:await readQualityWorkbook(buffer)}});
      }else throw Object.assign(new Error("不支持的模板编辑操作。"), {i18nKey:"production.export.unsupportedTemplateEditingOperation"});
      return;
    }
    let {file}=data;
    const {template,sheetNames='*',corrections,online}=data;
    if(!/\.xlsx$/i.test(file.name))throw Object.assign(new Error("请选择 .xlsx 文件。"), {i18nKey:"production.export.selectAnXlsxFile"});
    if(!file.size||file.size>10*1024*1024)throw Object.assign(new Error("请选择不超过 10 MB 的 .xlsx 文件。"), {i18nKey:"production.export.selectAnXlsxFileNoLargerThan10"});
    let generated;
    if(online){
      generated=await createOnlineWorkbook(new Uint8Array(await file.arrayBuffer()),template,online);
      file=new File([generated.buffer],online.filename||data.defaultOnlineFilename||'在线填写验收单.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    }
    const workbook=await readQualityWorkbook(new Uint8Array(await file.arrayBuffer()));
    if(!template){self.postMessage({result:{filename:file.name,workbook}});return;}
    const names=sheetNames==='*'?workbook.sheets.map(sheet=>sheet.name):sheetNames;
    const preview=parseAcceptance(template.definition,template.workbook,workbook,{sheetNames:names,corrections});
    if(new TextEncoder().encode(JSON.stringify(preview)).length>5*1024*1024)throw Object.assign(new Error("解析结果超过 5 MB，请减少填写内容或模板字段范围。"), {i18nKey:"production.export.parsedResultsExceed5MbReduceContentOr"});
    const keys=acceptanceSheetResults(template.definition,preview).map(sheet=>({sheetName:sheet.sheetName,...sheetUniqueKey(template.definition,sheet)}));
    self.postMessage({result:{filename:file.name,workbook,definition:template.definition,template:template.template,preview,sheet_names:names,keys,
      ...(generated?{file,online:generated.online}:{})}});
  }catch(error){self.postMessage({error:error.message||'无法解析 Excel 文件。', errorKey:error.i18nKey||(!error.message?"production.export.unableToParseExcelFile":undefined)});}
};
