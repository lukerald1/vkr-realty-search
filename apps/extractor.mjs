import {applyOverrides, buildSearchProfile, parseQuery,clarificationQuestions} from './search.mjs';
import {ProviderError} from './metrapi.mjs';
import {distanceKeys,infrastructureKeys} from './infrastructure.mjs';
import {areas} from './locations.mjs';

export const schemaVersion = 'criteria-v1';
export const promptVersion = 'extractor-v8';
const numbers = ['deposit_max',...distanceKeys,'rooms','price_min','price_max','area_min','area_max','kitchen_min','kitchen_max','living_min','ceiling_min','floor_min','floor_max','floors_min','floors_max','year_min','year_max','metro_max'];
const strings = ['district','metro','renovation','house_type','bathroom','seller_type','build_status','source'];
const booleans = ['pets_required','kids_required','no_commission','floor_not_first','floor_not_last','has_photo','balcony_required'];
const hardProperties = Object.fromEntries([
  ...numbers.map(k=>[k,{type:'number',minimum:0}]),
  ...strings.map(k=>[k,{type:'string',minLength:1,maxLength:150}]),
  ...booleans.map(k=>[k,{type:'boolean'}]),
  ['city',{enum:['spb']}],['deal_type',{enum:['sale','rent']}],
  ['realty_type',{enum:['flat','house']}],['metro_mode_f',{enum:['walk','transport']}]
]);
for(const k of ['areas_any','areas_none'])hardProperties[k]={type:'array',maxItems:40,items:{enum:areas.map(a=>a.id)}};
hardProperties.metro_any={type:'array',maxItems:40,items:{type:'string',minLength:1,maxLength:150}};
for(const side of ['min','max']){
  hardProperties['price_'+side].description=`${side==='min'?'Нижняя':'Верхняя'} граница ЦЕНЫ в РУБЛЯХ. Миллионы и тысячи рублей преобразуй в рубли. Эти числа не являются площадью.`;
  hardProperties['area_'+side].description=`${side==='min'?'Нижняя':'Верхняя'} граница ОБЩЕЙ ПЛОЩАДИ в квадратных метрах. Только явно указанная граница площади. Цена и миллионы рублей не являются площадью и не задают её границ.`;
  hardProperties['kitchen_'+side].description=`${side==='min'?'Нижняя':'Верхняя'} граница площади КУХНИ в м², только явно заданное число для кухни.`;
}
hardProperties.rooms.description='Комнатность: студия=0; однушка/однокомнатная=1; двушка/двухкомнатная=2; трёшка/трёхкомнатная=3. Если не указана — null.';
for(const key of distanceKeys)hardProperties[key].description='Explicit radius in metres, null for nearby or walking time.';
const messagesSchema = {type:'array',maxItems:20,items:{type:'string',minLength:1,maxLength:300}};
export const criteriaSchema = {type:'object',additionalProperties:false,
  required:['hard','soft','unknown','outsideScope','questions'],properties:{
    hard:{type:'object',additionalProperties:false,properties:hardProperties},
    soft:{type:'array',maxItems:15,items:{enum:['metro','kitchen',...infrastructureKeys]}},
    unknown:messagesSchema, questions:messagesSchema, outsideScope:{type:'boolean'}
  }};

export const ollamaSchema=structuredClone(criteriaSchema);
for(const property of Object.values(ollamaSchema.properties.hard.properties)){
  if(property.enum)property.enum.push(null);else property.type=[property.type,'null'];
}
ollamaSchema.properties.hard.required=Object.keys(hardProperties);

