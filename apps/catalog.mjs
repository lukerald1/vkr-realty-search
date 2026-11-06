import {DatabaseSync} from 'node:sqlite';
import {normalize,rankListings} from './search.mjs';
import {infrastructureKeys} from './infrastructure.mjs';

export const columns = `id TEXT PRIMARY KEY, deal_type TEXT, realty_type TEXT, rooms REAL, price REAL, area_total REAL, area_kitchen REAL, metro_minutes REAL, metro_mode TEXT, floor REAL, floors_total REAL, balcony TEXT, payload TEXT NOT NULL`;
export function openCatalog(filename) {
  const db=new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS listings (${columns});
    CREATE INDEX IF NOT EXISTS listings_filters ON listings(deal_type,realty_type,rooms,price);
    CREATE TABLE IF NOT EXISTS catalog_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  const metadata=()=>{
    const stored=db.prepare("SELECT value FROM catalog_meta WHERE key='import'").get();
    return stored?JSON.parse(stored.value):null;
  };
  function search(profile,{offset=0,limit=24,sort='relevance',ids=null}={}) {
    if(profile.outsideScope||profile.needsClarification)return{results:[],total:0,hasMore:false};
    const hard=profile.hard,where=['deal_type = ?','realty_type = ?'],values=[hard.deal_type,hard.realty_type];
    const condition=(sql,value)=>{where.push(sql);if(value!==undefined)values.push(value);};
    for(const [key,sql] of [['rooms','rooms = ?'],['price_max','price <= ?'],['price_min','price >= ?'],['area_min','area_total >= ?']]) if(hard[key]!==undefined)condition(sql,hard[key]);
    for(const [key,field,op]of [['area_max','area_total','<='],['kitchen_min','area_kitchen','>='],['kitchen_max','area_kitchen','<='],['living_min','area_living','>='],['ceiling_min','ceiling_height','>='],['floor_min','floor','>='],['floor_max','floor','<='],['floors_min','floors_total','>='],['floors_max','floors_total','<='],['year_min','build_year','>='],['year_max','build_year','<=']])if(hard[key]!==undefined)condition(`json_extract(payload,'$.${field}') ${op} ?`,hard[key]);
    for(const key of ['district','metro','renovation','house_type','bathroom','seller_type','build_status','source'])if(hard[key]!==undefined)condition(`json_extract(payload,'$.${key}') = ?`,hard[key]);
    if(hard.has_photo)condition("json_array_length(payload,'$.photos') > 0");
    for(const key of ['areas_any','areas_none'])if(hard[key]?.length){
      const sql=`EXISTS(SELECT 1 FROM json_each(payload,'$.area_ids') a WHERE a.value IN (${hard[key].map(()=>'?').join(',')}))`;
      if(key==='areas_any')condition(sql);else{
        const proof=hard[key].map(id=>id.startsWith('place:')?`EXISTS(SELECT 1 FROM json_each(payload,'$.geography.checked_places') p WHERE p.value='${id}')`:"EXISTS(SELECT 1 FROM json_each(payload,'$.area_ids') d WHERE d.value GLOB 'district:*')").join(' AND ');
        condition(`(${proof}) AND NOT ${sql}`);
      }values.push(...hard[key]);
    }
    if(hard.metro_any?.length){condition(`json_extract(payload,'$.metro') IN (${hard.metro_any.map(()=>'?').join(',')})`);values.push(...hard.metro_any);}
    for(const [k,field]of [['pets_required','pets_allowed'],['kids_required','kids_allowed']])if(hard[k])condition(`json_extract(payload,'$.rental.${field}')=1`);
    if(hard.no_commission)condition("json_extract(payload,'$.rental.commission_amount')=0");
    if(hard.deposit_max!==undefined)condition("json_extract(payload,'$.rental.deposit_amount')<=?",hard.deposit_max);
    const infraDistance=k=>`json_extract(payload,'$.infrastructure.nearby.${k}.distance_m')`;
    const infraValid=k=>`json_extract(payload,'$.infrastructure.source')='OpenStreetMap' AND json_extract(payload,'$.lat') BETWEEN -90 AND 90 AND json_extract(payload,'$.lon') BETWEEN -180 AND 180 AND json_type(payload,'$.infrastructure.nearby.${k}.distance_m') IN ('integer','real') AND ${infraDistance(k)} BETWEEN 0 AND 3000`+(k==='ranked_school'?` AND json_extract(payload,'$.infrastructure.nearby.ranked_school.rating.provider')='RAEX' AND json_extract(payload,'$.infrastructure.nearby.ranked_school.rating.scope')='Санкт-Петербург' AND json_extract(payload,'$.infrastructure.nearby.ranked_school.rating.method')='competitiveness' AND json_extract(payload,'$.infrastructure.nearby.ranked_school.rating.year')=${new Date().getFullYear()} AND json_type(payload,'$.infrastructure.nearby.ranked_school.rating.rank')='integer' AND json_extract(payload,'$.infrastructure.nearby.ranked_school.rating.rank')>0 AND json_extract(payload,'$.infrastructure.nearby.ranked_school.rating.sourceUrl') GLOB 'https://raex-rr.com/*' AND json_extract(payload,'$.infrastructure.nearby.ranked_school.rating.matchedPoiId')=json_extract(payload,'$.infrastructure.nearby.ranked_school.id')`:'');
    for(const key of infrastructureKeys)if(hard[`${key}_max_m`]!==undefined)condition(`(${infraValid(key)}) AND ${infraDistance(key)} <= ?`,hard[`${key}_max_m`]);
    if(hard.metro_max!==undefined){condition('metro_minutes <= ?',hard.metro_max);condition('metro_mode = ?',hard.metro_mode_f);}
    if(hard.floor_not_first)condition('floor > 1');
    if(hard.floor_not_last)condition('floor < floors_total');
    if(hard.balcony_required!==undefined)condition(hard.balcony_required?"balcony IS NOT NULL AND balcony != 'Нет'":"balcony = 'Нет'");
    if(ids){if(!ids.length)return{results:[],total:0,hasMore:false};condition(`id IN (${ids.map(()=>'?').join(',')})`);values.push(...ids);}
    const clause=where.join(' AND ');
    const total=db.prepare(`SELECT count(*) AS n FROM listings WHERE ${clause}`).get(...values).n;
    // Same baseline score as rankListings, calculated before LIMIT across the whole catalog.
    const score=[];
    if(profile.geoPreferred?.length){const safe=profile.geoPreferred.filter(v=>/^[a-z]+:[a-z0-9]+$/.test(v));if(safe.length)score.push(`CASE WHEN EXISTS(SELECT 1 FROM json_each(payload,'$.area_ids') a WHERE a.value IN (${safe.map(v=>"'"+v+"'").join(',')})) THEN 1 ELSE 0 END`);}
    if(profile.soft.includes('metro'))score.push("CASE WHEN metro_mode='walk' AND metro_minutes IS NOT NULL THEN max(0,30-metro_minutes)/30.0 ELSE 0 END");
    if(profile.soft.includes('kitchen'))score.push('CASE WHEN area_kitchen IS NOT NULL THEN min(area_kitchen/20.0,1) ELSE 0 END');
    const infraSoft=profile.soft.filter(k=>infrastructureKeys.includes(k));
    const infraScore=k=>`CASE WHEN ${infraValid(k)} THEN max(0,1-${infraDistance(k)}/3001.0) ELSE 0 END`;
    infraSoft.forEach(k=>score.push(infraScore(k)));
    const priority=infraSoft.length?`${infraScore(infraSoft[0])} DESC, `:'';
    const order=sort==='price'?'price IS NULL, price ASC':sort==='area'?'area_total IS NULL, area_total DESC':score.length?`${priority}(${score.join('+')}) DESC`:'id';
    const rows=db.prepare(`SELECT payload FROM listings WHERE ${clause} ORDER BY ${order},id LIMIT ? OFFSET ?`).all(...values,limit,offset);
    const results=rows.map(row=>{
      const item=JSON.parse(row.payload);
      return rankListings([item],profile)[0];
    }).filter(Boolean);
    return{results,total,hasMore:offset+limit<total};
  }
  const facets=()=>Object.fromEntries(['district','metro','renovation','house_type','bathroom','seller_type','build_status','source'].map(key=>[key,db.prepare(`SELECT DISTINCT json_extract(payload,'$.${key}') AS value FROM listings WHERE value IS NOT NULL AND value != '' ORDER BY value`).all().map(r=>r.value)]));
  const byIds=ids=>ids.length?db.prepare(`SELECT payload FROM listings WHERE id IN (${ids.map(()=>'?').join(',')})`).all(...ids).map(row=>JSON.parse(row.payload)):[];
  return {db,metadata,search,facets,byIds,close:()=>db.close()};
}
export function listingValues(raw) {
  const item=normalize(raw);
  // Sale/rent are different offers even if the upstream grouping key collides.
  item.id=`${item.deal_type}:${item.id}`;
  return [item.id,item.deal_type,item.realty_type,item.rooms,item.price,item.area_total,item.area_kitchen,item.metro_minutes,item.metro_mode,item.floor,item.floors_total,item.balcony,JSON.stringify(item)];
}
