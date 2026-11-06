// Offline only: never send listing addresses or coordinates to a network service.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {openCatalog,listingValues} from '../apps/catalog.mjs';
import {spbScope} from '../apps/geography.mjs';
import {parseOsm,buildPoiIndex,validCoordinates,applyGeometryOverlay} from '../apps/infrastructure.mjs';
const snapshotBytes=await readFile('data/infrastructure/osm-spb.json');
const snapshot=JSON.parse(snapshotBytes.toString('utf8').replace(/^\uFEFF/,''));
let pois=parseOsm(snapshot);
const source={snapshotAt:snapshot.osm3s.timestamp_osm_base,checkedAt:new Date().toISOString()},geometryLayers=[];
if(!pois.length)throw new Error('Пустой снимок: каталог сохранён');
for(const category of ['school','park']){
  let bytes;try{bytes=await readFile(`data/infrastructure/osm-${category}-geometry.json`);}catch(e){if(e.code==='ENOENT')continue;throw e;}
  const layer=applyGeometryOverlay(pois,JSON.parse(bytes.toString('utf8')),{category,baseTimestamp:source.snapshotAt});
  pois=layer.pois;geometryLayers.push({...layer.report,sha256:createHash('sha256').update(bytes).digest('hex')});
}
// Ratings are joined only through an explicitly reviewed OSM identifier, never by fuzzy name.
let reviewed=[];try{reviewed=JSON.parse(await readFile('config/school-ratings.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
for(const poi of pois){const match=reviewed.find(r=>r.matchedPoiId===poi.id);if(match)poi.rating=match;}
const nearby=buildPoiIndex(pois),coordinates=new Map();
const rawFiles=process.argv.slice(2).length?process.argv.slice(2):['backup 06.10/spb_sale.jsonl','backup 06.10/spb_rent.jsonl'];
for(const file of rawFiles){
  for await(const line of createInterface({input:createReadStream(file,{encoding:'utf8'}),crlfDelay:Infinity})){
    let raw;try{raw=JSON.parse(line.replace(/^\uFEFF/,''));}catch{continue;}
    if(spbScope(raw)!=='accepted'||raw.realty_type!=='flat'||!['sale','rent'].includes(raw.deal_type))continue;
    const id=listingValues(raw)[0];if(coordinates.has(id))continue;
    const lat=raw.lat===null||raw.lat===''?null:Number(raw.lat),lon=raw.lon===null||raw.lon===''?null:Number(raw.lon);
    coordinates.set(id,validCoordinates(lat,lon)?{lat,lon}:{lat:null,lon:null});
  }
}
const catalog=openCatalog(process.env.CATALOG_PATH||'data/catalog.sqlite');
await mkdir('artifacts/backups',{recursive:true});
const backupPath=`artifacts/backups/catalog-before-infrastructure-${Date.now()}.sqlite`;
await backup(catalog.db,backupPath);
const report={...source,pois:pois.length,byCategory:{},offers:0,withCoordinates:0,enriched:0,missingCoordinates:0,outsidePilot:0,
  snapshotSha256:createHash('sha256').update(snapshotBytes).digest('hex'),sourceUrl:'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  geometryMode:pois.some(p=>p.geometry)?'mixed_geometry':'points_and_contour_centres',geometryLayers,reviewedSchoolInstitutions:new Set(reviewed.map(r=>r.schoolName)).size,
  bbox:[59.65,29.4,60.25,30.85],radius_m:3000,byFeature:{},byMeasurement:{},backupPath};
for(const p of pois)report.byCategory[p.category]=(report.byCategory[p.category]||0)+1;
const rows=catalog.db.prepare('SELECT id,payload FROM listings').all(),update=catalog.db.prepare('UPDATE listings SET payload=? WHERE id=?');
try{
  catalog.db.exec('BEGIN IMMEDIATE');
  for(const row of rows){
    const item={...JSON.parse(row.payload),...(coordinates.get(row.id)||{})};report.offers++;
    item.infrastructure=null;
    if(!validCoordinates(item.lat,item.lon))report.missingCoordinates++;
    else {
      report.withCoordinates++;
      // Leave a 3km margin: edge truncation must not pretend to identify the nearest POI.
      if(item.lat<59.68||item.lat>60.22||item.lon<29.46||item.lon>30.79)report.outsidePilot++;
      else {
        item.infrastructure=nearby(item,source);report.enriched++;
        for(const [k,feature] of Object.entries(item.infrastructure.nearby)){report.byFeature[k]=(report.byFeature[k]||0)+1;report.byMeasurement[feature.method]=(report.byMeasurement[feature.method]||0)+1;}
      }
    }
    update.run(JSON.stringify(item),row.id);
  }
  catalog.db.prepare('INSERT OR REPLACE INTO catalog_meta VALUES (?,?)').run('infrastructure',JSON.stringify(report));
  catalog.db.exec('COMMIT');
}catch(e){catalog.db.exec('ROLLBACK');throw e;}finally{catalog.close();}
await writeFile('data/infrastructure/enrichment-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
