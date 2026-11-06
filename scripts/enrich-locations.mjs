import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {openCatalog,listingValues} from '../apps/catalog.mjs';
import {parseAreaBoundaries,locateDistrict,locatePlaces} from '../apps/area-boundaries.mjs';
import {listingAreas,placeParents} from '../apps/locations.mjs';
import {rentalFacts} from '../apps/rental.mjs';
import {spbScope} from '../apps/geography.mjs';
const bytes=await readFile('data/infrastructure/osm-area-boundaries.full.json'),body=JSON.parse(bytes.toString('utf8')),boundaries=parseAreaBoundaries(body);
const placeBytes=await readFile('data/infrastructure/osm-place-boundaries.full.json'),placeBody=JSON.parse(placeBytes.toString('utf8')),places=parseAreaBoundaries(placeBody,{expectedDistricts:3,kind:'place'});
const facts=new Map();
for(const file of ['backup 06.10/spb_sale.jsonl','backup 06.10/spb_rent.jsonl'])for await(const line of createInterface({input:createReadStream(file,{encoding:'utf8'}),crlfDelay:Infinity})){
  let raw;try{raw=JSON.parse(line.replace(/^\uFEFF/,''));}catch{continue;}
  if(spbScope(raw)!=='accepted'||raw.realty_type!=='flat'||!['sale','rent'].includes(raw.deal_type))continue;
  const id=listingValues(raw)[0];if(!facts.has(id))facts.set(id,rentalFacts(raw));
}
const c=openCatalog('data/catalog.sqlite');await mkdir('artifacts/backups',{recursive:true});const backupPath=`artifacts/backups/catalog-before-locations-${Date.now()}.sqlite`;await backup(c.db,backupPath);
const report={snapshotAt:body.osm3s.timestamp_osm_base,sha256:createHash('sha256').update(bytes).digest('hex'),placeSnapshotAt:placeBody.osm3s.timestamp_osm_base,places:places.length,placeSha256:createHash('sha256').update(placeBytes).digest('hex'),districts:boundaries.length,offers:0,resolved:0,unresolved:0,byDeal:{},rentKnown:{pets:0,kids:0,deposit:0,commission:0},backupPath};
const rows=c.db.prepare('SELECT id,payload FROM listings').all(),update=c.db.prepare('UPDATE listings SET payload=? WHERE id=?');
try{c.db.exec('BEGIN IMMEDIATE');for(const row of rows){
  const item=JSON.parse(row.payload);report.offers++;
  item.geography=locateDistrict(item,boundaries,body.osm3s.timestamp_osm_base);const p=locatePlaces(item,places);item.geography.area_ids.push(...p.area_ids);item.geography.checked_places=p.checked_places;
  if(item.geography.districtResolved)for(const [id,parent]of Object.entries(placeParents))if(!item.geography.area_ids.includes(parent))item.geography.checked_places.push(id);
  item.geography.placeSnapshotAt=placeBody.osm3s.timestamp_osm_base;item.area_ids=listingAreas(item);
  if(facts.has(row.id))item.rental=facts.get(row.id);
  report[item.geography.districtResolved?'resolved':'unresolved']++;report.byDeal[item.deal_type]=(report.byDeal[item.deal_type]||0)+1;
  if(item.rental){for(const [k,field]of [['pets','pets_allowed'],['kids','kids_allowed'],['deposit','deposit_amount'],['commission','commission_amount']])if(item.rental[field]!==null)report.rentKnown[k]++;}
  update.run(JSON.stringify(item),row.id);
}c.db.prepare('INSERT OR REPLACE INTO catalog_meta VALUES (?,?)').run('geography',JSON.stringify(report));c.db.exec('COMMIT');}catch(e){c.db.exec('ROLLBACK');throw e;}finally{c.close();}
await writeFile('data/infrastructure/location-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
