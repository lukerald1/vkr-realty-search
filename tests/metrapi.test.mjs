import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMetrapi} from '../apps/metrapi.mjs';
test('provider caches identical requests and gates different requests by key',async()=>{
  let calls=0,time=10000;
  const provider=createMetrapi({key:'test-only',now:()=>time,fetchImpl:async(url,opts)=>{
    calls++;assert.equal(opts.headers['X-Api-Key'],'test-only');assert.ok(url.startsWith('https://api.metrapi.ru/v1/items?'));
    return new Response(JSON.stringify({items:[],next_cursor:null}),{status:200});
  }});
  await provider({city:'spb'});await provider({city:'spb'});assert.equal(calls,1);
  await assert.rejects(provider({city:'msk'}),error=>error.status===429);
  time+=2101;await provider({city:'msk'});assert.equal(calls,2);
});
test('provider uses retry_after from body and makes no automatic retries',async()=>{
  let calls=0,time=0;
  const provider=createMetrapi({key:'test-only',now:()=>time,fetchImpl:async()=>{calls++;return new Response(JSON.stringify({detail:{retry_after:10}}),{status:429});}});
  await assert.rejects(provider({city:'spb'}),error=>error.status===429);
  time=3000;await assert.rejects(provider({city:'spb'}),error=>error.status===429);assert.equal(calls,1);
});
test('missing key never sends a network request',async()=>{
  const provider=createMetrapi({fetchImpl:()=>assert.fail('network request with missing key')});
  await assert.rejects(provider({}),error=>error.status===503);
});
