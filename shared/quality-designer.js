import { cellAddress, parseRegion, regionAddress } from './quality-template.js';
import { cellStyle } from './quality-online.js';

const blankSheet=()=>({name:'检验模板',rows:20,cols:8,cells:{},merges:[],widths:Array(8).fill(112),heights:{}});
export const blankDesigner=()=>({sheets:[blankSheet()]});
const overlaps=(a,b)=>a.r1<=b.r2&&a.r2>=b.r1&&a.c1<=b.c2&&a.c2>=b.c1;
export function designerRegion(sheet,region) {
  let rect=parseRegion(region),expanded=true;
  if(rect.r2>sheet.rows||rect.c2>sheet.cols)throw new Error('所选区域超出当前表格。');
  while(expanded){expanded=false;for(const merge of sheet.merges.map(parseRegion))if(overlaps(rect,merge)){
    const next={r1:Math.min(rect.r1,merge.r1),r2:Math.max(rect.r2,merge.r2),c1:Math.min(rect.c1,merge.c1),c2:Math.max(rect.c2,merge.c2)};
    if(regionAddress(next)!==regionAddress(rect)){rect=next;expanded=true;}
  }}
  return rect;
}
function logicalCells(sheet,rect) {
  const merges=new Map(),result=[];
  for(const merge of sheet.merges.map(parseRegion))if(overlaps(rect,merge))for(let row=merge.r1;row<=merge.r2;row++)for(let col=merge.c1;col<=merge.c2;col++)merges.set(cellAddress(row,col),merge);
  for(let row=rect.r1;row<=rect.r2;row++)for(let col=rect.c1;col<=rect.c2;col++){
    const cell=merges.get(cellAddress(row,col))||{r1:row,r2:row,c1:col,c2:col};
    if(cell.r1===row&&cell.c1===col)result.push(cell);
  }
  return result;
}
function borderFormat(rect,selection,mode) {
  const line={style:'thin',color:{argb:'FF64748B'}},border={};
  for(const [side,edge] of [['top','r1'],['bottom','r2'],['left','c1'],['right','c2']])
    border[side]=mode==='all'||mode==='outer'&&rect[edge]===selection[edge]?line:{};
  return border;
}
function patchFormat(format={},patch) {
  if(!patch||Object.keys(patch).some(key=>!['font','alignment','fill'].includes(key)))throw new Error('格式设置无效。');
  if(patch.font?.size!==undefined&&(!Number.isFinite(patch.font.size)||patch.font.size<6||patch.font.size>96))throw new Error('字号需要为 6–96。');
  return {...format,...patch,...(patch.font?{font:{...format.font,...patch.font}}:{}),...(patch.alignment?{alignment:{...format.alignment,...patch.alignment}}:{})};
}

