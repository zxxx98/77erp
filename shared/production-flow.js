import { exactQuantity, exactAdd, exactSubtract, exactMax, exactMin, exactCompare, exactSum, quantityFields, parseProductionQuantity } from './exact-quantity.js';
import { productionRouteProgress } from './process-routes.js';
import { stagePoolPaths } from './production-pools.js';
import { registrationRequirements } from './production-registration-issues.js';
import { postProcessingLimit, productionOutputCompleted } from './post-processing.js';

// Flow is a projection of confirmed shop-floor work. Accounting quantities and
// FIFO/cost ledgers remain unchanged until the original registrations settle.
export function productionFlowProgress(order, registrations) {
  const ready = registrations.filter(r => r.status === 'pending' && (r.kind === 'settlement' || r.acceptance_id != null)).sort((a,b)=>a.id-b.id);
  const parts = ready.flatMap(r => {
    const body = typeof r.body === 'string' ? JSON.parse(r.body) : r.body;
    return (body.auto_overflow && r.endpoint === 'stages/complete' ? body.allocations : [body]).map(part => ({...body,...part,endpoint:r.endpoint,path:part.path ?? body.path ?? '',node_id:part.operation_node_id ?? body.operation_node_id,
      quantity:parseProductionQuantity(part.completed_quantity ?? part.quantity,true)}));
  });
  const outputs = parts.filter(p => p.endpoint !== 'operations/report');
  const completed = exactAdd(exactQuantity(order,'completed_quantity'),exactSum(outputs.filter(p=>p.path==='')));
  const stages = (order.stages || []).map(stage => {
    const own = outputs.filter(p=>p.path===stage.path);
    return {...stage,...quantityFields(exactAdd(exactQuantity(stage,'completed_quantity'),exactSum(own)),'completed_quantity'),
      ...quantityFields(exactAdd(exactQuantity(stage,'available_quantity'),exactSum(own)),'available_quantity')};
  });
  // Pool demand must be subtracted once, even if its source path differs.
  for(const part of outputs) for(const input of part.items||[]) {
    const source=order.stages?.find(s=>s.path===part.path)?.items.find(n=>n.path===input.path);
    if(source?.usage_mode!=='explode') continue;
    let needed=exactQuantity(input);
    for(const path of stagePoolPaths(order,input.path)) {
      const stage=stages.find(s=>s.path===path);
      const used=exactMin(needed,exactQuantity(stage,'available_quantity'));
      Object.assign(stage,quantityFields(exactSubtract(exactQuantity(stage,'available_quantity'),used),'available_quantity'),
        quantityFields(exactAdd(exactQuantity(stage,'consumed_quantity'),used),'consumed_quantity'));
      needed=exactSubtract(needed,used);
      if(exactCompare(needed,0)===0) break;
    }
  }
  for(const stage of stages) stage.items=stage.items.map(item=>item.usage_mode!=='explode'?item:{...item,
    ...quantityFields(exactSum(stagePoolPaths(order,item.path).map(path=>stages.find(s=>s.path===path)),'available_quantity'),'available_quantity')});
  const routes = (order.operation_routes||[]).map(route => {
    const paths = route.product_coefficient == null ? stagePoolPaths(order,route.path) : [route.path];
    const reports = route.operations.map(n=>({node_id:n.id,...quantityFields(exactQuantity(n,'completed_quantity')),status:'active'}));
    reports.push(...parts.filter(p=>paths.includes(p.path)).map(p=>({node_id:p.node_id,...quantityFields(p.quantity),status:'active'})));
    const projected = {...route,...(route.product_coefficient == null ? {} : {post_processing_limit:postProcessingLimit(completed,route.product_coefficient,productionOutputCompleted(order,completed),route.graph)})};
    return {...projected,operations:productionRouteProgress(projected,reports)};
  });
  const claimed=new Map();
  let settlement_ready=ready.length===registrations.filter(r=>r.status==='pending').length;
  for(const row of ready) for(const requirement of registrationRequirements(order,JSON.parse(row.body),row.endpoint)) {
    if(!['material','semi'].includes(requirement.kind)) continue;
    const needed=exactAdd(claimed.get(requirement.key)??0,requirement.quantity);
    claimed.set(requirement.key,needed);
    const supply=requirement.kind==='semi'?exactSum(outputs.filter(p=>stagePoolPaths(order,requirement.path).includes(p.path))):0;
    if(exactCompare(needed,exactAdd(requirement.available,supply))>0) settlement_ready=false;
  }
  for(const route of routes) for(const node of route.operations) {
    for(const parent of node.predecessors||[]) if(exactCompare(exactQuantity(node,'completed_quantity'),exactQuantity(route.operations.find(n=>n.id===parent),'completed_quantity'))>0) settlement_ready=false;
    if(route.product_coefficient!=null && exactCompare(exactQuantity(node,'completed_quantity'),route.post_processing_limit)>0) settlement_ready=false;
  }
  return {...quantityFields(completed,'completed_quantity'),output_completed:productionOutputCompleted(order,completed),settlement_ready,stages,operation_routes:routes};
}

// Only presentation and registration defaults use this view, never accounting.
const flowViews = new WeakMap();
export function productionFlowView(order) {
  if (!order.flow_progress || order.is_flow_view) return order;
  if(!flowViews.has(order)) flowViews.set(order,{...order,...order.flow_progress,is_flow_view:true});
  return flowViews.get(order);
}
