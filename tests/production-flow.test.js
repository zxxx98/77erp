import {test} from 'node:test';
import assert from 'node:assert/strict';
import {productionFlowProgress,productionFlowView} from '../shared/production-flow.js';
import {exactQuantity,exactSum} from '../shared/exact-quantity.js';

test('pending work shares exact fractional semi-finished balances once across equivalent paths',()=>{
  const material={product_id:3,name:'原料',unit:'kg',available_quantity:0,usage_mode:'stock'};
  const semi=path=>({path,parent_path:'',product_id:2,bom_id:2,bom_version:1,base_quantity:1,unit:'kg',completed_quantity:0,available_quantity:0,consumed_quantity:0,items:[{...material,path:`${path}.1`}]});
  const inputs=['1','2'].map(path=>({path,product_id:2,name:'半成品',unit:'kg',usage_mode:'explode',available_quantity:0}));
  const order={completed_quantity:0,planned_quantity:1,status:'in_progress',items:[material],operation_routes:[],
    stages:[{path:'',completed_quantity:0,available_quantity:0,consumed_quantity:0,items:inputs},semi('1'),semi('2')],
    nodes:['1','2'].flatMap(path=>[{path,parent_path:'',product_id:2,usage_mode:'explode'}, {path:`${path}.1`,parent_path:path,product_id:3,quantity:1,unit:'kg',usage_mode:'stock'}])};
  const pending=(id,path,quantity,items,extra={})=>({id,path,endpoint:'stages/complete',status:'pending',kind:'settlement',acceptance_id:null,body:JSON.stringify({path,completed_quantity:quantity,items}),...extra});
  const registrations=[pending(1,'1','1/3',[{path:'1.1',quantity:'1/3'}]),pending(2,'','1/6',[{path:'2',quantity:'1/6'}]),
    pending(3,'2',1,[{path:'2.1',quantity:1}],{kind:'acceptance'})];
  const flow=productionFlowProgress(order,registrations);
  assert.equal(flow.completed_quantity_fraction,'1/6');
  assert.equal(exactSum(flow.stages.slice(1),'available_quantity'),'1/6');
  assert.equal(flow.stages[0].items[0].available_quantity_fraction,'1/6');
  assert.equal(flow.stages[0].items[1].available_quantity_fraction,'1/6');
  assert.equal(flow.stages[2].completed_quantity,0);
  assert.equal(flow.settlement_ready,false);
  assert.equal(order.stages[1].completed_quantity,0);
  const withFlow={...order,flow_progress:flow};
  assert.equal(productionFlowView(withFlow),productionFlowView(withFlow));
  assert.equal(exactQuantity(productionFlowView(withFlow),'completed_quantity'),'1/6');
  assert.equal(productionFlowView(productionFlowView(withFlow)),productionFlowView(withFlow));
});
