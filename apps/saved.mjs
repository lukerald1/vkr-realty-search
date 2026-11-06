import {normalize} from './search.mjs';
import {ProviderError} from './metrapi.mjs';
export function validateSavedRequest(body){
  if(!body||!Array.isArray(body.ids)||body.ids.length>500||body.ids.some(id=>typeof id!=='string'||id.length>300))throw new ProviderError('Некорректный список избранного',400);
  const offset=body.offset??0,sort=body.sort??'relevance';
  if(!Number.isSafeInteger(offset)||offset<0||offset>100000||!['relevance','price','area'].includes(sort))throw new ProviderError('Некорректная страница или сортировка',400);
  return {ids:[...new Set(body.ids)],offset,sort};
}
export function savedListings(raw,{ids,offset=0,sort='relevance',limit=24}){
  const indexed=new Map(raw.map(normalize).filter(i=>i.city==='spb'&&i.realty_type==='flat'&&['sale','rent'].includes(i.deal_type)).map(i=>[i.id,i]));
  const rows=ids.map(id=>indexed.get(id)).filter(Boolean).map(item=>({...item,score:0,reasons:['Сохранено в избранном']}));
  if(sort==='price')rows.sort((a,b)=>(a.price??Infinity)-(b.price??Infinity)||a.id.localeCompare(b.id));
  if(sort==='area')rows.sort((a,b)=>(b.area_total??-Infinity)-(a.area_total??-Infinity)||a.id.localeCompare(b.id));
  return {results:rows.slice(offset,offset+limit),total:rows.length,hasMore:offset+limit<rows.length};
}
