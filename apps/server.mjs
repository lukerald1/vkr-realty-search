import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {parseQuery, applyOverrides, rankListings} from './search.mjs';
import {demoListings} from './demo.mjs';
import {createMetrapi, ProviderError} from './metrapi.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const publicRoot = path.join(root,'apps','public');
const mode = process.env.DATA_MODE || 'snapshot';
if (!['snapshot','metrapi'].includes(mode)) throw new Error('DATA_MODE must be snapshot or metrapi');
let listings = demoListings, dataset = 'demo', snapshotDate = null;
if (mode === 'snapshot') {
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
  total: mode === 'metrapi' ? null : listings.length, snapshotDate,
  extractor:'rules', ranker:'rules', city:'Санкт-Петербург'});
const json = (res,status,data) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function readJson(req) {
  let body = '';
  for await (const chunk of req) {body += chunk; if(Buffer.byteLength(body)>16000) throw new ProviderError('Слишком большой запрос',413);}
  try { return JSON.parse(body); } catch { throw new ProviderError('Некорректный JSON',400); }
}
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const staticFiles = new Set(['/index.html','/styles.css','/app.js','/building.svg','/hero.png']);
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
      if (url.pathname === '/api/meta' && req.method === 'GET') return json(res,200,metadata());
      if (url.pathname === '/api/search' && req.method === 'POST') {
        const body = await readJson(req);
        if (!body || typeof body.query !== 'string' || body.query.length > 2000) return json(res,400,{error:'Запрос должен быть строкой до 2000 символов'});
        let profile;
        try {profile = applyOverrides(parseQuery(body.query),body.filters || {});} catch {return json(res,400,{error:'Некорректные фильтры'});}
        const upstream = mode === 'metrapi' ? await provider(profile.hard) : {items:listings,hasMore:false};
        const results = rankListings(upstream.items,profile);
        return json(res,200,{profile,results,meta:{...metadata(),hasMore:upstream.hasMore,candidates:upstream.items.length,fetchedAt:upstream.fetchedAt || null}});
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
server.listen(Number(process.env.PORT || 3100),host,()=>console.log(`Local: http://${host}:${process.env.PORT || 3100} (${mode === 'metrapi' ? 'Metrapi' : dataset})`));