export function validateCriteria(value, query) {
  const invalid=()=>{throw new ProviderError('Модель вернула некорректные условия. Измените описание или используйте фильтры.',502);};
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(criteriaSchema.properties,k)))invalid();
  if(criteriaSchema.required.some(k=>!Object.hasOwn(value,k))||typeof value.outsideScope!=='boolean')invalid();
  if(!value.hard||typeof value.hard!=='object'||Array.isArray(value.hard))invalid();
  for(const [key,v] of Object.entries(value.hard)) {
    const spec=hardProperties[key];
    if(!Object.hasOwn(hardProperties,key)||v===null)invalid();
    if(spec.enum&&!spec.enum.includes(v))invalid();
    if(spec.type==='number'&&(typeof v!=='number'||!Number.isFinite(v)||v<0))invalid();
    if(spec.type==='string'&&(typeof v!=='string'||!v.trim()||v.length>150))invalid();
    if(spec.type==='boolean'&&typeof v!=='boolean')invalid();
    if(spec.type==='array'&&(!Array.isArray(v)||v.length>40||v.some(x=>typeof x!=='string'||!x.trim()||x.length>150||(spec.items.enum&&!spec.items.enum.includes(x)))))invalid();
  }
  for(const key of ['unknown','questions'])if(!Array.isArray(value[key])||value[key].length>20||value[key].some(v=>typeof v!=='string'||!v.trim()||v.length>300))invalid();
  if(!Array.isArray(value.soft)||value.soft.length>15||value.soft.some(v=>!['metro','kitchen',...infrastructureKeys].includes(v)))invalid();
  const baseline=parseQuery(query);
  // Canonical geography comes from the deterministic resolver, not guessed model IDs.
  for(const k of ['areas_any','areas_none'])if(!baseline.hard[k])delete value.hard[k];
  if(baseline.hard.areas_any||baseline.hard.areas_none)delete value.hard.district;
  if(baseline.hard.metro_any)delete value.hard.metro;
  for(const k of ['areas_any','areas_none'])if(baseline.hard[k])value.hard[k]=baseline.hard[k];
  // A model must never invent a numerical radius for "nearby" or walking minutes.
  for(const key of distanceKeys)if(value.hard[key]!==undefined&&baseline.hard[key]===undefined)delete value.hard[key];
  const questions=[...value.questions];
  const conflicts=[];
  const explicitDeal=/аренд|снять|сниму|куп|продаж/i.test(query);
  if(explicitDeal&&value.hard.deal_type&&value.hard.deal_type!==baseline.hard.deal_type)conflicts.push({field:'deal_type',message:'Уточните тип сделки: разборы запроса расходятся.'});
  if(explicitDeal)value={...value,hard:{...value.hard,deal_type:baseline.hard.deal_type}};
  if(baseline.hard.realty_type==='house')value={...value,hard:{...value.hard,realty_type:'house'}};
  // Explicit constraints recognized by the baseline cannot disappear in the model response.
  for(const [key,v] of Object.entries(baseline.hard)) {
    if(['city','deal_type','realty_type'].includes(key))continue;
    if(Object.hasOwn(value.hard,key)&&JSON.stringify(value.hard[key])!==JSON.stringify(v))conflicts.push({field:key,message:`Уточните условие ${key}: разборы запроса расходятся.`});
    value={...value,hard:{...value.hard,[key]:v}};
  }
  let profile;
  try {profile=applyOverrides({...baseline,hard:{...baseline.hard,...value.hard}},value.hard);}catch{invalid();}
  questions.push(...clarificationQuestions(profile,query));
  questions.push(...conflicts.map(c=>c.message));
  // Travel mode alone is not a filter: it only qualifies a numeric travel-time limit.
  if(profile.hard.metro_max===undefined)delete profile.hard.metro_mode_f;
  const resolvedBaselineWarnings=new Set();
  if(profile.hard.district)resolvedBaselineWarnings.add('Район: пока не распознаётся');
  if(profile.hard.renovation)resolvedBaselineWarnings.add('Требования к ремонту');
  if(profile.hard.metro_max!==undefined)resolvedBaselineWarnings.add('Обязательная близость метро: укажите предел в минутах');
  const soft=[...new Set([...baseline.soft.filter(k=>infrastructureKeys.includes(k)),...value.soft])];
  return {...profile, outsideScope:baseline.outsideScope||value.outsideScope,
    notes:profile.notes.filter(note=>!(value.hard.deal_type==='rent'&&note.startsWith('Тип сделки по умолчанию'))),
    soft:soft.filter(k=>!soft.includes('ranked_school')||k!=='school'),unknown:[...new Set([...baseline.unknown.filter(w=>!resolvedBaselineWarnings.has(w)),...value.unknown])],
    modelQuestions:[...value.questions],conflicts,questions:[...new Set(questions)],needsClarification:questions.length>0,
    coverage:'Условия извлечены языковой моделью и проверены сервером. Проверьте распознанные параметры.'};
}

