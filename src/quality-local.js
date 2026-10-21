// Keep Excel decompression and parsing off the UI thread, including mobile browsers.
export function parseQualityFile(file, template, sheetNames, corrections) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./quality-worker.js',import.meta.url),{type:'module'});
    const finish=()=>{clearTimeout(timer);worker.terminate();};
    const timer=setTimeout(()=>{finish();reject(new Error('Excel 解析超时，请减少文件内容后重试。'));},60000);
    worker.onmessage=({data})=>{finish();if(data.error)reject(new Error(data.error));else resolve(data.result);};
    worker.onerror=()=>{finish();reject(new Error('无法启动 Excel 解析，请刷新页面后重试。'));};
    worker.postMessage({file,template,sheetNames,corrections});
  });
}
