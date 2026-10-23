import http from 'node:http';
import {readFile, stat, mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {buildSearchProfile, rankListings} from './search.mjs';
import {demoListings} from './demo.mjs';
import {createMetrapi, ProviderError} from './metrapi.mjs';
import {openCatalog} from './catalog.mjs';
import {openActivity} from './activity.mjs';
import {spbScope} from './geography.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const publicRoot = path.join(root,'apps','public');
const mode = process.env.DATA_MODE || 'snapshot';
if (!['snapshot','metrapi'].includes(mode)) throw new Error('DATA_MODE must be snapshot or metrapi');
let listings = demoListings, dataset = 'demo', snapshotDate = null;
const catalogPath=path.resolve(root,process.env.CATALOG_PATH||'data/catalog.sqlite');
const catalog=mode==='snapshot'&&existsSync(catalogPath)?openCatalog(catalogPath):null;
const imported=catalog?.metadata();
const filterFacets=catalog?.facets()||{};
await mkdir(path.join(root,'data'),{recursive:true});
const activity=openActivity(path.join(root,'data','activity.sqlite'));
if (mode === 'snapshot' && !catalog) {
  const snapshotPath = path.resolve(root,process.env.SNAPSHOT_PATH || 'test_spb_sale.jsonl');
  try {
    const content = await readFile(snapshotPath,'utf8');
    listings = content.replace(/^\uFEFF/,'').split(/\r?\n/).filter(v=>v.trim()).map(v=>JSON.parse(v));
    dataset = 'snapshot'; snapshotDate = (await stat(snapshotPath)).mtime.toISOString();
  } catch(error) {
    if (error.code !== 'ENOENT') throw new Error('Не удалось прочитать JSONL: проверьте формат локального снимка.');
  }
}
const provider = createMetrapi({key:process.env.METRAPI_API_KEY});
const metadata = () => ({mode: mode === 'metrapi' ? 'metrapi' : dataset,
  ...(catalog?{mode:'database'}:{}),
  total: mode === 'metrapi' ? null : imported?.accepted ?? listings.length, snapshotDate,
  byDeal:imported?.byDeal||null,importedAt:imported?.importedAt||null,
  extractor:'rules', ranker:'rules', city:'Санкт-Петербург'});
const json = (res,status,data) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function readJson(req) {
  let body = '';
  for await (const chunk of req) {body += chunk; if(Buffer.byteLength(body)>16000) throw new ProviderError('Слишком большой запрос',413);}
  try { return JSON.parse(body); } catch { throw new ProviderError('Некорректный JSON',400); }
}
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const staticFiles = new Set(['/index.html','/styles.css','/air.css','/app.js','/building.svg','/hero.png']);
const server = http.createServer(async(req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' https:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  try {
    const url = new URL(req.url,'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      // The first prototype is loopback-only. Reject cross-site POSTs even locally.
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) return json(res,403,{error:'Запрос с другого сайта запрещён'});
      const cookie=String(req.headers.cookie||'').match(/(?:^|;\s*)prostor_session=([a-f0-9-]{36})(?:;|$)/);
      const session=cookie?.[1]||randomUUID();
      if(!cookie)res.setHeader('Set-Cookie',`prostor_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`);
      if (url.pathname === '/api/meta' && req.method === 'GET') return json(res,200,metadata());
      if (url.pathname === '/api/filters' && req.method === 'GET') return json(res,200,{facets:filterFacets});
      if (url.pathname === '/api/history' && req.method === 'GET') return json(res,200,{searches:activity.history(session)});
      if (url.pathname === '/api/events' && req.method === 'POST') {
        const body=await readJson(req);
        const ok=Boolean(body&&activity.event(session,body));
        return json(res,ok?200:400,{ok});
      }
      if (url.pathname === '/api/search' && req.method === 'POST') {
        const body = await readJson(req);
        if (!body || typeof body.query !== 'string' || body.query.length > 2000) return json(res,400,{error:'Запрос должен быть строкой до 2000 символов'});
        let profile;
        try {profile = buildSearchProfile(body.query,body.filters || {},body.searchMode??'text');} catch {return json(res,400,{error:'Некорректные фильтры или способ поиска'});}
        const offset=Number(body.offset??0),limit=24,sort=body.sort||'relevance';
        if(!Number.isSafeInteger(offset)||offset<0||offset>100000||!['relevance','price','area'].includes(sort))return json(res,400,{error:'Некорректная страница или сортировка'});
        if(body.ids!==undefined&&(!Array.isArray(body.ids)||body.ids.length>500||body.ids.some(id=>typeof id!=='string'||id.length>300)))return json(res,400,{error:'Некорректный список избранного'});
        let result,fetchedAt=null;
        if(catalog) result=catalog.search(profile,{offset,limit,sort,ids:body.ids??null});
        else {
          const upstream=mode==='metrapi'&&!profile.outsideScope?await provider(profile.hard):{items:profile.outsideScope?[]:listings,hasMore:false};
          fetchedAt=upstream.fetchedAt||null;
          // Enforce SPB for live data too: city=spb includes suburbs outside the federal city.
          const scoped=mode!=='metrapi'&&dataset==='demo'?upstream.items:upstream.items.filter(item=>spbScope(item)==='accepted');
          let ranked=rankListings(scoped,profile);
          if(body.ids)ranked=ranked.filter(item=>body.ids.includes(item.id));
          if(sort==='price')ranked.sort((a,b)=>(a.price??Infinity)-(b.price??Infinity));
          if(sort==='area')ranked.sort((a,b)=>(b.area_total??-Infinity)-(a.area_total??-Infinity));
          result={results:ranked.slice(offset,offset+limit),total:ranked.length,hasMore:offset+limit<ranked.length,providerHasMore:upstream.hasMore};
        }
        const searchId=body.context==='preview'?null:activity.search(session,body.query,profile,result.total,result.results,offset);
        return json(res,200,{profile,results:result.results,searchId,meta:{...metadata(),hasMore:result.hasMore,providerHasMore:result.providerHasMore||false,totalMatched:result.total,offset,limit,fetchedAt}});
      }
      return json(res,404,{error:'Неизвестный маршрут'});
    }
    if (!['GET','HEAD'].includes(req.method)) return json(res,405,{error:'Метод не поддерживается'});
    const route = ['/','/search'].includes(url.pathname) ? '/index.html' : url.pathname;
    if (!staticFiles.has(route)) return json(res,404,{error:'Не найдено'});
    const content = await readFile(path.join(publicRoot,route));
    res.writeHead(200,{'Content-Type':mime[path.extname(route)],'Cache-Control':'no-cache'});
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch(error) {
    if (!res.headersSent) json(res,error instanceof ProviderError ? error.status : 500,{error:error instanceof ProviderError ? error.message : 'Внутренняя ошибка сервера'});
    else res.end();
  }
});
const host=process.env.HOST || '127.0.0.1';
if(host !== '127.0.0.1' && host !== 'localhost') throw new Error('Для сетевого запуска сначала добавьте аутентификацию и ограничение запросов.');
server.listen(Number(process.env.PORT || 3100),host,()=>console.log(`Local: http://${host}:${process.env.PORT || 3100} (${mode === 'metrapi' ? 'Metrapi' : catalog?'database':dataset})`));
