import test from 'node:test';
import assert from 'node:assert/strict';
import { sheetPreviewBounds } from '../shared/quality-sheet-view.js';

const sheet=changes=>({rows:30,cols:12,widths:Array.from({length:12},(_,i)=>80+i),cells:{B2:{text:'标题'},F6:{value:0,text:'0'},H20:{text:' \n ',value:' \n '}},merges:[],...changes});
test('preview drops trailing empty space, keeps internal blank coordinates and does not mutate the workbook',()=>{
  const source=sheet(),before=structuredClone(source);
  assert.deepEqual(sheetPreviewBounds(source),{rows:6,cols:6,widths:source.widths.slice(0,6)});
  assert.deepEqual(source,before);
});
test('zero, false and formula errors remain in the visible area even without display text',()=>{
  for(const cell of [{value:0,text:''},{value:false,text:''},{text:'',error:'公式缺少缓存值'}]){
    assert.equal(sheetPreviewBounds(sheet({cells:{J9:cell}})).cols,10);
    assert.equal(sheetPreviewBounds(sheet({cells:{J9:cell}})).rows,9);
  }
});
test('merged cells and explicitly configured empty regions remain fully visible',()=>{
  const source=sheet({merges:['B2:H3']});
  assert.equal(sheetPreviewBounds(source).cols,8);
  assert.deepEqual(sheetPreviewBounds(source,['J12:K14','B','Z999']),{rows:30,cols:12,widths:source.widths});
  assert.deepEqual(sheetPreviewBounds(source,['J12:K14','B']),{rows:14,cols:11,widths:source.widths.slice(0,11)});
});
test('a blank worksheet retains one cell without adding a padded grid',()=>{
  assert.deepEqual(sheetPreviewBounds(sheet({cells:{}})),{rows:1,cols:1,widths:[80]});
  assert.equal(sheetPreviewBounds(null),null);
});
