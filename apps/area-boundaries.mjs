import {areas} from './locations.mjs';
import {validCoordinates} from './infrastructure.mjs';
const key=p=>`${p.lat},${p.lon}`;
export function joinRings(parts){
  const pending=parts.map(p=>p.map(v=>({...v}))),rings=[];
  while(pending.length){
    const ring=pending.pop();if(ring.length<2)throw Error('Неполный участок границы');
    while(key(ring[0])!==key(ring.at(-1))){
      const end=key(ring.at(-1)),i=pending.findIndex(p=>key(p[0])===end||key(p.at(-1))===end);
      if(i<0)throw Error('Незамкнутая граница территории');
      const next=pending.splice(i,1)[0];if(key(next[0])!==end)next.reverse();ring.push(...next.slice(1));
    }
    if(ring.length<4)throw Error('Вырожденная граница');rings.push(ring);
  }
  return rings;
}
export function insideRing(p,ring){
  let inside=false;
  for(let i=1;i<ring.length;i++){
    const a=ring[i-1],b=ring[i];
    if((a.lat>p.lat)!==(b.lat>p.lat)&&p.lon<(b.lon-a.lon)*(p.lat-a.lat)/(b.lat-a.lat)+a.lon)inside=!inside;
  }
  return inside;
}
export function parseAreaBoundaries(body,{expectedDistricts=18,kind='district'}={}){
  if(body.remark||!Number.isFinite(Date.parse(body.osm3s?.timestamp_osm_base))||!Array.isArray(body.elements))throw Error('Неполный снимок границ');
  const seen=new Set(),result=[];
  for(const e of body.elements){
    const area=areas.find(a=>kind==='district'?a.kind==='district'&&a.label===e.tags?.name:a.kind==='place'&&a.sourceLabels.includes(e.tags?.name?.replace(/^округ /,'')));
    if(!area||e.tags.admin_level!==(kind==='district'?'5':'8')||e.type!=='relation'||seen.has(area.id))throw Error('Неверная или повторная территория');
    const parts={outer:[],inner:[]};
    for(const m of e.members||[])if(m.type==='way'&&['outer','inner',''].includes(m.role)){
      if(!m.geometry?.length||!m.geometry.every(p=>validCoordinates(p.lat,p.lon)))throw Error('Отсутствует геометрия границы');
      parts[m.role==='inner'?'inner':'outer'].push(m.geometry);
    }
    const outer=joinRings(parts.outer),inner=joinRings(parts.inner);if(!outer.length)throw Error('Нет внешней границы');
    const bbox=outer.flat().reduce((a,p)=>({south:Math.min(a.south,p.lat),north:Math.max(a.north,p.lat),west:Math.min(a.west,p.lon),east:Math.max(a.east,p.lon)}),{south:90,north:-90,west:180,east:-180});
    result.push({id:area.id,label:area.label,outer,inner,bbox,sourceUrl:`https://www.openstreetmap.org/relation/${e.id}`});seen.add(area.id);
  }
  if(result.length!==expectedDistricts)throw Error('Не загружены все ожидаемые районы');return result;
}
export function locateDistrict(point,boundaries,snapshotAt){
  if(!validCoordinates(point.lat,point.lon))return {area_ids:[],districtResolved:false,method:'missing_coordinates'};
  const matched=boundaries.filter(b=>point.lat>=b.bbox.south&&point.lat<=b.bbox.north&&point.lon>=b.bbox.west&&point.lon<=b.bbox.east&&b.outer.some(r=>insideRing(point,r))&&!b.inner.some(r=>insideRing(point,r)));
  return {area_ids:matched.length===1?[matched[0].id]:[],districtResolved:matched.length===1,method:matched.length===1?'osm_boundary':'unresolved_coordinates',snapshotAt,coordinateSource:'listing_unverified',...(matched.length===1?{sourceUrl:matched[0].sourceUrl}:{})};
}
export function locatePlaces(point,boundaries){
  if(!validCoordinates(point.lat,point.lon))return {area_ids:[],checked_places:[]};
  return {checked_places:boundaries.map(b=>b.id),area_ids:boundaries.filter(b=>point.lat>=b.bbox.south&&point.lat<=b.bbox.north&&point.lon>=b.bbox.west&&point.lon<=b.bbox.east&&b.outer.some(r=>insideRing(point,r))&&!b.inner.some(r=>insideRing(point,r))).map(b=>b.id)};
}
