import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openCatalog,listingValues} from '../apps/catalog.mjs';
import {parseQuery,applyOverrides,rankListings} from '../apps/search.mjs';
import {spbScope} from '../apps/geography.mjs';
import {openActivity} from '../apps/activity.mjs';
const raw=(i,overrides={})=>({city:'spb',region:'Санкт-Петербург',locality:'Санкт-Петербург',source:'test',source_id:String(i),deal_type:'sale',realty_type:'flat',rooms:1,price:10000000+i*100000,area_total:40+i,area_kitchen:10+i,metro_minutes:i+1,metro_mode:'walk',...overrides});
test('SPB zone code alone cannot admit Leningrad region or uncertain geography',()=>{
  assert.equal(spbScope(raw(0)),'accepted');
  assert.equal(spbScope(raw(0,{region:'Ленинградская область',locality:'Мурино'})),'outside');
  assert.equal(spbScope(raw(0,{locality:'Кудрово'})),'outside');
  assert.equal(spbScope(raw(0,{locality:'Пушкин'})),'accepted');
  assert.equal(spbScope(raw(0,{locality:null})),'unverified');
});
test('foreign geography is explicitly blocked and manual overrides cannot escape SPB',()=>{
  const profile=parseQuery('Студия в Мурино');assert.equal(profile.outsideScope,true);
  assert.equal(profile.hard.city,'spb');assert.equal(rankListings([raw(1,{rooms:0})],profile).length,0);
  assert.throws(()=>applyOverrides(parseQuery(''),{city:'msk'}));
});
test('database pagination and sorting operate across all matches, not just a first batch',()=>{
  const catalog=openCatalog(':memory:');
  try{
    const insert=catalog.db.prepare(`INSERT INTO listings VALUES (${Array(13).fill('?').join(',')})`);
    for(let i=0;i<70;i++)insert.run(...listingValues(raw(i)));
    insert.run(...listingValues(raw(99,{deal_type:'rent',price:50000})));
    const profile=parseQuery('Однушка до 20 млн рядом с метро');
    const first=catalog.search(profile,{limit:24}),second=catalog.search(profile,{offset:24,limit:24});
    assert.equal(first.total,70);assert.equal(first.results.length,24);assert.equal(first.hasMore,true);
    assert.equal(new Set([...first.results,...second.results].map(v=>v.id)).size,48);
    const byArea=catalog.search(profile,{sort:'area',limit:1});assert.equal(byArea.results[0].area_total,109);
    const rental=catalog.search(parseQuery('Снять однушку до 60 тыс'));assert.equal(rental.total,1);assert.equal(rental.results[0].deal_type,'rent');
    const saved=catalog.search(profile,{ids:[first.results[0].id]});assert.equal(saved.total,1);
    assert.equal(catalog.search(profile,{ids:[]}).total,0);
  }finally{catalog.close();}
});
test('SQL and JS apply the same baseline criteria and scoring',()=>{
  const catalog=openCatalog(':memory:');
  try{
    const rows=[raw(1),raw(2,{metro_mode:'transport'}),raw(3,{price:null}),raw(4,{area_total:null}),raw(5,{balcony:'Лоджия'}),raw(6,{balcony:'Нет'})];
    const insert=catalog.db.prepare(`INSERT INTO listings VALUES (${Array(13).fill('?').join(',')})`);
    rows.forEach(row=>insert.run(...listingValues(row)));
    for(const query of ['Однушка до 13 млн рядом с метро с большой кухней','Однушка до 10 минут пешком до метро','Однушка с балконом']){
      const profile=parseQuery(query),expected=rankListings(rows,profile),actual=catalog.search(profile).results;
      assert.equal(actual.length,expected.length);assert.deepEqual(actual.map(v=>v.score),expected.map(v=>v.score));
    }
  }finally{catalog.close();}
});
test('interaction events require the same session and a result actually served',()=>{
  const activity=openActivity(':memory:');
  try{
    const id=activity.search('session-a','Однушка',{},1,[{id:'listing-a'}],0);
    assert.equal(activity.event('session-b',{searchId:id,listingId:'listing-a',type:'detail_open'}),false);
    assert.equal(activity.event('session-a',{searchId:id,listingId:'other',type:'detail_open'}),false);
    assert.equal(activity.event('session-a',{searchId:id,listingId:'listing-a',type:'detail_open'}),true);
    assert.equal(activity.history('session-a').length,1);assert.equal(activity.history('session-b').length,0);
  }finally{activity.close();}
});

test('extended filters have SQL/JS parity and never match unknown fields',()=>{
 const db=openCatalog(':memory:');try{
 const base={floor:5,floors_total:9,build_year:2000,area_living:25,ceiling_height:2.7,house_type:'Кирпичный',bathroom:'Раздельный',seller_type:'Собственник',build_status:'Сдан',renovation:'Евроремонт',district:'Приморский',metro:'Беговая',balcony:'Балкон',photos:['https://example.com/a.jpg']};
 const rows=[raw(1,base),raw(2,{...base,house_type:null,build_year:null,balcony:null,photos:[]}),raw(3,{...base,floor:1,renovation:'Косметический'}),raw(4,{...base,metro_mode:'transport'})];
 const insert=db.db.prepare('INSERT INTO listings VALUES ('+Array(13).fill('?').join(',')+')');rows.forEach(r=>insert.run(...listingValues(r)));
 const cases=[{year_min:1990,year_max:2010},{floor_not_first:true,floor_not_last:true},{house_type:'Кирпичный',bathroom:'Раздельный'},{kitchen_min:11,kitchen_max:13,area_max:43},{has_photo:true,balcony_required:true},{metro_max:10,metro_mode_f:'transport'},{district:'Приморский',renovation:'Евроремонт'},{year_min:2026},{house_type:"' OR 1=1 --"}];
 for(const f of cases){const profile=applyOverrides(parseQuery(''),f);const expected=rankListings(rows,profile).map(r=>'sale:'+r.id).sort();assert.deepEqual(db.search(profile).results.map(r=>r.id).sort(),expected);}
 assert.equal(db.search(applyOverrides(parseQuery(''),{year_min:2026})).total,0);
 assert.ok(db.facets().house_type.includes('Кирпичный'));
 for(const f of [{price_min:20,price_max:10},{area_min:50,area_max:10},{floor_min:1.5},{has_photo:'true'},{rooms:true}])assert.throws(()=>applyOverrides(parseQuery(''),f));
 }finally{db.close();}
});
