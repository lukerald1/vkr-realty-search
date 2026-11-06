// Extensible, source-backed proximity features; not a quality or safety rating.
export const categories = {
  ranked_school:{label:'Школа из RAEX',pattern:'школ[а-я]*\\s+из\\s+рейтинг[а-я]*(?:\\s+raex)?|рейтингов[а-я]*\\s+школ[а-я]*|raex'},
  school:{label:'Школа',pattern:'школ[а-я]*|лице[а-я]*|гимнази[а-я]*'},
  kindergarten:{label:'Детский сад',pattern:'детск[а-я]*\\s+сад[а-я]*|садик[а-я]*'},
  clinic:{label:'Поликлиника',pattern:'поликлиник[а-я]*|клиник[а-я]*'},
  hospital:{label:'Больница',pattern:'больниц[а-я]*'},
  pharmacy:{label:'Аптека',pattern:'аптек[а-я]*'},
  park:{label:'Парк',pattern:'парк[а-я]*|сквер[а-я]*'},
  grocery:{label:'Продуктовый магазин',pattern:'магазин[а-я]*|супермаркет[а-я]*|продуктов[а-я]*'},
  university:{label:'Вуз',pattern:'университет[а-я]*|вуз[а-я]*'},
  cafe:{label:'Кафе',pattern:'кафе|кофейн[а-я]*'},
  playground:{label:'Детская площадка',pattern:'детск[а-я]*\\s+площадк[а-я]*'},
  fitness:{label:'Фитнес',pattern:'фитнес[а-я]*|спортзал[а-я]*'},
  shopping:{label:'Торговый центр',pattern:'торгов[а-я]*\\s+центр[а-я]*|трк|трц'}
};
export const infrastructureKeys=Object.keys(categories);
export const distanceKeys=infrastructureKeys.map(k=>`${k}_max_m`);
export function verifiedSchoolRating(r,id,year=new Date().getFullYear()){
  return r?.provider==='RAEX'&&r.scope==='Санкт-Петербург'&&r.method==='competitiveness'&&Number.isInteger(r.rank)&&r.rank>0&&r.year===year&&/^https:\/\/raex-rr\.com\//.test(r.sourceUrl||'')&&r.matchedPoiId===id;
}
export function parseInfrastructure(query){
  const text=query.toLowerCase().replace(/ё/g,'е'), mentions=[],hard={},unknown=[],questions=[];
  for(const [key,{pattern,label}] of Object.entries(categories)){
    const re=new RegExp(`(?<![а-я])(?:${pattern})(?![а-я])`,'g');
    const matches=[...text.matchAll(re)];if(!matches.length)continue;
    if(key==='grocery'&&/магазин/.test(text)&&!/продукт|супермаркет/.test(text)){
      questions.push('Уточните тип магазина: пилот рассчитывает близость продуктовых магазинов и супермаркетов.');continue;
    }
    if(new RegExp(`(?:без|подальше от|не рядом с)\\s+(?:${pattern})`).test(text)){
      unknown.push(`${label}: удалённость или исключение объектов пока не поддерживаются`);
      questions.push(`${label}: поиск поддерживает близость. Уточните условие об удалённости.`);continue;
    }
    let position=matches[0].index;
    const priority=new RegExp(`(?:главное|важнее всего|приоритет)[^.,;!?]{0,30}(?:${pattern})`).exec(text);
    if(priority)position=-1000+priority.index;
    mentions.push({key,position});
    // Numeric distances qualify only this nearby mention. No conversion of walking time to metres.
    for(const m of matches){
      const before=text.slice(Math.max(0,m.index-30),m.index),after=text.slice(m.index+m[0].length,m.index+m[0].length+35);
      const distance=after.match(/^\s*(?:(?:не далее|не дальше|не более|до|в пределах|в радиусе)\s*)(\d+(?:[.,]\d+)?)\s*(км|метр[а-я]*|м)(?![а-я])/)
        ||before.match(/(?:не далее|не дальше|не более|до|в пределах|в радиусе)\s*(\d+(?:[.,]\d+)?)\s*(км|метр[а-я]*|м)\s*(?:от|до)?\s*$/);
      if(distance){hard[`${key}_max_m`]=Number(distance[1].replace(',','.'))*(distance[2]==='км'?1000:1);if(hard[`${key}_max_m`]>3000)questions.push(`${label}: пилот поддерживает предел до 3000 м по прямой. Укажите меньший радиус.`);}
      if(/\d+\s*мин|пешком/.test(before+after))questions.push(`${label}: пока доступно расстояние по прямой, а не пеший маршрут. Укажите предел в метрах по прямой или измените условие.`);
    }
    if(new RegExp(`(?:обязательн[а-я]*|только)[^.,;!?]{0,35}(?:${pattern})|(?:${pattern})[^.,;!?]{0,20}обязательн[а-я]*`).test(text)&&hard[`${key}_max_m`]===undefined)
      questions.push(`${label}: задайте обязательный предел расстояния в метрах по прямой.`);
  }
  if(/(?:хорош[а-я]*|лучш[а-я]*)[^.,;!?]{0,30}(?:школ|лице|гимнази)/.test(text))unknown.push('Качество школы: близость учитывается; места RAEX показываются отдельно и не являются общей оценкой школы');
  if(/(?:обязательн[а-я]*|только)[^.,;!?]{0,30}(?:хорош[а-я]*|лучш[а-я]*)[^.,;!?]{0,25}(?:школ|лице|гимнази)/.test(text))questions.push('Обязательное качество школы не определено. Задайте проверяемый критерий; место в RAEX не является общей оценкой школы.');
  if(/(?:детск[а-я]*|взросл[а-я]*|государственн[а-я]*|по омс)\s+(?:поликлиник|клиник)|(?:государственн[а-я]*|частн[а-я]*)\s+(?:школ|сад)/.test(text))questions.push('Возрастная группа, форма собственности и приём по ОМС инфраструктуры пока не проверены. Уточните условие: общий объект рядом не подтверждает эти свойства.');
  const rankedRequested=mentions.some(m=>m.key==='ranked_school');
  return {hard,soft:mentions.sort((a,b)=>a.position-b.position).map(m=>m.key).filter(k=>!rankedRequested||k!=='school'),unknown,questions};
}
export function validCoordinates(lat,lon){return typeof lat==='number'&&typeof lon==='number'&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;}
export const haversine=(a,b)=>{const r=Math.PI/180,dlat=(b.lat-a.lat)*r,dlon=(b.lon-a.lon)*r;return 6371000*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlon/2)**2)));};
function segmentDistance(p,a,b){
  const k=Math.PI/180*6371000,x=(b.lon-a.lon)*k*Math.cos(p.lat*Math.PI/180),y=(b.lat-a.lat)*k;
  const px=(p.lon-a.lon)*k*Math.cos(p.lat*Math.PI/180),py=(p.lat-a.lat)*k;
  const t=Math.max(0,Math.min(1,(px*x+py*y)/(x*x+y*y||1)));return Math.hypot(px-t*x,py-t*y);
}
export function poiDistance(p,poi){
  const g=poi.geometry;
  if(!g?.length)return haversine(p,poi);
  const closed=g.length>3&&g[0].lat===g.at(-1).lat&&g[0].lon===g.at(-1).lon;
  let inside=false,min=Infinity;
  for(let i=1;i<g.length;i++){
    const a=g[i-1],b=g[i];min=Math.min(min,segmentDistance(p,a,b));
    if(closed&&(a.lat>p.lat)!==(b.lat>p.lat)&&p.lon<(b.lon-a.lon)*(p.lat-a.lat)/(b.lat-a.lat)+a.lon)inside=!inside;
  }
  return inside?0:min;
}
export function osmCategory(tags){
  if(tags.leisure==='park'||tags.leisure==='garden')return 'park';
  if(['supermarket','convenience'].includes(tags.shop))return 'grocery';
  if(tags.shop==='mall')return 'shopping';
  if(tags.amenity==='clinic'||tags.healthcare==='clinic')return 'clinic';
  if(['school','kindergarten','hospital','pharmacy','university','cafe'].includes(tags.amenity))return tags.amenity;
  if(tags.leisure==='playground')return 'playground';if(tags.leisure==='fitness_centre')return 'fitness';return null;
}
export function parseOsm(body){
  if(body.remark||!Array.isArray(body.elements)||!body.osm3s?.timestamp_osm_base)throw new Error('Неполный снимок OSM');
  return body.elements.flatMap(e=>{
    const g=e.geometry;
    const bounds=g?.length&&g.every(p=>validCoordinates(p.lat,p.lon))?geometryBounds(g):null;
    // Overpass may emit bounds instead of center when `out geom` is requested.
    const category=osmCategory(e.tags||{}),point=e.center||(bounds?{lat:(bounds.south+bounds.north)/2,lon:(bounds.west+bounds.east)/2}:e);
    if(!category||!validCoordinates(point.lat,point.lon))return [];
    const geometry=e.type==='way'&&g?.length>=4&&g.every(p=>validCoordinates(p.lat,p.lon))&&g[0].lat===g.at(-1).lat&&g[0].lon===g.at(-1).lon?g:null;
    return [{id:`${e.type}/${e.id}`,category,name:e.tags.name||e.tags['name:ru']||categories[category].label,lat:point.lat,lon:point.lon,geometry,method:e.center||bounds?'mapped_center':'mapped_point',
      address:[e.tags['addr:street'],e.tags['addr:housenumber']].filter(Boolean).join(', '),sourceUrl:`https://www.openstreetmap.org/${e.type}/${e.id}`}];
  });
}
function geometryBounds(points){
  return points.reduce((a,p)=>({south:Math.min(a.south,p.lat),north:Math.max(a.north,p.lat),west:Math.min(a.west,p.lon),east:Math.max(a.east,p.lon)}),{south:Infinity,north:-Infinity,west:Infinity,east:-Infinity});
}
// Keep each dataset's date. A shape is joined only to the same OSM object/category.
export function applyGeometryOverlay(pois,body,{category,baseTimestamp}){
  if(!['school','park'].includes(category))throw new Error('Неподдерживаемый слой геометрии');
  const date=Date.parse(body.osm3s?.timestamp_osm_base),baseDate=Date.parse(baseTimestamp);
  if(!Number.isFinite(date)||!Number.isFinite(baseDate)||date<baseDate)throw new Error('Слой геометрии старее основного снимка или дата некорректна');
  const parsed=parseOsm(body);
  if(!parsed.length||parsed.some(p=>p.category!==category))throw new Error('Неверная категория геометрии');
  const shapes=new Map(parsed.filter(p=>p.geometry).map(p=>[p.id,p]));let matched=0;
  const result=pois.map(p=>{
    const shape=shapes.get(p.id);
    if(!shape||p.category!==category)return p;
    matched++;return {...p,geometry:shape.geometry,geometrySnapshotAt:body.osm3s.timestamp_osm_base};
  });
  if(!matched)throw new Error('Не найдены совпадающие замкнутые контуры');
  return {pois:result,report:{category,snapshotAt:body.osm3s.timestamp_osm_base,received:parsed.length,validClosedShapes:shapes.size,matched}};
}
// Grid indexes full mapped geometry; a large park containing the offer remains a candidate.
export function buildPoiIndex(pois){
  const grid=new Map(),cell=(lat,lon)=>[Math.floor(lat/.02),Math.floor(lon/.04)];
  for(const poi of pois){
    const points=poi.geometry?.length?poi.geometry:[poi];
    const bounds=geometryBounds(points),a=cell(bounds.south,bounds.west),b=cell(bounds.north,bounds.east);
    for(let y=a[0];y<=b[0];y++)for(let x=a[1];x<=b[1];x++){const k=`${y}:${x}`;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(poi);}
  }
  return (point,source)=>{
    if(!validCoordinates(point.lat,point.lon))return null;
    const [y,x]=cell(point.lat,point.lon),seen=new Set(),nearby={},distances={};
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)for(const poi of grid.get(`${y+dy}:${x+dx}`)||[]){
      if(seen.has(poi.id))continue;seen.add(poi.id);const distance=poiDistance(point,poi);
      if(distance>3000)continue;
      // Round upwards so 500.4 m can never satisfy an obligatory 500 m limit.
      const reviewed=verifiedSchoolRating(poi.rating,poi.id);
      const feature={id:poi.id,name:reviewed&&poi.rating.schoolName?poi.rating.schoolName:poi.name,distance_m:Math.ceil(distance),sourceUrl:poi.sourceUrl,
        ...(reviewed&&poi.rating.schoolName!==poi.name?{mappedName:poi.name,identitySource:poi.rating.identitySource}:{}),
        ...(poi.geometrySnapshotAt?{geometrySnapshotAt:poi.geometrySnapshotAt}:{}),
        method:poi.geometry?'mapped_geometry':poi.method||'mapped_point',...(poi.rating?{rating:poi.rating}:{})};
      if(distances[poi.category]===undefined||distances[poi.category]>distance){nearby[poi.category]=feature;distances[poi.category]=distance;}
      if(poi.category==='school'&&verifiedSchoolRating(poi.rating,poi.id)&&(distances.ranked_school===undefined||distances.ranked_school>distance)){nearby.ranked_school=feature;distances.ranked_school=distance;}
    }
    return {source:'OpenStreetMap',snapshotAt:source.snapshotAt,checkedAt:source.checkedAt,coordinateSource:'listing_unverified',radius_m:3000,nearby};
  };
}
export function infrastructureFeature(item,key){
  const infra=item.infrastructure,v=infra?.nearby?.[key];
  return infra?.source==='OpenStreetMap'&&validCoordinates(item.lat,item.lon)&&v&&Number.isFinite(v.distance_m)&&v.distance_m>=0&&v.distance_m<=3000&&(key!=='ranked_school'||verifiedSchoolRating(v.rating,v.id))?v:null;
}
export function proximityScore(item,key){const v=infrastructureFeature(item,key);return v?Math.max(0,1-v.distance_m/3001):0;}
export function infrastructureBadges(item,profile){
  const keys=[...new Set([...profile.soft.filter(k=>infrastructureKeys.includes(k)),...infrastructureKeys.filter(k=>profile.hard[`${k}_max_m`]!==undefined)])];
  const shown=new Set();
  return keys.flatMap((key,index)=>{
    const v=infrastructureFeature(item,key);if(!v)return [{category:key,text:`${categories[key].label}: нет данных в пилоте`,sourceUrl:'https://www.openstreetmap.org/copyright',detail:'Объект не найден в загруженном снимке в пределах 3 км либо отсутствуют координаты/покрытие. Это не доказывает отсутствие объекта в городе.',measurement:'Наличие и отсутствие не подтверждены'}];
    if(shown.has(v.id))return [];shown.add(v.id);
    const r=v.rating,verified=verifiedSchoolRating(r,v.id);
    return [{category:key,text:`${v.name} · ${v.distance_m} м по прямой`,sourceUrl:v.sourceUrl,
      measurement:v.method==='mapped_geometry'?'До нанесённой территории':v.method==='mapped_center'?'До центра контура на карте':'До точки на карте',
      detail:`OSM · снимок ${item.infrastructure.snapshotAt}${v.geometrySnapshotAt?`; геометрия ${v.geometrySnapshotAt}`:''}. Расстояние до ${v.method==='mapped_geometry'?'нанесённой территории':v.method==='mapped_center'?'центра контура на карте':'точки на карте'}, не до входа; округлено вверх до метра. Координаты объявления не проверены.`,
      ...(verified?{ratingText:`${index===0?'🔥 ':''}RAEX ${r.year} · № ${r.rank} в СПб`,ratingUrl:r.sourceUrl,ratingDetail:'Конкурентоспособность выпускников: поступление в ведущие вузы. Не гарантирует зачисление и не определяет качество каждой параллели.'}:{})}];
  }).slice(0,2);
}
