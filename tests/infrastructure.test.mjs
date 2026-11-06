import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseInfrastructure,poiDistance,buildPoiIndex,infrastructureBadges,parseOsm,applyGeometryOverlay} from '../apps/infrastructure.mjs';
import {buildSearchProfile,rankListings,applyOverrides} from '../apps/search.mjs';
import {openCatalog,listingValues} from '../apps/catalog.mjs';
import {validateCriteria} from '../apps/extractor.mjs';
const poi=(name,distance)=>({id:`node/${name}`,name,distance_m:distance,method:'mapped_point',sourceUrl:'https://www.openstreetmap.org/node/1'});
const raw=(id,school,park)=>({id,city:'spb',deal_type:'sale',realty_type:'flat',price:100,lat:59.9,lon:30.3,infrastructure:{source:'OpenStreetMap',snapshotAt:'2026-11-05',nearby:{...(school!==null?{school:poi('school',school)}:{}),park:poi('park',park)}}});
test('infrastructure parses category limits, metres/kilometres and explicit primary priority',()=>{
  const p=parseInfrastructure('Парк рядом, главное школа до 0,5 км, поликлиника до 800 м и аптека');
  assert.equal(p.soft[0],'school');assert.equal(p.hard.school_max_m,500);assert.equal(p.hard.clinic_max_m,800);assert.ok(p.soft.includes('pharmacy'));
  assert.equal(parseInfrastructure('До 600 м от школы').hard.school_max_m,600);
  assert.ok(buildSearchProfile('Обязательно рядом школа').needsClarification);
  assert.ok(buildSearchProfile('Школа до 10 мин пешком').needsClarification);
  assert.ok(buildSearchProfile('Школа до 5 км').needsClarification);
  assert.ok(buildSearchProfile('Только хорошая школа до 500 м').needsClarification);
  assert.ok(buildSearchProfile('Без парков').needsClarification);
  assert.ok(buildSearchProfile('Магазин одежды до 300 м').needsClarification);
  assert.equal(buildSearchProfile('Продуктовый магазин до 300 м').needsClarification,false);
  assert.equal(buildSearchProfile('Обязательно школа',{school_max_m:500}).needsClarification,false);
  assert.throws(()=>applyOverrides(buildSearchProfile(''),{school_max_m:5000}));
});
test('geometry includes points inside mapped park; index finds large enclosing polygon',()=>{
  const p={id:'way/1',category:'park',name:'Test',lat:59.95,lon:30.3,geometry:[{lat:59.9,lon:30.2},{lat:59.9,lon:30.4},{lat:60,lon:30.4},{lat:60,lon:30.2},{lat:59.9,lon:30.2}]};
  assert.equal(poiDistance({lat:59.95,lon:30.3},p),0);
  assert.equal(buildPoiIndex([p])({lat:59.95,lon:30.3},{snapshotAt:'test',checkedAt:'test'}).nearby.park.distance_m,0);
  assert.throws(()=>parseOsm({remark:'timeout',elements:[]}));
});
test('Overpass bounds/geometry without center is parsed; open or broken outlines fall back safely',()=>{
  const ring=[{lat:59.9,lon:30.2},{lat:59.9,lon:30.4},{lat:60,lon:30.4},{lat:60,lon:30.2},{lat:59.9,lon:30.2}];
  const body={osm3s:{timestamp_osm_base:'2026-11-05T02:00:00Z'},elements:[{type:'way',id:1,tags:{leisure:'park'},geometry:ring}]};
  const parsed=parseOsm(body);assert.equal(parsed.length,1);assert.ok(parsed[0].geometry);assert.equal(parsed[0].method,'mapped_center');
  assert.equal(poiDistance({lat:59.95,lon:30.3},parsed[0]),0);
  const open=structuredClone(body);open.elements[0].geometry.pop();assert.equal(parseOsm(open)[0].geometry,null);
  const broken=structuredClone(body);broken.elements[0].geometry[1].lat=null;assert.equal(parseOsm(broken).length,0);
});
test('geometry overlay preserves identities and dates and rejects mixed, stale or incomplete datasets',()=>{
  const ring=[{lat:59.9,lon:30.2},{lat:59.9,lon:30.4},{lat:60,lon:30.4},{lat:60,lon:30.2},{lat:59.9,lon:30.2}];
  const body={osm3s:{timestamp_osm_base:'2026-11-05T02:00:00Z'},elements:[{type:'way',id:1,tags:{leisure:'park'},geometry:ring}]};
  const base=[{id:'way/1',category:'park',name:'Base identity',lat:59.95,lon:30.3},{id:'way/2',category:'school',name:'Other',lat:59.9,lon:30.4}],options={category:'park',baseTimestamp:'2026-11-05T00:00:00Z'};
  const r=applyGeometryOverlay(base,body,options);assert.equal(r.report.matched,1);assert.equal(r.pois[0].name,'Base identity');assert.equal(r.pois[0].geometrySnapshotAt,body.osm3s.timestamp_osm_base);assert.equal(base[0].geometry,undefined);assert.equal(r.pois[1],base[1]);
  assert.throws(()=>applyGeometryOverlay(base,{...body,remark:'timeout'},options));
  assert.throws(()=>applyGeometryOverlay(base,body,{...options,category:'school'}));
  assert.throws(()=>applyGeometryOverlay(base,body,{...options,baseTimestamp:'2026-11-06T00:00:00Z'}));
  assert.throws(()=>applyGeometryOverlay([],body,options));
});
test('submetre excess never satisfies an obligatory limit, while nearby outlined park is found beyond centre radius',()=>{
  const p={lat:59.95,lon:30.3},degree=180/Math.PI/6371000;
  const index=buildPoiIndex([{id:'node/1',category:'school',name:'Boundary',lat:p.lat+500.4*degree,lon:p.lon,method:'mapped_point'}]);
  const item={...raw('boundary',null,0),...p,infrastructure:index(p,{snapshotAt:'test',checkedAt:'test'})};
  assert.equal(item.infrastructure.nearby.school.distance_m,501);
  assert.equal(rankListings([item],buildSearchProfile('Школа до 500 м')).length,0);
  const park={id:'way/large',category:'park',name:'Long park',lat:59.95,lon:30.45,geometry:[{lat:59.94,lon:30.299},{lat:59.94,lon:30.6},{lat:59.96,lon:30.6},{lat:59.96,lon:30.299},{lat:59.94,lon:30.299}],geometrySnapshotAt:'2026-11-05T02:00:00Z'};
  const v=buildPoiIndex([park])(p,{snapshotAt:'test',checkedAt:'test'}).nearby.park;assert.equal(v.distance_m,0);assert.equal(v.method,'mapped_geometry');assert.equal(v.geometrySnapshotAt,park.geometrySnapshotAt);
});
test('SQL and JS rank primary proximity before secondary preferences, filter unknowns, paginate globally',()=>{
  const c=openCatalog(':memory:');try{
    const rows=[raw('a',100,2900),raw('b',200,0),raw('c',null,0),raw('d',500,100),raw('e',600,0),{...raw('f',1,1),lat:null}];
    const insert=c.db.prepare('INSERT INTO listings VALUES ('+Array(13).fill('?').join(',')+')');rows.forEach(r=>insert.run(...listingValues(r)));
    const p=buildSearchProfile('Парк рядом, главное школа до 500 м');
    const js=rankListings(rows,p),sql=c.search(p,{limit:1});assert.equal(sql.total,3);assert.equal(js.length,3);
    assert.equal(sql.results[0].id,'sale:a');assert.equal(c.search(p,{limit:1,offset:1}).results[0].id,'sale:b');
    assert.deepEqual(c.search(p).results.map(r=>r.id),js.map(r=>'sale:'+r.id));
    assert.equal(c.search(applyOverrides(p,{school_max_m:50})).total,0);
    assert.ok(sql.results[0].infrastructureBadges[0].text.includes('100 м по прямой'));
  }finally{c.close();}
});
test('school badge requires exact reviewed POI, source, scope, current year and ranking method',()=>{
  const item=raw('x',300,100),profile=buildSearchProfile('Главное школа');
  assert.equal(infrastructureBadges(item,profile)[0].ratingText,undefined);
  const rating={provider:'RAEX',scope:'Санкт-Петербург',method:'competitiveness',year:new Date().getFullYear(),rank:38,sourceUrl:'https://raex-rr.com/test',matchedPoiId:item.infrastructure.nearby.school.id};
  item.infrastructure.nearby.school.rating=rating;
  assert.match(infrastructureBadges(item,profile)[0].ratingText,/№ 38 в СПб/);
  for(const patch of [{matchedPoiId:'other'},{year:2000},{scope:'Россия'},{method:'scale'},{sourceUrl:'https://other.com'}]){
    item.infrastructure.nearby.school.rating={...rating,...patch};assert.equal(infrastructureBadges(item,profile)[0].ratingText,undefined);
  }
});
test('LLM cannot lose explicit infrastructure limit or primary preference',()=>{
  const p=validateCriteria({hard:{},soft:[],unknown:[],questions:[],outsideScope:false},'Главное школа до 500 м, парк рядом');
  assert.equal(p.hard.school_max_m,500);assert.equal(p.soft[0],'school');assert.equal(p.needsClarification,false);
  const nearby=validateCriteria({hard:{school_max_m:500},soft:['school'],unknown:[],questions:[],outsideScope:false},'Школа рядом');
  assert.equal(nearby.hard.school_max_m,undefined);
  const ranked=validateCriteria({hard:{},soft:['school','park','ranked_school'],unknown:[],questions:[],outsideScope:false},'Главное школа из рейтинга RAEX, парк рядом');
  assert.deepEqual(ranked.soft,['ranked_school','park']);
});
test('rated-school filter uses only reviewed current ratings, including SQL pagination parity',()=>{
  const c=openCatalog(':memory:');try{
    const rating={provider:'RAEX',scope:'Санкт-Петербург',method:'competitiveness',year:new Date().getFullYear(),rank:38,sourceUrl:'https://raex-rr.com/test',matchedPoiId:'node/rated'};
    const rows=[100,200,300].map((d,i)=>{const r=raw(String(i),100,10);r.infrastructure.nearby.ranked_school={...poi('rated',d),rating:{...rating,...(i===2?{year:2000}:{})}};return r;});
    const insert=c.db.prepare('INSERT INTO listings VALUES ('+Array(13).fill('?').join(',')+')');rows.forEach(r=>insert.run(...listingValues(r)));
    const p=buildSearchProfile('Главное школа из рейтинга RAEX до 500 м');
    assert.equal(p.soft[0],'ranked_school');assert.equal(p.unknown.length,0);
    assert.equal(c.search(p).total,2);assert.deepEqual(c.search(p).results.map(r=>r.id),rankListings(rows,p).map(r=>'sale:'+r.id));
    assert.equal(c.search(p,{offset:1,limit:1}).results[0].id,'sale:1');
    assert.equal(c.search(applyOverrides(p,{ranked_school_max_m:50})).total,0);
    assert.equal(c.search(p).results[0].infrastructureBadges.length,1);
  }finally{c.close();}
});
