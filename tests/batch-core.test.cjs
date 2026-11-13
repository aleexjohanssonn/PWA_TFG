const {test} = require('node:test');
const assert = require('node:assert/strict');
const C = require('../batch-production/core.js');
function command(state, type, data) { return C.apply(state, type, data); }
function base() {
 let s = C.empty();
 let r = command(s, 'product', {name:'Vela 100 g'}); s = r.state; const productId = r.result.id;
 r = command(s, 'purchase', {name:'Cera', qty:3, unit:'kg', payment:300});
 return {state:r.state, productId, materialId:r.result.materialId};
}
function production(b, qty=30, materialQty=3, minutes=180) {
 return command(b.state, 'produce', {productId:b.productId, qty, minutes, materials:[{materialId:b.materialId, qty:materialQty}]}).state;
}
test('worked example: material transformation and partial paid sale', () => {
 const b=base(); let s=production(b);
 assert.equal(s.materials[0].qty,0); assert.equal(C.stock(s,b.productId),30); assert.equal(C.totals(s).cashCents,-30000);
 const r=command(s,'sell',{productId:b.productId,qty:8,payment:400,minutes:12}); s=r.state;
 assert.equal(C.stock(s,b.productId),22); assert.equal(s.batches[0].remainingCostCents,22000);
 assert.equal(s.batches[0].remainingTimeSeconds,7920);
 assert.deepEqual(C.saleTotals(r.result), {costCents:8000,productionSeconds:2880,seconds:3600,netCents:32000,hourlyCents:32000});
 assert.deepEqual(C.totals(s),{incomingCents:40000,outgoingCents:30000,cashCents:10000});
});
test('failed overconsumption is aggregated and never mutates the input',()=>{
 const b=base(), before=JSON.stringify(b.state);
 assert.throws(()=>command(b.state,'produce',{productId:b.productId,qty:30,minutes:180,materials:[{materialId:b.materialId,qty:2},{materialId:b.materialId,qty:2}]}),/suficiente/);
 assert.equal(JSON.stringify(b.state),before);
});
test('failed overselling leaves all state unchanged',()=>{
 const b=base(), s=production(b), before=JSON.stringify(s);
 assert.throws(()=>command(s,'sell',{productId:b.productId,qty:31,payment:400,minutes:0}),/suficientes/);
 assert.equal(JSON.stringify(s),before);
});
test('FIFO spans two batches with different original prices',()=>{
 const b=base(); let s=production(b,3,0.3,30);
 s=command(s,'purchase',{name:'Cera',qty:3,unit:'kg',payment:360}).state;
 // Remaining raw stock is weighted average: 270 + 360 for 5.7 kg.
 const r=command(s,'produce',{productId:b.productId,qty:5,minutes:50,materials:[{materialId:b.materialId,qty:0.5}]});s=r.state;
 const sale=command(s,'sell',{productId:b.productId,qty:4,payment:200,minutes:0});
 assert.equal(sale.result.allocations.length,2); assert.equal(sale.result.allocations[0].batchId,s.batches[0].id);
 assert.equal(sale.result.allocations[0].qty,3); assert.equal(sale.result.allocations[1].qty,1);
 assert.equal(C.saleTotals(sale.result).costCents,3000+Math.round(r.result.costCents/5));
 assert.equal(sale.state.batches[1].remainingQty,4);
});
test('later purchase does not rewrite recorded production or sale costs',()=>{
 const b=base(); let s=production(b);s=command(s,'sell',{productId:b.productId,qty:8,payment:400,minutes:0}).state;
 const before=JSON.stringify({b:s.batches,s:s.sales});
 s=command(s,'purchase',{name:'Cera',qty:3,unit:'kg',payment:600}).state;
 assert.equal(JSON.stringify({b:s.batches,s:s.sales}),before);
});
test('sale cancellation restores its original exact cost, time, quantity and cash',()=>{
 const b=base();let s=production(b);const before=JSON.stringify(s.batches);
 const sold=command(s,'sell',{productId:b.productId,qty:8,payment:400,minutes:12});s=sold.state;
 s=command(s,'purchase',{name:'Cera',qty:3,unit:'kg',payment:600}).state;
 s=command(s,'cancelSale',{id:sold.result.id}).state;
 assert.equal(JSON.stringify(s.batches),before);assert.equal(C.totals(s).incomingCents,0);
 assert.throws(()=>command(s,'cancelSale',{id:sold.result.id}),/activa/);
});
test('dependent production cannot be cancelled until its sale is reversed',()=>{
 const b=base();let s=production(b);const batchId=s.batches[0].id;
 const sold=command(s,'sell',{productId:b.productId,qty:8,payment:400,minutes:12});s=sold.state;
 assert.throws(()=>command(s,'cancelProduction',{id:batchId}),/ventas/);
 s=command(s,'cancelSale',{id:sold.result.id}).state;
 s=command(s,'cancelProduction',{id:batchId}).state;
 assert.equal(s.materials[0].qty,3);assert.equal(s.materials[0].valueCents,30000);assert.equal(C.stock(s,b.productId),0);
 assert.equal(s.batches[0].remainingCostCents,0);
});
test('rounding conserves every cent and second when all items are sold',()=>{
 let s=C.empty(),r=command(s,'product',{name:'Pieza'});s=r.state;const id=r.result.id;
 r=command(s,'purchase',{name:'Material',qty:1,unit:'unidades',payment:0.01});s=r.state;
 s=command(s,'produce',{productId:id,qty:7,minutes:1,materials:[{materialId:r.result.materialId,qty:1}]}).state;
 for(let i=0;i<7;i++)s=command(s,'sell',{productId:id,qty:1,payment:1,minutes:0}).state;
 assert.equal(s.sales.reduce((sum,sale)=>sum+C.saleTotals(sale).costCents,0),1);
 assert.equal(s.sales.reduce((sum,sale)=>sum+C.saleTotals(sale).productionSeconds,0),60);
 assert.equal(s.batches[0].remainingQty+s.batches[0].remainingCostCents+s.batches[0].remainingTimeSeconds,0);
});
test('a cancelled sale can be resold after subsequent sales without losing value',()=>{
 const b=base();let s=production(b,7,3,1);
 const first=command(s,'sell',{productId:b.productId,qty:2,payment:100,minutes:0});s=first.state;
 s=command(s,'sell',{productId:b.productId,qty:3,payment:100,minutes:0}).state;
 s=command(s,'cancelSale',{id:first.result.id}).state;
 s=command(s,'sell',{productId:b.productId,qty:4,payment:100,minutes:0}).state;
 assert.equal(C.stock(s,b.productId),0);assert.equal(s.batches[0].remainingCostCents,0);C.validate(s);
});
test('unit mismatch and malformed numbers are rejected',()=>{
 const b=base();
 assert.throws(()=>command(b.state,'purchase',{name:'cera',qty:500,unit:'gramos',payment:5}),/unidad/);
 for(const qty of [-1,0,Infinity,NaN,1.5,''])assert.throws(()=>command(b.state,'produce',{productId:b.productId,qty,minutes:1,materials:[],noMaterials:true}));
 assert.throws(()=>command(b.state,'produce',{productId:b.productId,qty:1,minutes:'',materials:[],noMaterials:true}),/tiempo/);
});
test('empty materials require an explicit selection; zero time produces no hourly value',()=>{
 const b=base();assert.throws(()=>command(b.state,'produce',{productId:b.productId,qty:1,minutes:0,materials:[]}),/materiales/);
 let s=command(b.state,'produce',{productId:b.productId,qty:1,minutes:0,materials:[],noMaterials:true}).state;
 const r=command(s,'sell',{productId:b.productId,qty:1,payment:10,minutes:0});
 assert.equal(C.saleTotals(r.result).hourlyCents,null);
});
test('JSON round-trip is lossless and corrupt or incompatible records are rejected',()=>{
 const b=base(); const s=production(b);assert.deepEqual(C.validate(JSON.parse(JSON.stringify(s))),s);
 assert.throws(()=>C.validate({...s,schemaVersion:99}),/formato/);
 const broken=JSON.parse(JSON.stringify(s));broken.batches[0].remainingQty=29;
 assert.throws(()=>C.validate(broken),/coinciden/);
});
test('stable ids and FIFO do not depend on formatted display dates',()=>{
 const b=base();const s=production(b);
 const ids=[...s.products,...s.materials,...s.purchases,...s.batches].map(e=>e.id);
 assert.equal(new Set(ids).size,ids.length);assert.ok(s.batches[0].createdAt.endsWith('Z'));
});
