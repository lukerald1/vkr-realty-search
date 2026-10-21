import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseQuery,rankListings,applyOverrides,normalize,metrapiParams} from '../apps/search.mjs';
const listing = (overrides={}) => ({source:'test',source_id:'1',city:'spb',deal_type:'sale',realty_type:'flat',rooms:1,price:10000000,area_total:40,metro_minutes:8,metro_mode:'walk',...overrides});

test('Russian query separates mandatory limits, wishes and unsupported features',()=>{
  const parsed=parseQuery('Однушка до 12,5 миллионов, до 10 минут пешком до метро, с большой кухней и тихим двором');
  assert.equal(parsed.hard.rooms,1);assert.equal(parsed.hard.price_max,12500000);
  assert.equal(parsed.hard.metro_max,10);assert.equal(parsed.hard.metro_mode_f,'walk');
  assert.ok(parsed.soft.includes('kitchen'));assert.ok(parsed.unknown.includes('Тишина и уровень шума'));
});
test('walking limit excludes transport and unknown travel mode',()=>{
  const query=parseQuery('до 10 минут пешком до метро');
  assert.equal(rankListings([listing({metro_mode:'transport'}),listing({metro_mode:null})],query).length,0);
  assert.equal(rankListings([listing({metro_mode:'пешком'})],query).length,1);
});
test('missing fields and out-of-budget listings cannot satisfy hard filters',()=>{
  const profile=parseQuery('однокомнатная до 12 млн от 35 м²');
  for(const override of [{price:null},{price:13000000},{area_total:null},{area_total:30},{rooms:null},{city:'msk'}])
    assert.equal(rankListings([listing(override)],profile).length,0);
  assert.equal(rankListings([listing()],profile).length,1);
});
test('duplicates use provider group id; studio is zero, not missing',()=>{
  const a=listing({group_id:'g1',rooms:0});
  assert.equal(rankListings([a,{...a,source:'other',source_id:'2'}],parseQuery('студия')).length,1);
  assert.equal(normalize(listing({rooms:0})).rooms,0);
  assert.equal(normalize(listing({rooms:null})).rooms,null);
});
test('soft ranking changes order without weakening hard criteria',()=>{
  const profile=parseQuery('однушка до 12 млн рядом с метро');
  const results=rankListings([listing({source_id:'far',metro_minutes:20}),listing({source_id:'near',metro_minutes:5}),listing({source_id:'expensive',price:20000000,metro_minutes:1})],profile);
  assert.deepEqual(results.map(v=>v.id),['test:near','test:far']);
});
test('manual overrides can remove room and price filters',()=>{
  const profile=applyOverrides(parseQuery('студия до 8 млн'),{rooms:'',price_max:'',metro_max:'10'});
  assert.equal(profile.hard.rooms,undefined);assert.equal(profile.hard.price_max,undefined);assert.equal(profile.hard.metro_max,10);
  assert.throws(()=>applyOverrides(profile,{rooms:'wat'}));
});
test('API params support zero rooms and never include unsupported conditions',()=>{
  const params=metrapiParams(parseQuery('студия с балконом, тихая').hard);
  assert.equal(params.get('rooms'),'0');assert.equal(params.get('dedupe'),'true');assert.equal(params.has('balcony_required'),false);
});
test('a different deal, city or property type is not silently replaced',()=>{
  for(const query of ['Снять квартиру','Квартира в Москве','Купить дом']) assert.equal(rankListings([listing()],parseQuery(query)).length,0);
});