export function createOllama({model,baseUrl='http://127.0.0.1:11434',fetchImpl=fetch,thinking=model?.startsWith('qwen3:')??false,timeoutMs=thinking?90000:30000}={}) {
  const url=new URL(baseUrl);
  if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw new Error('Ollama должен использовать локальный HTTP-адрес');
  if(!model||typeof model!=='string'||model.length>150||/cloud/i.test(model))throw new Error('Укажите локальную модель OLLAMA_MODEL; облачные модели отключены');
  return async query=>{
    try {
      const response=await fetchImpl(new URL('/api/chat',url),{method:'POST',redirect:'error',
        headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(timeoutMs),
        body:JSON.stringify({model,stream:false,...(model.startsWith('qwen3:')?{think:thinking}:{}),format:ollamaSchema,options:{temperature:0,num_predict:thinking?4096:1200,num_ctx:4096},messages:[
          {role:'system',content:"Извлеки только условия пользователя в JSON. В hard все поля обязательны, но ВСЕ неупомянутые значения должны быть null, НЕ 0 и НЕ false. rooms=0 означает студию, rooms=null означает любое число комнат. Цена price — рубли, площадь area — м². Не переноси числа из цены в площадь. soft — упомянутые пожелания metro/kitchen и инфраструктура school, ranked_school (только RAEX), kindergarten, clinic, hospital, pharmacy, park, grocery, university, cafe, playground, fitness, shopping. Близость инфраструктуры проверяется по OSM, не относить её к unknown. *_max_m — только явное расстояние в метрах по прямой. Для рядом — soft без числового предела. Тишина и качество района по OSM не подтверждаются. unknown — упомянутые непроверяемые условия (тишина, свет, безопасность). questions — только конфликт или обязательное непроверяемое условие. Не спрашивай отсутствующие район/бюджет. Географию сервер нормализует сам: areas_any/areas_none оставляй null. Московский район — СПб, не Москва. Исключение «не Мурино» не означает другой город. Залог и комиссия не являются бюджетом покупки. СПб — по умолчанию, другие города и Ленобласть (Мурино/Кудрово) outsideScope=true. Обязательные минусы этажей сохраняй. Ничего не выдумывай. Схема: "+JSON.stringify(ollamaSchema)+" Тип сделки по умолчанию sale, никогда не угадывай аренду. Большая или просторная кухня — soft kitchen. Близость метро без конкретной станции или времени — soft metro. До N рублей — только price_max, не price_min. От N м² — только area_min, не area_max."},
          {role:'user',content:query}
        ]})});
      if(!response.ok)throw new ProviderError(response.status===404?'Локальная модель не найдена. Проверьте OLLAMA_MODEL.':'Локальная модель недоступна. Используйте фильтры или повторите позже.',503);
      const body=await response.json();
      if(!body.done||body.done_reason==='length'||typeof body.message?.content!=='string'||body.message.content.length>24000)throw new Error('Invalid model response');
      const criteria=JSON.parse(body.message.content);
      if(criteria?.hard&&typeof criteria.hard==='object'&&!Array.isArray(criteria.hard))criteria.hard=Object.fromEntries(Object.entries(criteria.hard).filter(([key,value])=>value!==null||!Object.hasOwn(hardProperties,key)));
      return {criteria,settings:{thinking,contextTokens:4096},usage:{inputTokens:body.prompt_eval_count??null,outputTokens:body.eval_count??null}};
    }catch(error){
      if(error instanceof ProviderError)throw error;
      throw new ProviderError(error.name==='TimeoutError'||error.name==='AbortError'?'Модель не ответила вовремя. Используйте фильтры или повторите позже.':'Не удалось разобрать ответ локальной модели. Используйте фильтры или измените описание.',502);
    }
  };
}

export function createExtractor({mode='rules',model=null,extract,now=Date.now,ttlMs=900000,maxEntries=200}={}) {
  if(!['rules','ollama'].includes(mode))throw new Error('EXTRACTOR_MODE: rules или ollama');
  if(mode!=='rules'&&typeof extract!=='function')throw new Error('Не настроен адаптер извлечения');
  const cache=new Map(),pending=new Map();
  return async ({query,filters={},searchMode='text',session})=>{
    if(typeof query!=='string'||query.length>2000||!['text','filters'].includes(searchMode))throw new ProviderError('Некорректный запрос или способ поиска',400);
    // Validate manual input before contacting any model.
    try {applyOverrides(parseQuery(''),filters);}catch{throw new ProviderError('Некорректные фильтры',400);}
    if(mode==='rules'||searchMode==='filters'||!query.trim()) {
      try {return {...buildSearchProfile(query,filters,searchMode),extractor:'rules',schemaVersion};}
      catch {throw new ProviderError('Фильтры противоречат распознанным условиям',400);}
    }
    if(typeof session!=='string'||!session)throw new Error('Для LLM требуется серверная сессия');
    const key=JSON.stringify([session,query]);
    let value=cache.get(key);
    if(value&&now()>=value.expires){cache.delete(key);value=null;}
    let cached=Boolean(value);
    if(!value){
      let job=pending.get(key);
      if(!job){
        if(pending.size>=1)throw new ProviderError('Модель занята другим запросом. Повторите позже.',429);
        job=(async()=>{
          const start=now();
          const result=await extract(query);
          const profile=validateCriteria(result.criteria,query);
          const entry={profile,usage:result.usage??null,settings:result.settings??null,elapsedMs:now()-start,expires:now()+ttlMs};
          if(cache.size>=maxEntries)cache.delete(cache.keys().next().value);
          cache.set(key,entry);return entry;
        })();
        pending.set(key,job);
      }else cached=true;
      try {value=await job;}finally{pending.delete(key);}
    }
    let profile;
    try {profile=applyOverrides(structuredClone(value.profile),filters);}catch{throw new ProviderError('Фильтры противоречат распознанным диапазонам',400);}
    profile.questions=[...new Set([...profile.modelQuestions,...profile.conflicts.filter(c=>!Object.hasOwn(filters,c.field)).map(c=>c.message),...clarificationQuestions(profile,query)])];
    profile.needsClarification=profile.questions.length>0;
    return {...profile,searchMode,extractor:mode,model,schemaVersion,promptVersion,extraction:{cached,elapsedMs:value.elapsedMs,settings:value.settings,usage:value.usage}};
  };
}
