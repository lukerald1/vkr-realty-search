import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';

async function start(t,env={}) {
  const dir=await mkdtemp(path.join(tmpdir(),'prostor-http-'));
  const child=spawn(process.execPath,['apps/server.mjs'],{env:{...process.env,DATA_MODE:'demo',EXTRACTOR_MODE:'rules',HOST:'127.0.0.1',PORT:'0',ACTIVITY_PATH:path.join(dir,'activity.sqlite'),...env},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}await rm(dir,{recursive:true,force:true});});
  let stderr='';child.stderr.on('data',v=>stderr+=v);
  const base=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Server startup timeout: '+stderr)),10000);
    child.once('exit',()=>{clearTimeout(timer);reject(new Error('Server exited: '+stderr));});
    child.stdout.on('data',v=>{const m=String(v).match(/Local: (http:\/\/[^ ]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
  });
  let cookie='';
  return async (route,body,headers={})=>{
    const res=await fetch(base+route,{headers:{...(cookie?{Cookie:cookie}:{}),'Content-Type':'application/json',...headers},...(body!==undefined?{method:'POST',body:typeof body==='string'?body:JSON.stringify(body)}:{})});
    cookie=res.headers.get('set-cookie')?.split(';')[0]||cookie;
    return {status:res.status,body:res.headers.get('content-type')?.includes('application/json')?await res.json():await res.text()};
  };
}
test('HTTP: demo search, invalid requests, empty results, history and session events',async t=>{
  const request=await start(t);
  assert.equal((await request('/')).status,200);
  assert.equal((await request('/api/health')).body.status,'ok');
  const all=await request('/api/search',{query:'',searchMode:'filters'});
  assert.equal(all.status,200);assert.ok(all.body.results.length>0);assert.equal(all.body.meta.mode,'demo');
  const result=all.body.results[0];
  const saved=await request('/api/saved',{ids:[result.id]});assert.equal(saved.status,200);assert.equal(saved.body.results[0].id,result.id);assert.equal(saved.body.searchId,null);
  assert.equal((await request('/api/saved',{ids:'bad'})).status,400);
  assert.equal((await request('/api/events',{searchId:all.body.searchId,listingId:result.id,type:'detail_open'})).status,200);
  assert.equal((await request('/api/events',{searchId:all.body.searchId,listingId:'absent',type:'detail_open'})).status,400);
  assert.ok((await request('/api/history')).body.searches.length>0);
  const history=(await request('/api/history')).body.searches[0];assert.equal(history.searchMode,'filters');assert.equal(history.filters.city,'spb');
  const empty=await request('/api/search',{query:'',searchMode:'filters',filters:{price_max:1}});
  assert.equal(empty.body.results.length,0);assert.equal(empty.body.profile.hard.price_max,1);
  for(const body of ['{',null,{query:3},{query:'x',filters:[]},{query:'x',searchMode:'bad'},{query:'x',offset:-1},{query:'x',filters:{price_min:9,price_max:2}}])assert.equal((await request('/api/search',body===null?'null':body)).status,400);
  assert.equal((await request('/api/search',{query:'x'},{Origin:'https://example.org'})).status,403);
  assert.equal((await request('/api/search',{query:'Квартира до 10 млн',filters:{price_min:11000000}})).status,400);
  assert.equal((await request('/api/search','x'.repeat(17000))).status,413);
});
test('HTTP: Ollama success, cached sorting, clarification and unavailable model',async t=>{
  let calls=0;
  const model=http.createServer(async(req,res)=>{
    let text='';for await(const c of req)text+=c;
    const q=JSON.parse(text).messages.at(-1).content;calls++;
    if(q==='ошибка'){res.writeHead(503);return res.end();}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({done:true,message:{content:JSON.stringify({hard:{},soft:[],unknown:[],outsideScope:false,questions:q==='уточни'?['Какой бюджет?']:[]})}}));
  });
  await new Promise(r=>model.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>model.close(r)));
  const request=await start(t,{EXTRACTOR_MODE:'ollama',OLLAMA_MODEL:'test',OLLAMA_URL:`http://127.0.0.1:${model.address().port}`});
  const first=await request('/api/search',{query:'квартира'});assert.equal(first.status,200);assert.equal(first.body.meta.extractor,'ollama');
  await request('/api/search',{query:'квартира',sort:'price'});assert.equal(calls,1);
  const clarify=await request('/api/search',{query:'уточни'});assert.equal(clarify.body.results.length,0);assert.equal(clarify.body.profile.needsClarification,true);
  assert.equal((await request('/api/search',{query:'ошибка'})).status,503);
  assert.equal((await request('/api/search',{query:'ошибка',searchMode:'filters'})).status,200);
});
