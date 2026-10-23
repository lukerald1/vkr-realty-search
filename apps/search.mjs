const numeric = value => value === null || value === '' || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : null;
export function normalize(item) {
  const source = String(item.source || 'unknown');
  const id = item.id || (item.group_id ? `group:${item.group_id}` : `${source}:${item.source_id || item.url || item.address}`);
  return { id, source, city: item.city, region: item.region || null, locality: item.locality, deal_type: item.deal_type,
    realty_type: item.realty_type, rooms: numeric(item.rooms), price: numeric(item.price),
    area_total: numeric(item.area_total), area_kitchen: numeric(item.area_kitchen),
    floor: numeric(item.floor), floors_total: numeric(item.floors_total),
    area_living:numeric(item.area_living),build_year:numeric(item.build_year),ceiling_height:numeric(item.ceiling_height),
    house_type:item.house_type||null,bathroom:item.bathroom||null,seller_type:item.seller_type||null,build_status:item.build_status||null,
    metro: item.metro || null, metro_minutes: numeric(item.metro_minutes),
    metro_mode: ['walk','пешком'].includes(item.metro_mode) ? 'walk' : ['transport','транспортом'].includes(item.metro_mode) ? 'transport' : null,
    address: item.address || 'Адрес не указан', district: item.district || null,
    balcony: item.balcony || null, renovation: item.renovation || null,
    description: String(item.description || '').slice(0, 6000),
    photos: (Array.isArray(item.photos) ? item.photos : []).filter(v => typeof v === 'string' && /^https:\/\//i.test(v)).slice(0, 8),
    url: typeof item.url === 'string' && /^https:\/\//i.test(item.url) ? item.url : null,
    published_at: item.published_at || null };
}

export function parseQuery(query) {
  const text = query.toLowerCase().replace(/ё/g, 'е');
  const hard = {city: 'spb', deal_type: 'sale', realty_type: 'flat'};
  const soft = [], unknown = [], notes = [];
  // Rules baseline. A language-model extractor will implement the same contract later.
  const roomWords = [['студи',0],['однокомнат',1],['однуш',1],['двухкомнат',2],['двуш',2],['трехкомнат',3],['треш',3],['четырехкомнат',4]];
  const roomMatches = [...new Set(roomWords.filter(([word]) => text.includes(word)).map(([,n]) => n))];
  for (const match of text.matchAll(/\b([0-5])\s*[-–]?\s*(?:комн|комнат|к\b)/g)) roomMatches.push(Number(match[1]));
  const rooms = [...new Set(roomMatches)];
  if (rooms.length === 1) hard.rooms = rooms[0];
  if (rooms.length > 1) unknown.push('Несколько вариантов комнатности: выберите число в фильтрах');
  const price = text.match(/(?:до|не дороже|бюджет(?:ом)?(?: до)?)\s*(\d+(?:[.,]\d+)?)\s*(миллион[а-я]*|млн|тыс[а-я]*|млрд|₽|руб[а-я]*)/);
  if (price) hard.price_max = Number(price[1].replace(',','.')) * (/млрд/.test(price[2]) ? 1e9 : /млн|миллион/.test(price[2]) ? 1e6 : /тыс/.test(price[2]) ? 1e3 : 1);
  const minPrice = text.match(/от\s*(\d+(?:[.,]\d+)?)\s*(млн|миллион[а-я]*|тыс[а-я]*|₽|руб[а-я]*)/);
  if (minPrice) hard.price_min = Number(minPrice[1].replace(',','.')) * (/млн|миллион/.test(minPrice[2]) ? 1e6 : /тыс/.test(minPrice[2]) ? 1e3 : 1);
  const area = text.match(/(?:площад[а-я]*\s*)?(?:от|не менее)\s*(\d+(?:[.,]\d+)?)\s*(?:м²|м2|кв\.?\s*м|квадрат)/);
  if (area) hard.area_min = Number(area[1].replace(',','.'));
  const metro = text.match(/(?:до|не более|максимум)\s*(\d+)\s*мин[а-я]*(?:\s+пешком)?\s*(?:до|от)\s*метро/)
    || text.match(/метро\s*(?:до|не более)\s*(\d+)\s*мин/);
  if (metro) { hard.metro_max = Number(metro[1]); hard.metro_mode_f = /транспорт/.test(metro[0]) ? 'transport' : 'walk'; }
  else if (/метро/.test(text)) soft.push('metro');
  if (/больш[а-я]*\s+кухн|просторн[а-я]*\s+кухн/.test(text)) soft.push('kitchen');
  if (/с балконом|с лоджией/.test(text)) hard.balcony_required = true;
  if (/без балкона/.test(text)) hard.balcony_required = false;
  if (/не перв[а-я]* этаж|не на первом|без первого/.test(text)) hard.floor_not_first = true;
  if (/не последн[а-я]* этаж|не на последнем|без последнего/.test(text)) hard.floor_not_last = true;
  if (/аренд|снять|сниму/.test(text)) hard.deal_type = 'rent';
  if (/(?:^|\s)(?:дом|коттедж)(?:\s|$|[.,!?])/.test(text)) hard.realty_type = 'house';
  const outsideScope = /москв|мурино|кудров|ленинградск[а-я]* област|в казани|в сочи|в новосибирске/.test(text);
  if (outsideScope) unknown.push('Проект ограничен Санкт-Петербургом: указана другая география');
  const unsupported = [
    [/тих|нешум|без шума/, 'Тишина и уровень шума'], [/светл|солнеч/, 'Освещённость квартиры'],
    [/парк|зелень|зеленый/, 'Близость парков'], [/школ|детск[а-я]* сад/, 'Школы и детские сады'],
    [/собак|кошк|животн/, 'Проживание с животными'], [/ремонт/, 'Требования к ремонту'],
    [/район/, 'Район: пока не распознаётся'], [/обязательн[а-я]*.*метро|метро.*обязательн/, 'Обязательная близость метро: укажите предел в минутах']
  ];
  for (const [pattern, label] of unsupported) if (pattern.test(text)) unknown.push(label);
  if (!/петербург|питер|спб|москв/.test(text)) notes.push('Город по умолчанию — Санкт-Петербург');
  if (!/куп|продаж|аренд|снять|сниму/.test(text)) notes.push('Тип сделки по умолчанию — покупка');
  return {hard, outsideScope, soft: [...new Set(soft)], unknown: [...new Set(unknown)], notes,
    coverage: 'Прототип распознаёт основные шаблоны. Проверьте условия: остальные слова могут не учитываться.'};
}

export function buildSearchProfile(query, filters = {}, mode = 'text') {
  if (!['text','filters'].includes(mode)) throw new Error('Некорректный способ поиска');
  const profile=applyOverrides(parseQuery(mode==='filters'?'':query),filters);
  return {...profile,searchMode:mode,...(mode==='filters'?{notes:[],coverage:'Поиск по выбранным фильтрам; языковая модель не используется.'}:{})};
}

export function applyOverrides(profile, overrides = {}) {
  const hard = {...profile.hard};
  if(!overrides||typeof overrides!=='object'||Array.isArray(overrides))throw new Error('Некорректные фильтры');
  for (const key of ['rooms','price_min','price_max','area_min','area_max','kitchen_min','kitchen_max','living_min','ceiling_min','floor_min','floor_max','floors_min','floors_max','year_min','year_max','metro_max']) {
    if (!(key in overrides)) continue;
    if (overrides[key] === null || overrides[key] === '') delete hard[key];
    else {
      const value = Number(overrides[key]);
      if (typeof overrides[key]==='boolean'||!Number.isFinite(value) || value < 0 || (key === 'rooms' && (!Number.isInteger(value) || value > 5))||(/^(floor|floors|year)_/.test(key)&&!Number.isInteger(value))) throw new Error('Некорректный фильтр');
      hard[key] = value;
    }
  }
  if ('city' in overrides) {
    if (overrides.city !== 'spb') throw new Error('Доступен только Санкт-Петербург');
  }
  if ('deal_type' in overrides) {
    if (!['sale','rent'].includes(overrides.deal_type)) throw new Error('Некорректный тип сделки');
    hard.deal_type = overrides.deal_type;
  }
  for(const key of ['district','metro','renovation','house_type','bathroom','seller_type','build_status','source'])if(key in overrides){
    if(overrides[key]===null||overrides[key]==='')delete hard[key];
    else {if(typeof overrides[key]!=='string'||overrides[key].length>150)throw new Error('Некорректный фильтр');hard[key]=overrides[key];}
  }
  for(const key of ['floor_not_first','floor_not_last','has_photo','balcony_required'])if(key in overrides){
    if(overrides[key]===null||overrides[key]==='')delete hard[key];
    else {if(typeof overrides[key]!=='boolean')throw new Error('Некорректный фильтр');if(key!=='balcony_required'&&!overrides[key])delete hard[key];else hard[key]=overrides[key];}
  }
  if('metro_mode_f' in overrides){if(!['walk','transport'].includes(overrides.metro_mode_f))throw new Error('Некорректный способ передвижения');hard.metro_mode_f=overrides.metro_mode_f;}
  if ('metro_max' in hard&&!hard.metro_mode_f) hard.metro_mode_f = 'walk';
  for(const prefix of ['price','area','kitchen','floor','floors','year'])if(hard[prefix+'_min']!==undefined&&hard[prefix+'_max']!==undefined&&hard[prefix+'_min']>hard[prefix+'_max'])throw new Error('Минимум больше максимума');
  return {...profile, hard};
}

export function rankListings(raw, profile) {
  if (profile.outsideScope) return [];
  const {hard, soft} = profile;
  const seen = new Set();
  return raw.map(normalize).filter(item => {
    if (seen.has(item.id)) return false;
    // Missing fields never satisfy a mandatory condition.
    if (item.city !== hard.city || item.deal_type !== hard.deal_type || item.realty_type !== hard.realty_type) return false;
    if (hard.rooms !== undefined && item.rooms !== hard.rooms) return false;
    if (hard.price_max !== undefined && (item.price === null || item.price > hard.price_max)) return false;
    if (hard.price_min !== undefined && (item.price === null || item.price < hard.price_min)) return false;
    if (hard.area_min !== undefined && (item.area_total === null || item.area_total < hard.area_min)) return false;
    for(const [key,field,dir]of [['area_max','area_total','max'],['kitchen_min','area_kitchen','min'],['kitchen_max','area_kitchen','max'],['living_min','area_living','min'],['ceiling_min','ceiling_height','min'],['floor_min','floor','min'],['floor_max','floor','max'],['floors_min','floors_total','min'],['floors_max','floors_total','max'],['year_min','build_year','min'],['year_max','build_year','max']])
      if(hard[key]!==undefined&&(item[field]===null||(dir==='min'?item[field]<hard[key]:item[field]>hard[key])))return false;
    for(const key of ['district','metro','renovation','house_type','bathroom','seller_type','build_status','source'])if(hard[key]!==undefined&&item[key]!==hard[key])return false;
    if(hard.has_photo&&!item.photos.length)return false;
    if (hard.metro_max !== undefined && (item.metro_minutes === null || item.metro_minutes > hard.metro_max || item.metro_mode !== hard.metro_mode_f)) return false;
    if (hard.floor_not_first && (item.floor === null || item.floor <= 1)) return false;
    if (hard.floor_not_last && (item.floor === null || item.floors_total === null || item.floor >= item.floors_total)) return false;
    if (hard.balcony_required !== undefined) {
      if (!item.balcony) return false;
      const present = !/^нет$/i.test(item.balcony);
      if (present !== hard.balcony_required) return false;
    }
    seen.add(item.id); return true;
  }).map(item => {
    let score = 0;
    const reasons = [];
    if (hard.price_max !== undefined) reasons.push('В пределах бюджета');
    if (item.metro_minutes !== null && item.metro_mode === 'walk') {
      reasons.push(`${item.metro_minutes} мин пешком до метро`);
      if (soft.includes('metro')) score += Math.max(0, 30 - item.metro_minutes) / 30;
    }
    if (soft.includes('kitchen') && item.area_kitchen !== null) {
      score += Math.min(item.area_kitchen / 20, 1); reasons.push(`Кухня ${item.area_kitchen} м²`);
    }
    if (hard.balcony_required === true) reasons.push(item.balcony);
    return {...item, score, reasons};
  }).sort((a,b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function metrapiParams(hard) {
  const params = new URLSearchParams({limit:'50', dedupe:'true',region:'Санкт-Петербург'});
  for (const key of ['city','deal_type','realty_type','rooms','price_min','price_max','area_min','metro_max','metro_mode_f'])
    if (hard[key] !== undefined) params.set(key, String(hard[key]));
  for (const key of ['floor_not_first','floor_not_last']) if (hard[key]) params.set(key,'1');
  // Balcony is validated locally because API values vary between sources.
  return params;
}