// A small immutable document drives preview and undo; the same commands generate XLSX in a worker.
export function changeDesigner(model,command) {
  const index=model.sheets.findIndex(sheet=>sheet.name===command.sheetName);
  if(index<0)throw new Error('工作表不存在。');
  const original=model.sheets[index],sheet={...original,cells:{...original.cells},merges:[...original.merges],widths:[...original.widths],heights:{...original.heights}};
  if(command.type==='rename'){
    const name=String(command.name||'').trim();
    if(name!==sheet.name&&model.sheets.some(s=>s.hasFormulas))throw new Error('含公式的工作簿暂不支持在线重命名工作表，请保留原名称。');
    if(!name||name.length>31||/[\\/*?:\[\]]/.test(name)||/^'|'$/.test(name)||model.sheets.some((s,i)=>i!==index&&s.name.toLowerCase()===name.toLowerCase()))throw new Error('工作表名称无效或重复（最多 31 字，不能含 / \\ * ? : [ ]）。');
    sheet.name=name;
  }else if(command.type==='resize'){
    const {rows,cols}=command;
    if(!Number.isInteger(rows)||rows<1||rows>1997||!Number.isInteger(cols)||cols<1||cols>98||Math.max(25,rows+3)*Math.max(8,cols+2)>50000)throw new Error('表格范围过大，最多 1997 行、98 列、50000 格（含预览边缘）。');
    if(Object.entries(sheet.cells).some(([address,cell])=>{const r=parseRegion(address);return (r.r1>rows||r.c1>cols)&&(!!cell.text||cell.hasFormula);})||sheet.merges.some(address=>{const r=parseRegion(address);return r.r2>rows||r.c2>cols;}))throw new Error('缩小范围会移除内容或合并单元格，请先清空内容并取消对应合并。');
    sheet.rows=rows;sheet.cols=cols;sheet.widths=Array.from({length:cols},(_,i)=>sheet.widths[i]||112);
    for(const address of Object.keys(sheet.cells)){const r=parseRegion(address);if(r.r1>rows||r.c1>cols)delete sheet.cells[address];}
    for(const row of Object.keys(sheet.heights))if(Number(row)>rows)delete sheet.heights[row];
  }else{
    const rect=designerRegion(sheet,command.region),cells=logicalCells(sheet,rect);
    if(command.type==='merge'){
      const anchor=cellAddress(rect.r1,rect.c1);
      if(rect.r1===rect.r2&&rect.c1===rect.c2)throw new Error('请选择至少两个单元格再合并。');
      if(cells.some(cell=>{const address=cellAddress(cell.r1,cell.c1),value=sheet.cells[address];return address!==anchor&&(!!value?.text||value?.hasFormula);}))throw new Error('合并区域中有其他内容，请仅保留左上角内容后再合并。');
      sheet.merges=sheet.merges.filter(address=>!overlaps(rect,parseRegion(address))).concat(regionAddress(rect));
      for(let row=rect.r1;row<=rect.r2;row++)for(let col=rect.c1;col<=rect.c2;col++){const address=cellAddress(row,col);if(address!==anchor)delete sheet.cells[address];}
    }else if(command.type==='unmerge')sheet.merges=sheet.merges.filter(address=>!overlaps(rect,parseRegion(address)));
    else if(command.type==='rowHeight'||command.type==='columnWidth'){
      const row=command.type==='rowHeight',min=row?20:40,max=row?240:480;
      if(!Number.isFinite(command.value)||command.value<min||command.value>max)throw new Error(`${row?'行高':'列宽'}需要为 ${min}–${max} 像素。`);
      for(let i=row?rect.r1:rect.c1;i<=(row?rect.r2:rect.c2);i++)if(row)sheet.heights[i]=command.value;else sheet.widths[i-1]=command.value;
    }else if(['text','clear','format','border'].includes(command.type)){
      if(command.type==='text'&&(typeof command.text!=='string'||command.text.length>10000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(command.text)))throw new Error('单元格内容无效或超过 10000 字。');
      if(command.type==='border'&&!['all','outer','none'].includes(command.mode))throw new Error('边框设置无效。');
      for(const cell of command.type==='text'?[cells[0]]:cells){
        const address=cellAddress(cell.r1,cell.c1),previous=sheet.cells[address]||{text:'',format:{}};
        sheet.cells[address]={...previous,...(command.type==='text'||command.type==='clear'?{text:command.type==='clear'?'':command.text,hasFormula:false}:{}),
          ...(command.type==='format'?{format:patchFormat(previous.format,command.patch)}:{}),
          ...(command.type==='border'?{format:{...previous.format,border:borderFormat(cell,rect,command.mode)}}:{})};
      }
    }else throw new Error('不支持的表格操作。');
  }
  return {...model,sheets:model.sheets.map((s,i)=>i===index?sheet:s)};
}

async function loadBook(source) {
  const ExcelJS=(await import('exceljs')).default,book=new ExcelJS.Workbook();
  if(source)await book.xlsx.load(source);else book.addWorksheet('检验模板');
  return book;
}
function bookModel(book,source) {
  if(!source)return blankDesigner();
  return {sheets:book.worksheets.map(sheet=>{
    const cells={},heights={};let hasFormulas=false;
    sheet.eachRow({includeEmpty:true},row=>{if(row.height)heights[row.number]=row.height*4/3;row.eachCell({includeEmpty:true},cell=>{
      if(cell.isMerged&&cell.master.address!==cell.address)return;
      const value=cell.value;
      if(value?.formula||value?.sharedFormula)hasFormulas=true;
      cells[cell.address]={text:value instanceof Date?value.toISOString().slice(0,10):cell.text,hasFormula:!!(value?.formula||value?.sharedFormula),
        format:JSON.parse(JSON.stringify({font:cell.font||{},alignment:cell.alignment||{},fill:cell.fill||{},border:cell.border||{}}))};
    });});
    const rows=Math.max(1,sheet.rowCount),cols=Math.max(1,sheet.columnCount);
    return {name:sheet.name,rows,cols,cells,merges:sheet.model.merges||[],heights,hasFormulas,widths:Array.from({length:cols},(_,i)=>(sheet.getColumn(i+1).width||16)*7)};
  })};
}
export async function readDesignerWorkbook(source) {const book=await loadBook(source);return bookModel(book,source);}
export const designerCellStyle=cell=>({...cellStyle(cell?.format||{}),whiteSpace:cell?.format?.alignment?.wrapText?'pre-wrap':'pre'});
export function designerDefinition(definition,commands) {
  let result=structuredClone(definition);
  for(const command of commands)if(command.type==='rename'&&result.sheetName===command.sheetName)result.sheetName=command.name.trim();
  return result;
}

export async function writeDesignerWorkbook(source,commands) {
  if(!Array.isArray(commands)||commands.length>10000)throw new Error('编辑操作过多，请先保存后继续。');
  const book=await loadBook(source);let model=bookModel(book,source),valuesChanged=false;
  // Resolve shared formula addresses before edits can replace their masters.
  const formulas=[];
  for(const sheet of book.worksheets)sheet.eachRow(row=>row.eachCell(cell=>{if(cell.isMerged&&cell.master.address!==cell.address)return;if(cell.value?.formula||cell.value?.sharedFormula)formulas.push([cell,cell.formula]);}));
  for(const command of commands){
    const before=model.sheets.find(sheet=>sheet.name===command.sheetName);
    const next=changeDesigner(model,command),after=next.sheets.find(sheet=>sheet.name===(command.type==='rename'?command.name.trim():command.sheetName));
    const sheet=book.getWorksheet(command.sheetName);
    if(command.type==='rename')sheet.name=after.name;
    else if(command.type==='resize'){
      // ExcelJS tail splices can leave the last row/cell in place. Clear the
      // discarded tail explicitly; retained cells and merges never move.
      for(let row=after.rows+1;row<=before.rows;row++){
        const discarded=sheet.getRow(row);discarded.values=[];discarded.height=undefined;discarded.style={};
      }
      if(after.cols<before.cols){
        for(let col=after.cols+1;col<=before.cols;col++)sheet.getColumn(col).defn=null;
        for(let row=1;row<=Math.min(before.rows,after.rows);row++)for(let col=after.cols+1;col<=before.cols;col++){
          const discarded=sheet.getCell(row,col);discarded.value=null;discarded.style={};discarded.note=undefined;
        }
      }
      valuesChanged=true;
    }else{
      const rect=designerRegion(before,command.region);
      if(command.type==='merge'||command.type==='unmerge'){
        for(const address of before.merges)if(overlaps(rect,parseRegion(address)))sheet.unMergeCells(address);
        if(command.type==='merge')sheet.mergeCells(regionAddress(rect));
        valuesChanged=true;
      }else if(command.type==='rowHeight')for(let row=rect.r1;row<=rect.r2;row++)sheet.getRow(row).height=command.value*3/4;
      else if(command.type==='columnWidth')for(let col=rect.c1;col<=rect.c2;col++)sheet.getColumn(col).width=command.value/7;
      else for(const logical of command.type==='text'?logicalCells(before,rect).slice(0,1):logicalCells(before,rect)){
        const address=cellAddress(logical.r1,logical.c1),cell=sheet.getCell(address),value=after.cells[address];
        if(command.type==='text'||command.type==='clear'){cell.value=value.text||null;valuesChanged=true;}
        if(command.type==='format'||command.type==='border'){
          cell.font=value.format.font||{};cell.alignment=value.format.alignment||{};cell.fill=value.format.fill||{};cell.border=value.format.border||{};
        }
      }
    }
    model=next;
  }
  if(valuesChanged){
    for(const [cell,formula] of formulas)if(cell.value?.formula||cell.value?.sharedFormula)cell.value={formula};
    book.calcProperties.fullCalcOnLoad=true;
  }
  for(const sheetModel of model.sheets){
    const sheet=book.getWorksheet(sheetModel.name);
    sheetModel.widths.forEach((width,i)=>sheet.getColumn(i+1).width=width/7);
    if(!sheet.getRow(sheetModel.rows).height)sheet.getRow(sheetModel.rows).height=24;
    // Keep explicitly added blank input rows/columns addressable after XLSX reload.
    const corner=sheet.getCell(sheetModel.rows,sheetModel.cols);
    if(corner.value===null&&!corner.isMerged)corner.value='';
  }
  const buffer=new Uint8Array(await book.xlsx.writeBuffer());
  if(buffer.length>10*1024*1024)throw new Error('生成的模板超过 10 MB。');
  return buffer;
}

export function inspectionDesigner() {
  const commands=[],sheetName='检验模板';
  const add=command=>commands.push({sheetName,...command});
  for(const region of ['A1:H1','B3:D3','F3:H3','B4:D4','F4:H4','A6:H6','B13:D13','F13:H13'])add({type:'merge',region});
  for(const [region,text] of Object.entries({A1:'产品质量检验记录单',A3:'检验单号',E3:'检验日期',A4:'产品名称',E4:'批次数量',A6:'检验明细',A7:'检验项目',B7:'规格要求',C7:'实测值',D7:'判定',E7:'检验员',F7:'备注',A13:'综合判定',E13:'检验员'}))add({type:'text',region,text});
  add({type:'format',region:'A1:H1',patch:{font:{size:22,bold:true},alignment:{horizontal:'center',vertical:'middle'}}});
  add({type:'rowHeight',region:'A1',value:56});
  add({type:'format',region:'A6:H7',patch:{font:{bold:true},fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FFEAF0F8'}}}});
  add({type:'border',region:'A3:H13',mode:'all'});
  const fields=[
    {id:'code',name:'检验单号',labelRegion:'A3',valueRegion:'B3:D3',type:'uniqueKey',required:true},
    {id:'date',name:'检验日期',labelRegion:'E3',valueRegion:'F3:H3',type:'date',dateFormat:'YYYY-MM-DD',required:true},
    {id:'product',name:'产品名称',labelRegion:'A4',valueRegion:'B4:D4',type:'string',required:true},
    {id:'quantity',name:'批次数量',labelRegion:'E4',valueRegion:'F4:H4',type:'number',required:true},
    {id:'items',name:'检验明细',labelRegion:'A6:H6',propertyRegion:'A7:F7',valueRegion:'A8:F11',type:'object',required:true,properties:['检验项目','规格要求','实测值','判定','检验员','备注'].map((name,i)=>({id:`item${i}`,name,type:'string',required:i===0}))},
    {id:'result',name:'综合判定',labelRegion:'A13',valueRegion:'B13:D13',type:'string',required:true},
    {id:'inspector',name:'检验员',labelRegion:'E13',valueRegion:'F13:H13',type:'string',required:true},
  ];
  return {commands,model:commands.reduce(changeDesigner,blankDesigner()),definition:{schemaVersion:1,sheetName,fields}};
}
