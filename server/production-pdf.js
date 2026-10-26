import { serverTranslator, isSupportedLanguage } from './i18n.js';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import {fileURLToPath} from 'node:url';

const fontPath=fileURLToPath(new URL('./assets/NotoSansCJKsc-Regular.otf',import.meta.url));
const display=value=>value===null||value===undefined||value===''?'—':String(value);
// Explicit columns are intentional: financial, inventory and registration progress fields never enter the task sheet.
export function productionTaskRows(order) {
 return (order.items||[]).map(row=>[row.name,row.barcode,row.specification,row.unit,row.planned_quantity,row.note].map(display));
}
export async function renderProductionPdf({order,warehouseName,registrationUrl,exportedAt=new Date(),language='zh-CN'}) {
 language=isSupportedLanguage(language)?language:'zh-CN';
 const t=serverTranslator(language);
 const qr=await QRCode.toBuffer(registrationUrl,{type:'png',width:600,margin:4,errorCorrectionLevel:'M'});
 const doc=new PDFDocument({size:'A4',margin:40,bufferPages:true,info:{Title:`${t('pdf.title')} ${order.number}`,Author:'77ERP'}});
 const chunks=[];const result=new Promise((resolve,reject)=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 doc.font(fontPath).fontSize(10);const left=40,width=515,bottom=770;let y=40;
 const lines=(text,maxWidth)=>{const out=[];for(const paragraph of display(text).split(/\r?\n/)){let line='';for(const character of paragraph){if(line&&doc.widthOfString(line+character)>maxWidth){const space=line.lastIndexOf(' ');if(space>0){out.push(line.slice(0,space));line=line.slice(space+1);}else{out.push(line);line='';}}line+=character;}out.push(line);}return out;};
 const page=()=>{doc.addPage();doc.font(fontPath).fontSize(10);y=40;};
 const reserve=height=>{if(y+height>bottom)page();};
 const text=(value,size=10)=>{doc.fontSize(size);for(const line of lines(value,width)){if(y+size+7>bottom)page();doc.text(line,left,y,{lineBreak:false});y+=size+7;}doc.fontSize(10);};
 text(t('pdf.title'),21);text(t('pdf.number',{value:display(order.number)}));text(t('pdf.warehouseGroup',{warehouse:display(warehouseName),group:display(order.production_group_name)}));
 if(order.status==='void'){doc.fillColor('#b91c1c');text(t('pdf.void'),14);doc.fillColor('#111111');text(t('pdf.voidReason',{value:display(order.void_reason)}));}
 text(t('pdf.product',{value:display(order.product_name)}));text(t('pdf.identity',{barcode:display(order.barcode),specification:display(order.specification)}));
 text(t('pdf.quantity',{quantity:display(order.planned_quantity),unit:display(order.unit)}));
 text(t('pdf.bom',{name:display(order.bom_name),version:display(order.bom_version),quantity:display(order.base_quantity),unit:display(order.unit)}));
 const scanTitle=t(order.operation_routes?.length ? 'pdf.scanOperations' : order.stage_workflow ? 'pdf.scanStages' : 'pdf.scan');
 const scanTitleHeight=doc.fontSize(11).heightOfString(scanTitle,{width:width-130});
 const scanInstructionsHeight=doc.fontSize(9).heightOfString(t('pdf.instructions'),{width:width-130,lineGap:6});
 const qrHeight=Math.max(127,8+scanTitleHeight+10+scanInstructionsHeight+10);
 doc.fontSize(10);y+=8;reserve(qrHeight+lines(t('pdf.address',{value:new URL(registrationUrl).origin}),width).length*16);
 const qrTop=y;doc.image(qr,left,qrTop,{width:113.4,height:113.4});
 doc.fontSize(11).text(scanTitle,left+130,qrTop+8,{width:width-130});
 doc.fontSize(9).text(t('pdf.instructions'),left+130,qrTop+8+scanTitleHeight+10,{width:width-130,lineGap:6});
 y=qrTop+qrHeight;doc.fontSize(10);text(t('pdf.address',{value:new URL(registrationUrl).origin}),9);
 y+=6;reserve(63);text(t('pdf.materials'),12);
 const widths=[108,90,89,38,60,130],headers=['materialName','materialCode','specification','unit','plannedQuantity','materialNote'].map(key=>t(`pdf.${key}`));
 const rowLine=(cells,shade=false)=>{if(shade)doc.rect(left,y,width,20).fill('#e9eef3').fillColor('#111111');let x=left;cells.forEach((cell,i)=>{doc.text(cell,x+4,y+3,{lineBreak:false});x+=widths[i];});y+=20;};
 const heading=()=>{const wrapped=headers.map((cell,i)=>lines(cell,widths[i]-8));for(let n=0;n<Math.max(...wrapped.map(cell=>cell.length));n++)rowLine(wrapped.map(cell=>cell[n]||''),true);};heading();
 for(const row of productionTaskRows(order)){
   const wrapped=row.map((cell,i)=>lines(cell,widths[i]-8)),lineCount=Math.max(...wrapped.map(a=>a.length));
   // Keep ordinary rows together. A single unusually long note may still span pages.
   const freshRowSpace=bottom-40-19-Math.max(...headers.map((cell,i)=>lines(cell,widths[i]-8).length))*20;
   if(lineCount*20<=freshRowSpace&&y+lineCount*20>bottom){page();text(t('pdf.materialsContinued'),12);heading();}
   for(let n=0;n<lineCount;n++){
     if(y+20>bottom){
       page();text(t('pdf.materialsContinued'),12);heading();
       if(n>0)rowLine([lines(t('pdf.continued',{value:row[0]}),widths[0]-8)[0],lines(row[1],widths[1]-8)[0],'','','','']);
     }
     rowLine(wrapped.map(a=>a[n]||''));
   }
   doc.moveTo(left,y).lineTo(left+width,y).strokeColor('#d8dee5').stroke();
 }
 y+=10;reserve(40);text(t('pdf.notes'),12);text(order.note);
 const exportTime=new Intl.DateTimeFormat(language==='en'?'en-GB':language==='vi'?'vi-VN':'zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(exportedAt));
 const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);doc.fontSize(8).fillColor('#555555').text(t('pdf.footer',{time:exportTime,number:order.number,page:i+1,pages:range.count}),left,790,{width,lineBreak:false});}
 doc.end();return result;
}
