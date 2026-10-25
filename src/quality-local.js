import { productionMessage } from './i18n/production-errors.js';
import { t as pt, getLocale } from './i18n/index.js';
// Keep Excel decompression and parsing off the UI thread, including mobile browsers.
export function parseQualityFile(file, template, sheetNames, corrections, online) {
  return qualityWorker({file,template,sheetNames,corrections,online});
}
export function designQualityFile(file,designer) {
  return qualityWorker({file,designer});
}
function qualityWorker(payload) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./quality-worker.js',import.meta.url),{type:'module'});
    const finish=()=>{clearTimeout(timer);worker.terminate();};
    const timer=setTimeout(()=>{finish();reject(new Error(pt("production.export.excelParsingTimedOutReduceFileContentAnd")));},60000);
    worker.onmessage=({data})=>{finish();if(data.error)reject(new Error(data.errorKey ? pt(data.errorKey) : productionMessage(data.error)));else resolve(data.result);};
    worker.onerror=()=>{finish();reject(new Error(pt("production.export.unableToStartExcelParsingRefreshThePage")));};
    worker.postMessage({...payload, language:getLocale(), defaultTemplateFilename:pt("production.export.onlineTemplateXlsx"), defaultOnlineFilename:pt("production.export.onlineAcceptanceXlsx")});
  });
}
