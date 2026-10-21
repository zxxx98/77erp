import { readQualityWorkbook } from '../shared/quality-workbook.js';
import { parseAcceptance } from '../shared/quality-acceptance.js';
import { acceptanceSheetResults, sheetUniqueKey } from '../shared/quality-bindings.js';

self.onmessage = async ({data}) => {
  try {
    const {file,template,sheetNames='*',corrections}=data;
    if(!/\.xlsx$/i.test(file.name))throw new Error('请选择 .xlsx 文件。');
    if(!file.size||file.size>10*1024*1024)throw new Error('请选择不超过 10 MB 的 .xlsx 文件。');
    const workbook=await readQualityWorkbook(new Uint8Array(await file.arrayBuffer()));
    if(!template){self.postMessage({result:{filename:file.name,workbook}});return;}
    const names=sheetNames==='*'?workbook.sheets.map(sheet=>sheet.name):sheetNames;
    const preview=parseAcceptance(template.definition,template.workbook,workbook,{sheetNames:names,corrections});
    if(new TextEncoder().encode(JSON.stringify(preview)).length>5*1024*1024)throw new Error('解析结果超过 5 MB，请减少填写内容或模板字段范围。');
    const keys=acceptanceSheetResults(template.definition,preview).map(sheet=>({sheetName:sheet.sheetName,...sheetUniqueKey(template.definition,sheet)}));
    self.postMessage({result:{filename:file.name,workbook,definition:template.definition,template:template.template,preview,sheet_names:names,keys}});
  }catch(error){self.postMessage({error:error.message||'无法解析 Excel 文件。'});}
};
