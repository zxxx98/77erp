import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import {fileURLToPath} from 'node:url';

const fontPath=fileURLToPath(new URL('./assets/NotoSansCJKsc-Regular.otf',import.meta.url));
const display=value=>value===null||value===undefined||value===''?'—':String(value);
// Explicit columns are intentional: financial, inventory and registration progress fields never enter the task sheet.
export function productionTaskRows(order) {
 return (order.items||[]).map(row=>[row.name,row.barcode,row.specification,row.unit,row.planned_quantity,row.note].map(display));
}
export async function renderProductionPdf({order,warehouseName,registrationUrl,exportedAt=new Date()}) {
 const qr=await QRCode.toBuffer(registrationUrl,{type:'png',width:600,margin:4,errorCorrectionLevel:'M'});
 const doc=new PDFDocument({size:'A4',margin:40,bufferPages:true,info:{Title:`生产任务单 ${order.number}`,Author:'77ERP'}});
 const chunks=[];const result=new Promise((resolve,reject)=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 doc.font(fontPath).fontSize(10);const left=40,width=515,bottom=770;let y=40;
 const lines=(text,maxWidth)=>{const out=[];for(const paragraph of display(text).split(/\r?\n/)){let line='';for(const character of paragraph){if(line&&doc.widthOfString(line+character)>maxWidth){out.push(line);line='';}line+=character;}out.push(line);}return out;};
 const page=()=>{doc.addPage();doc.font(fontPath).fontSize(10);y=40;};
 const reserve=height=>{if(y+height>bottom)page();};
 const text=(value,size=10)=>{doc.fontSize(size);for(const line of lines(value,width)){if(y+size+7>bottom)page();doc.text(line,left,y,{lineBreak:false});y+=size+7;}doc.fontSize(10);};
 text('生产任务单',21);text(`单号：${display(order.number)}`);text(`仓库：${display(warehouseName)}    生产组：${display(order.production_group_name)}`);
 if(order.status==='void'){doc.fillColor('#b91c1c');text('已作废 · 此任务单不可用于生产登记',14);doc.fillColor('#111111');text(`作废原因：${display(order.void_reason)}`);}
 text(`产品：${display(order.product_name)}`);text(`编码：${display(order.barcode)}    规格：${display(order.specification)}`);
 text(`计划数量：${display(order.planned_quantity)} ${display(order.unit)}`);
 text(`BOM 快照：${display(order.bom_name)} / 版本 ${display(order.bom_version)} / 基准 ${display(order.base_quantity)} ${display(order.unit)}`);
 y+=8;reserve(127+lines(`访问地址：${new URL(registrationUrl).origin}`,width).length*16);
 const qrTop=y;doc.image(qr,left,qrTop,{width:113.4,height:113.4});
 doc.fontSize(11).text('扫码打开生产登记',left+130,qrTop+8,{width:width-130});
 doc.fontSize(9).text('请使用有权限的账号登录，核对生产单后登记。\n手机必须能访问生成此任务单的服务器地址。\n扫码仅打开表单，不会自动提交。',left+130,qrTop+32,{width:width-130,lineGap:6});
 y=qrTop+127;doc.fontSize(10);text(`访问地址：${new URL(registrationUrl).origin}`,9);
 y+=6;reserve(63);text('计划用料（保存时的 BOM 快照）',12);
 const widths=[108,90,89,38,60,130],headers=['物料名称','物料编码','规格','单位','计划用量','材料备注'];
 const rowLine=(cells,shade=false)=>{if(shade)doc.rect(left,y,width,20).fill('#e9eef3').fillColor('#111111');let x=left;cells.forEach((cell,i)=>{doc.text(cell,x+4,y+3,{lineBreak:false});x+=widths[i];});y+=20;};
 const heading=()=>rowLine(headers,true);heading();
 for(const row of productionTaskRows(order)){
   const wrapped=row.map((cell,i)=>lines(cell,widths[i]-8)),lineCount=Math.max(...wrapped.map(a=>a.length));
   // Keep ordinary rows together. A single unusually long note may still span pages.
   const freshRowSpace=bottom-40-19-20;
   if(lineCount*20<=freshRowSpace&&y+lineCount*20>bottom){page();text('计划用料（续）',12);heading();}
   for(let n=0;n<lineCount;n++){
     if(y+20>bottom){
       page();text('计划用料（续）',12);heading();
       if(n>0)rowLine([lines(`（续）${row[0]}`,widths[0]-8)[0],lines(row[1],widths[1]-8)[0],'','','','']);
     }
     rowLine(wrapped.map(a=>a[n]||''));
   }
   doc.moveTo(left,y).lineTo(left+width,y).strokeColor('#d8dee5').stroke();
 }
 y+=10;reserve(40);text('生产备注',12);text(order.note);
 const exportTime=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(exportedAt));
 const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);doc.fontSize(8).fillColor('#555555').text(`导出：${exportTime}（北京时间）  单号：${order.number}  第 ${i+1} / ${range.count} 页`,left,790,{width,lineBreak:false});}
 doc.end();return result;
}
