import {test} from 'node:test';import assert from 'node:assert/strict';
import {areas,parseLocations,listingAreas,setMetroNames} from '../apps/locations.mjs';
import {joinRings,insideRing,parseAreaBoundaries,locateDistrict} from '../apps/area-boundaries.mjs';
import {buildSearchProfile,rankListings,normalize,applyOverrides} from '../apps/search.mjs';
import {openCatalog,listingValues} from '../apps/catalog.mjs';
import {rentalFacts} from '../apps/rental.mjs';
import {validateCriteria} from '../apps/extractor.mjs';
const id=name=>areas.find(a=>a.label===name).id;
const offer=(n,deal='sale',district='Приморский',extra={})=>({id:String(n),city:'spb',deal_type:deal,realty_type:'flat',district,price:deal==='sale'?9000000:50000,...extra});
test('canonical geography supports alternatives, exclusions, zones, aliases and does not mistake Moskovsky for Moscow',()=>{
 const p=buildSearchProfile('Приморский или Выборгский район, кроме Невского');assert.deepEqual(p.hard.areas_any,[id('Выборгский район'),id('Приморский район')]);assert.deepEqual(p.hard.areas_none,[id('Невский район')]);
 assert.equal(p.outsideScope,false);assert.equal(buildSearchProfile('Московский район').outsideScope,false);
 assert.equal(buildSearchProfile('Не Мурино, на севере').outsideScope,false);assert.equal(buildSearchProfile('В Мурино').outsideScope,true);
 assert.ok(buildSearchProfile('На Петроградке').hard.areas_any.includes(id('Петроградский район')));
 assert.ok(buildSearchProfile('В Кроншдадте').hard.areas_any.includes('place:kronstadt'));
 assert.ok(buildSearchProfile('У Лахта-центра').needsClarification);assert.ok(buildSearchProfile('В историческом центре').needsClarification);
 assert.ok(parseLocations('Север').notes.some(n=>n.includes('схема проекта')));
 assert.equal(parseLocations('Желательно Приморский').hard.areas_any,undefined);assert.deepEqual(parseLocations('Желательно Приморский').preferred,[id('Приморский район')]);
});
test('polygon rings support reversed fragments, islands and holes and reject partial datasets',()=>{
 const a={lat:59,lon:30},b={lat:59,lon:31},c={lat:60,lon:31},d={lat:60,lon:30};
 const ring=joinRings([[a,b],[c,b],[c,d],[a,d]])[0];assert.ok(insideRing({lat:59.5,lon:30.5},ring));
 assert.throws(()=>joinRings([[a,b],[c,d]]));
 const body={osm3s:{timestamp_osm_base:'2026-11-05T00:00:00Z'},elements:[{type:'relation',id:1,tags:{name:'Приморский район',admin_level:'5'},members:[{type:'way',role:'outer',geometry:[a,b,c,d,a]},{type:'way',role:'inner',geometry:[{lat:59.4,lon:30.4},{lat:59.4,lon:30.6},{lat:59.6,lon:30.6},{lat:59.6,lon:30.4},{lat:59.4,lon:30.4}]}]}]};
 const shapes=parseAreaBoundaries(body,{expectedDistricts:1});assert.equal(locateDistrict({lat:59.2,lon:30.2},shapes,'test').districtResolved,true);assert.equal(locateDistrict({lat:59.5,lon:30.5},shapes,'test').districtResolved,false);assert.throws(()=>parseAreaBoundaries(body));
});
test('SQL and JS preserve geographic hard limits and pagination for both sale and rent; unknown exclusions never pass',()=>{
 const c=openCatalog(':memory:');try{
 const rows=['sale','rent'].flatMap(deal=>[offer(deal+'1',deal),offer(deal+'2',deal,'Невский'),offer(deal+'3',deal,null),offer(deal+'4',deal,'Коломяги',{geography:{area_ids:[id('Приморский район')],districtResolved:true}})]);
 const ins=c.db.prepare('INSERT INTO listings VALUES ('+Array(13).fill('?').join(',')+')');rows.forEach(x=>ins.run(...listingValues(x)));
 for(const deal of ['sale','rent'])for(const filters of [{areas_any:[id('Приморский район')]},{areas_none:[id('Невский район')]},{areas_any:['zone:north']},{areas_any:[id('Центральный район')]},{areas_none:['place:lakhta']}]){
 const p=applyOverrides(buildSearchProfile(''),{deal_type:deal,...filters});assert.deepEqual(c.search(p).results.map(x=>x.id).sort(),rankListings(rows,p).map(x=>deal+':'+x.id).sort());
 }
 const p=buildSearchProfile('Приморский');assert.equal(c.search(p,{limit:1}).total,2);assert.notEqual(c.search(p,{limit:1}).results[0].id,c.search(p,{limit:1,offset:1}).results[0].id);
 assert.throws(()=>applyOverrides(p,{areas_any:['bad']}));assert.throws(()=>applyOverrides(p,{areas_none:"' OR 1=1"}));
 }finally{c.close();}
});
test('rent facts distinguish known zero, percentages, prohibitions and missing data; filters never affect sale implicitly',()=>{
 const raw=offer('x','rent','Приморский',{pets_allowed:'Да',kids_allowed:'Нет',deposit:'Без залога',commission:'50%'});const f=rentalFacts(raw);assert.equal(f.deposit_amount,0);assert.equal(f.commission_amount,25000);assert.equal(f.pets_allowed,true);assert.equal(f.kids_allowed,false);
 assert.equal(rentalFacts(offer('x','rent')).commission_amount,null);assert.equal(rentalFacts(offer('x','sale')),null);
 assert.equal(rentalFacts({...raw,deposit:'1 месяц'}).deposit_amount,null);
 const rows=[raw,offer('y','rent',null,{pets_allowed:'Нет',commission:'Без комиссии'}),offer('z','rent')];const c=openCatalog(':memory:');try{
 const ins=c.db.prepare('INSERT INTO listings VALUES ('+Array(13).fill('?').join(',')+')');rows.forEach(x=>ins.run(...listingValues(x)));
 for(const query of ['Снять с собакой','Снять с детьми','Снять без комиссии','Снять без залога','Снять залог до 10 тыс']){const p=buildSearchProfile(query);assert.deepEqual(c.search(p).results.map(x=>x.id).sort(),rankListings(rows,p).map(x=>'rent:'+x.id).sort());}
 }finally{c.close();}
 assert.ok(buildSearchProfile('Снять до 60 тыс вместе с коммуналкой').needsClarification);assert.ok(buildSearchProfile('Снять, на въезд до 100 тыс').needsClarification);
 assert.ok(buildSearchProfile('Снять до 60 тыс с КУ').needsClarification);
 assert.equal(buildSearchProfile('Купить евродвушку').hard.rooms,undefined);assert.ok(buildSearchProfile('Купить евродвушку').needsClarification);
 assert.throws(()=>applyOverrides(buildSearchProfile('Купить'),{pets_required:true}));
});
test('model cannot overwrite canonical geography or replace district alternatives with a single source label',()=>{
 const p=validateCriteria({hard:{district:'Приморский'},soft:[],unknown:[],questions:[],outsideScope:false},'Приморский или Выборгский');assert.equal(p.hard.district,undefined);assert.equal(p.hard.areas_any.length,2);assert.equal(p.needsClarification,false);
});
test('metro alternatives and travel-mode limits combine for both deals; station mentions do not select municipal areas',()=>{
 setMetroNames(['Озерки','Удельная']);
 const p=buildSearchProfile('Снять метро Озерки или Удельная до 15 мин');assert.deepEqual(p.hard.metro_any,['Озерки','Удельная']);assert.equal(p.hard.areas_any,undefined);
 const c=openCatalog(':memory:');try{const ins=c.db.prepare('INSERT INTO listings VALUES ('+Array(13).fill('?').join(',')+')');const rows=['sale','rent'].flatMap(deal=>[offer(deal+'1',deal,'Приморский',{metro:'Озерки',metro_minutes:10,metro_mode:'walk'}),offer(deal+'2',deal,'Приморский',{metro:'Удельная',metro_minutes:20,metro_mode:'walk'}),offer(deal+'3',deal,'Приморский',{metro:'Другая',metro_minutes:5,metro_mode:'walk'})]);rows.forEach(x=>ins.run(...listingValues(x)));
 for(const deal of ['sale','rent']){const p=applyOverrides(buildSearchProfile(''),{deal_type:deal,metro_any:['Озерки','Удельная'],metro_max:15});assert.equal(c.search(p).total,1);assert.deepEqual(c.search(p).results.map(x=>x.id),rankListings(rows,p).map(x=>deal+':'+x.id));}
 }finally{c.close();setMetroNames([]);}
});
test('explicit switch from rent to sale clears renter conditions, while sale cannot accept new rental filters',()=>{
 const rent=buildSearchProfile('Снять с кошкой без комиссии');const sale=applyOverrides(rent,{deal_type:'sale'});assert.equal(sale.hard.pets_required,undefined);assert.equal(sale.hard.no_commission,undefined);
 assert.throws(()=>applyOverrides(rent,{deal_type:'sale',pets_required:true}));
 assert.equal(buildSearchProfile('Купить однушку, хороший дом с лифтом').hard.realty_type,'flat');
 const centre=buildSearchProfile('В историческом центре',{areas_any:[id('Центральный район')]});assert.equal(centre.needsClarification,false);
});
