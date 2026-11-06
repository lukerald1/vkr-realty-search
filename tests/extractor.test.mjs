import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExtractor,createOllama,validateCriteria} from '../apps/extractor.mjs';
const criteria=(hard={},other={})=>({hard,soft:[],unknown:[],questions:[],outsideScope:false,...other});
test('model output rejects unknown fields, wrong types and contradictory ranges',()=>{
  for(const c of [criteria({sql:'DROP TABLE'}),criteria({rooms:'1'}),criteria({rooms:1.5}),criteria({price_min:3,price_max:2}),criteria({city:'msk'}),criteria({}, {soft:['quiet']}),criteria({}, {unknown:[null]})])assert.throws(()=>validateCriteria(c,''));
  assert.throws(()=>validateCriteria(criteria(JSON.parse('{"__proto__":{}}')),''));
});
test('model cannot remove explicit hard limits or foreign geography; conflicts require clarification',()=>{
  const p=validateCriteria(criteria({price_max:20000000,deal_type:'sale'}),'Снять однушку до 60 тыс в Мурино');
  assert.equal(p.hard.price_max,60000);assert.equal(p.hard.rooms,1);assert.equal(p.hard.deal_type,'rent');assert.equal(p.outsideScope,true);assert.equal(p.needsClarification,true);
  const quiet=validateCriteria(criteria({}, {unknown:['Тишина не проверяется'],questions:['Тишина обязательна?']}),'Обязательно тихая квартира');
  assert.equal(quiet.needsClarification,true);assert.ok(quiet.unknown.length);
  assert.equal(validateCriteria(criteria(),'Необязательно тихая квартира').needsClarification,false);
  assert.equal(validateCriteria(criteria(),'Не обязательно тихая квартира').needsClarification,false);
  assert.equal(validateCriteria(criteria(),'Обязательно тихая квартира').needsClarification,true);
});
test('cached extraction isolates sessions, clones profiles, expires and applies edits without calling model',async()=>{
  let calls=0,time=0;
  const extract=createExtractor({mode:'ollama',model:'test',now:()=>time,ttlMs:10,extract:async()=>{calls++;return {criteria:criteria({rooms:1,price_max:60000})};}});
  const run=(session,filters={})=>extract({session,query:'Снять однушку до 60 тыс',filters});
  const a=await run('a');a.hard.price_max=999;
  assert.equal((await run('a')).hard.price_max,60000);
  assert.equal((await run('a',{price_max:55000})).hard.price_max,55000);assert.equal(calls,1);
  await run('b');assert.equal(calls,2);time=11;await run('a');assert.equal(calls,3);
  await assert.rejects(run('c',{price_max:-1}),e=>e.status===400);assert.equal(calls,3);
});
test('filters and empty query never contact LLM; errors never silently fall back to rules',async()=>{
  let calls=0;const extract=createExtractor({mode:'ollama',extract:async()=>{calls++;throw new Error('failure');}});
  assert.equal((await extract({query:'Снять студию',searchMode:'filters',filters:{rooms:1}})).extractor,'rules');
  assert.equal((await extract({query:''})).extractor,'rules');assert.equal(calls,0);
  await assert.rejects(extract({query:'квартира',session:'s'}));assert.equal(calls,1);
});
test('concurrent identical requests share work; other requests are bounded',async()=>{
  let finish,calls=0;const extract=createExtractor({mode:'ollama',extract:()=>{calls++;return new Promise(r=>finish=r);}});
  const a=extract({query:'квартира',session:'s'}),b=extract({query:'квартира',session:'s'});
  await assert.rejects(extract({query:'другая',session:'s'}),e=>e.status===429);
  finish({criteria:criteria()});await Promise.all([a,b]);assert.equal(calls,1);
});
test('manual correction resolves field conflicts and ambiguous room count without another model call',async()=>{
  let calls=0;const extract=createExtractor({mode:'ollama',extract:async()=>{calls++;return {criteria:criteria({rooms:2})};}});
  const run=filters=>extract({query:'Однушка',session:'s',filters});
  assert.equal((await run({})).needsClarification,true);
  assert.equal((await run({rooms:1})).needsClarification,false);assert.equal(calls,1);
});
test('Ollama sends schema and handles refusal, malformed data, HTTP and timeout errors',async()=>{
  assert.throws(()=>createOllama({model:'x',baseUrl:'https://example.org'}));
  assert.throws(()=>createOllama({model:'x:cloud'}));
  const success=createOllama({model:'test',fetchImpl:async(url,opts)=>{
    assert.equal(new URL(url).hostname,'127.0.0.1');const body=JSON.parse(opts.body);
    assert.equal(body.stream,false);assert.equal(body.format.additionalProperties,false);
    return {ok:true,json:async()=>({done:true,message:{content:JSON.stringify(criteria())},prompt_eval_count:10,eval_count:20})};
  }});
  assert.deepEqual((await success('квартира')).usage,{inputTokens:10,outputTokens:20});
  for(const fetchImpl of [async()=>({ok:false,status:404}),async()=>({ok:true,json:async()=>({done:true,message:{content:'not json'}})}),async()=>{throw Object.assign(new Error(),{name:'TimeoutError'});}])await assert.rejects(createOllama({model:'test',fetchImpl})('квартира'),e=>[502,503].includes(e.status));
});
test('Ollama normalizes explicit nulls without losing studio zero or false balcony',async()=>{
  const transport=createOllama({model:'qwen3:8b',fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);assert.equal(body.think,true);assert.ok(body.format.properties.hard.required.includes('rooms'));
    return {ok:true,json:async()=>({done:true,message:{content:JSON.stringify(criteria({rooms:0,price_min:null,balcony_required:false}))}})};
  }});
  const result=await transport('Студия без балкона');assert.equal(result.criteria.hard.rooms,0);assert.equal(result.criteria.hard.balcony_required,false);assert.equal(Object.hasOwn(result.criteria.hard,'price_min'),false);
});
test('resolved model filters remove stale baseline warnings but retain unverified and model warnings',()=>{
  const query='Приморский район, косметический ремонт, обязательно до 10 минут пешком до метро, тихая';
  const p=validateCriteria(criteria({district:'Приморский',renovation:'Косметический',metro_max:10,metro_mode_f:'walk'}),query);
  assert.ok(!p.unknown.includes('Район: пока не распознаётся'));assert.ok(!p.unknown.includes('Требования к ремонту'));
  assert.ok(!p.unknown.includes('Обязательная близость метро: укажите предел в минутах'));assert.ok(p.unknown.includes('Тишина и уровень шума'));
  const uncertain=validateCriteria(criteria({district:'Приморский'},{unknown:['Район: пока не распознаётся']}),'Приморский район');
  assert.ok(uncertain.unknown.includes('Район: пока не распознаётся'));
});
