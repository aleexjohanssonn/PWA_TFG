const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../batch-production/sw.js'),'utf8');
const release=source.match(/const RELEASE = '([^']+)'/)[1];
const scope='https://example.test/PWA_TFG/batch-production/';
function worker(){
 const handlers={}, deleted=[], added=[];
 const cache={addAll:async files=>added.push(...files),match:async request=>(typeof request==='string'&&request==='./index.html')?{body:'offline app'}:undefined};
 const context=vm.createContext({URL,self:{registration:{scope},addEventListener:(type,fn)=>handlers[type]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}}},caches:{open:async()=>cache,keys:async()=>['mi-negocio-v1','another-app','pwa-tfg-batch:'+scope+':old','pwa-tfg-batch:'+scope+':' + release],delete:async key=>deleted.push(key)},fetch:async()=>{throw Error('offline');}});
 vm.runInContext(source,context);
 return {handlers,deleted,added,cache};
}
test('precache lists existing local resources and no external font dependency',async()=>{
 const w=worker();let done;w.handlers.install({waitUntil:p=>done=p});await done;
 assert.equal(w.added.length,9);
 for(const resource of w.added){assert.ok(resource.startsWith('./'));assert.ok(fs.existsSync(path.join(__dirname,'../batch-production',resource)));}
});
test('activation deletes only older caches owned by this batch app scope',async()=>{
 const w=worker();let done;w.handlers.activate({waitUntil:p=>done=p});await done;
 assert.deepEqual(w.deleted,['pwa-tfg-batch:'+scope+':old']);
});
test('offline navigation falls back to the cached application',async()=>{
 const w=worker();let response;
 w.handlers.fetch({request:{url:scope+'unavailable',method:'GET',mode:'navigate'},respondWith:p=>response=p});
 assert.deepEqual(await response,{body:'offline app'});
});
test('requests outside the app scope are not intercepted',()=>{
 const w=worker();let handled=false;
 w.handlers.fetch({request:{url:'https://example.test/PWA_TFG/con-stock/',method:'GET'},respondWith:()=>handled=true});
 assert.equal(handled,false);
});
