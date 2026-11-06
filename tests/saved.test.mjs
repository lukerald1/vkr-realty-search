import {test} from 'node:test';
import assert from 'node:assert/strict';
import {savedListings,validateSavedRequest} from '../apps/saved.mjs';
const item=(id,deal_type,price)=>({id,city:'spb',realty_type:'flat',deal_type,price});
test('favorites include sale and rent, preserve saved order, skip unavailable IDs and deduplicate',()=>{
  const raw=[item('sale:1','sale',1e7),item('rent:1','rent',50000)];
  const options=validateSavedRequest({ids:['rent:1','sale:1','rent:1','absent']});
  assert.deepEqual(savedListings(raw,options).results.map(i=>i.id),['rent:1','sale:1']);
  assert.equal(savedListings(raw,{...options,limit:1}).hasMore,true);
  assert.equal(savedListings(raw,{...options,offset:1,limit:1}).results[0].id,'sale:1');
  assert.equal(savedListings(raw,{ids:[]}).total,0);
});
test('favorites validate input and sort known prices before missing prices',()=>{
  for(const b of [null,{ids:'x'},{ids:[null]},{ids:[],offset:-1},{ids:[],sort:'unknown'}])assert.throws(()=>validateSavedRequest(b));
  assert.deepEqual(savedListings([item('missing','sale',null),item('rent','rent',50000)],{ids:['missing','rent'],sort:'price'}).results.map(i=>i.id),['rent','missing']);
});
