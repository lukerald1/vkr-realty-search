const $ = selector => document.querySelector(selector);
const money = value => value === null ? 'Цена не указана' : `${new Intl.NumberFormat('ru-RU').format(value)} ₽`;
const num = value => value === null ? '—' : new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let favorites;
try { favorites = new Set(JSON.parse(localStorage.getItem('prostor:favorites') || '[]')); } catch { favorites = new Set(); }
let current = [], homeItems = [], profile = null, meta = null, selectedRoom = '', requestId = 0, toastTimer, activeDeal='sale', currentSearchId=null, activeSearchMode='text';
function setSearchMode(mode) {
  activeSearchMode=mode;
  document.querySelectorAll('[data-search-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.searchMode===mode)));
  $('#home-form').classList.toggle('hidden',mode==='filters');
  $('#home-filter-form').classList.toggle('hidden',mode!=='filters');
  $('.examples').classList.toggle('hidden',mode==='filters');
}
const sourceNames = {cian:'ЦИАН',domclick:'Домклик',yandex:'Яндекс Недвижимость',avito:'Авито',move:'Move.ru',demo:'Учебный пример'};
const roomsName = item => item.rooms === 0 ? 'Студия' : item.rooms === null ? 'Квартира' : `${item.rooms}-комн. квартира`;
const modeLabel = data => data.mode === 'demo' ? 'Учебные примеры · вымышленные объекты' : data.mode === 'metrapi' ? 'Данные Metrapi' : data.mode === 'database' ? 'Локальная база Петербурга' : 'Локальная выборка Metrapi';
const priceMarkup = item => money(item.price)+(item.deal_type==='rent'?'<span class="rent-unit"> / мес.</span>':'');
const extractorLabel = data => data?.extractor==='ollama'?'локальная языковая модель':'разбор по правилам';
const infrastructureLabels={ranked_school:'школа из RAEX (проверенная часть списка)',school:'школа',kindergarten:'детский сад',clinic:'поликлиника',hospital:'больница',pharmacy:'аптека',park:'парк',grocery:'продуктовый магазин',university:'вуз',cafe:'кафе',playground:'детская площадка',fitness:'фитнес',shopping:'торговый центр'};
const advancedGroups=[
  ['Территории: выберите любые подходящие',[['areas_any','Искать в территориях','areas'],['areas_none','Исключить территории','areas'],['metro_any','Любая из станций метро','metros']]],
  ['Условия аренды — по данным объявления',[['pets_required','Разрешены животные','check'],['kids_required','Разрешены дети','check'],['no_commission','Без комиссии','check'],['deposit_max','Залог не более, ₽','number']]],
  ['Инфраструктура · метры по прямой (до 3000)',Object.entries(infrastructureLabels).map(([k,label])=>[k+'_max_m',label+': не далее, м','number'])],
  ['Основное',[['deal_type','Тип сделки','deal'],['rooms','Комнат','rooms'],['price_min','Цена от, ₽','number'],['price_max','Цена до, ₽','number'],['source','Площадка','facet'],['has_photo','Только с фотографиями','check']]],
  ['Расположение',[['district','Район / муниципалитет по данным источника','facet'],['metro','Станция метро','facet'],['metro_max','До метро, минут','number'],['metro_mode_f','Способ передвижения','travel']]],
  ['Квартира',[['area_min','Общая площадь от, м²','number'],['area_max','Общая площадь до, м²','number'],['kitchen_min','Кухня от, м²','number'],['kitchen_max','Кухня до, м²','number'],['living_min','Жилая площадь от, м²','number'],['ceiling_min','Потолки от, м','number'],['floor_min','Этаж от','number'],['floor_max','Этаж до','number'],['floor_not_first','Не первый этаж','check'],['floor_not_last','Не последний этаж','check'],['renovation','Ремонт','facet'],['balcony_required','Балкон / лоджия','balcony'],['bathroom','Санузел','facet']]],
  ['Дом и объявление',[['year_min','Год постройки от','number'],['year_max','Год постройки до','number'],['floors_min','Этажей в доме от','number'],['floors_max','Этажей в доме до','number'],['house_type','Тип дома','facet'],['build_status','Состояние строительства','facet'],['seller_type','Тип продавца','facet']]]
];
let geoOptions=[];
let facetPromise;
let historyItems=[];
async function showHistory(){
  const dialog=$('#history-dialog');$('#history-items').textContent='Загружаем историю…';dialog.showModal();
  try{
    const response=await fetch('/api/history');if(!response.ok)throw new Error('Не удалось загрузить историю. Повторите позже.');
    const data=await response.json(),seen=new Set();
    historyItems=data.searches.filter(item=>{const key=JSON.stringify([item.query,item.filters,item.searchMode]);if(seen.has(key))return false;seen.add(key);return true;});
    $('#history-items').innerHTML=historyItems.length?historyItems.map((item,i)=>`<button type="button" class="history-item" data-history="${i}"><strong>${esc(item.query||'Поиск по фильтрам')}</strong><span>${item.searchMode==='filters'?'Фильтры':'Описание'} · ${esc(new Date(item.created_at).toLocaleString('ru-RU'))} · ${num(item.total)} вариантов на момент поиска</span><span>Повторить поиск ↗</span></button>`).join(''):'<p>История пока пуста. Выполните первый поиск.</p>';
  }catch(error){$('#history-items').textContent=error.message;}
}
$('#history-nav').addEventListener('click',showHistory);
$('#close-history').addEventListener('click',()=>$('#history-dialog').close());
$('#history-items').addEventListener('click',event=>{
  const button=event.target.closest('[data-history]');if(!button)return;const item=historyItems[Number(button.dataset.history)];
  if(item){$('#history-dialog').close();navigate(item.query,item.filters,false,item.searchMode);}
});
function quickCriteria(){return {deal_type:activeDeal,rooms:$('#home-rooms').value,price_max:$('#home-price').value,metro_max:$('#home-metro').value};}
async function openAdvanced(){
  const dialog=$('#all-filters-dialog');$('#advanced-error').classList.add('hidden');
  $('#advanced-fields').textContent='Загружаем параметры каталога…';$('#apply-all-filters').disabled=true;dialog.showModal();
  try{
    facetPromise??=fetch('/api/filters').then(async r=>{if(!r.ok)throw Error('Не удалось загрузить фильтры');return (await r.json()).facets;}).catch(e=>{facetPromise=null;throw e;});
    const facets=await facetPromise;geoOptions=facets.area_options||[];
    const hard=location.pathname==='/search'?{...profile?.hard,deal_type:$('#filter-deal').value,rooms:selectedRoom,price_max:$('#filter-price').value,area_min:$('#filter-area').value,metro_max:$('#filter-metro').value}:quickCriteria();
    const fixed={deal:[['sale','Покупка'],['rent','Аренда']],rooms:[['','Любые'],['0','Студия'],...['1','2','3','4','5'].map(n=>[n,n])],travel:[['walk','Пешком'],['transport','На транспорте']],balcony:[['','Не важно'],['true','Есть балкон / лоджия'],['false','Нет балкона / лоджии']]};
    $('#advanced-fields').innerHTML=advancedGroups.filter(([title])=>!title.startsWith('Условия аренды')||hard.deal_type==='rent').map(([title,fields],i)=>`<details class="advanced-group" ${i<2?'open':''}><summary>${title}<span>+</span></summary><div class="advanced-grid">${fields.map(([key,label,type])=>{
      const value=hard[key]??'',id=`advanced-${key}`;
      if(type==='areas'||type==='metros'){
        const options=type==='areas'?geoOptions.map(a=>[a.id,a.label]):(facets.metro||[]).map(m=>[m,m]);
        return `<fieldset class="geo-choice"><legend>${esc(label)}</legend><div class="geo-choice-scroll">${options.map(([v,text])=>`<label><input type="checkbox" data-list-key="${key}" value="${esc(v)}" ${Array.isArray(value)&&value.includes(v)?'checked':''}>${esc(text)}</label>`).join('')}</div></fieldset>`;
      }
      if(type==='check')return `<label class="advanced-check"><input id="${id}" data-filter-key="${key}" type="checkbox" ${value===true?'checked':''}>${label}</label>`;
      if(type==='number')return `<label>${label}<input id="${id}" data-filter-key="${key}" type="number" min="0" step="${['area','kitchen','living','ceiling'].some(p=>key.startsWith(p))?'0.1':'1'}" placeholder="Не ограничено" value="${esc(value)}"></label>`;
      const opts=type==='facet'?[['','Не важно'],...(facets[key]||[]).map(v=>[v,key==='source'?(sourceNames[v]||v):v])]:fixed[type];
      return `<label>${label}<select id="${id}" data-filter-key="${key}">${opts.map(([v,text])=>`<option value="${esc(v)}" ${String(value)===v?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
    }).join('')}</div></details>`).join('');
    $('#apply-all-filters').disabled=false;
  }catch(error){$('#advanced-error').textContent=error.message;$('#advanced-error').classList.remove('hidden');}
}
document.querySelectorAll('[data-open-filters]').forEach(b=>b.addEventListener('click',openAdvanced));
$('#close-all-filters').addEventListener('click',()=>$('#all-filters-dialog').close());
$('#clear-all-filters').addEventListener('click',()=>{document.querySelectorAll('[data-list-key]').forEach(el=>el.checked=false);document.querySelectorAll('[data-filter-key]').forEach(el=>{if(el.type==='checkbox')el.checked=false;else el.value=el.dataset.filterKey==='deal_type'?activeDeal:el.dataset.filterKey==='metro_mode_f'?'walk':'';});});
$('#advanced-filter-form').addEventListener('submit',event=>{
  event.preventDefault();const filters={areas_any:[],areas_none:[],metro_any:[]};document.querySelectorAll('[data-list-key]:checked').forEach(el=>filters[el.dataset.listKey].push(el.value));document.querySelectorAll('[data-filter-key]').forEach(el=>{const key=el.dataset.filterKey;filters[key]=el.type==='checkbox'?el.checked:key==='balcony_required'?(el.value===''?null:el.value==='true'):el.value;});
  for(const prefix of ['price','area','kitchen','floor','floors','year'])if(filters[prefix+'_min']!==''&&filters[prefix+'_max']!==''&&filters[prefix+'_min']!==undefined&&filters[prefix+'_max']!==undefined&&Number(filters[prefix+'_min'])>Number(filters[prefix+'_max'])){$('#advanced-error').textContent='Значение «от» не может быть больше значения «до».';$('#advanced-error').classList.remove('hidden');return;}
  const onResults=location.pathname==='/search';if(!onResults||activeSearchMode==='filters')for(const [key,value]of Object.entries(filters))if(value===''||value===null||(value===false&&key!=='balcony_required'))delete filters[key];$('#all-filters-dialog').close();navigate(onResults&&activeSearchMode==='text'?$('#result-query').value.trim():'',filters,false,onResults?activeSearchMode:'filters');
});
function track(type,listingId) {
  if(!currentSearchId)return;
  fetch('/api/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,listingId,searchId:currentSearchId}),keepalive:true}).catch(()=>{});
}
function toast(text) { $('#toast').textContent = text; $('#toast').classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(()=>$('#toast').classList.add('hidden'),2400); }
function updateSaved() {
  $('#saved-count').textContent = favorites.size;
  document.querySelectorAll('[data-save]').forEach(button => {
    const saved = favorites.has(button.dataset.save);
    button.setAttribute('aria-pressed',String(saved)); button.textContent = saved ? '♥' : '♡';
    button.setAttribute('aria-label', saved ? 'Убрать из избранного' : 'Добавить в избранное');
  });
}
function infrastructureMarkup(item){
  return (item.infrastructureBadges||[]).map(b=>`<div class="infra-fact"><a href="${esc(b.sourceUrl)}" target="_blank" rel="noopener noreferrer" title="${esc(b.detail)}">${esc(b.text)} ↗</a><small>${esc(b.measurement)}</small>${b.ratingText?`<a class="school-rating" href="${esc(b.ratingUrl)}" target="_blank" rel="noopener noreferrer" title="${esc(b.ratingDetail)}">${esc(b.ratingText)} ↗</a><small>Конкурентоспособность выпускников</small>`:''}</div>`).join('');
}
function card(item) {
  const id = esc(item.id), saved = favorites.has(item.id);
  const metro = item.metro ? `<div class="metro-line"><span class="metro-mark">м</span> ${esc(item.metro)}${item.metro_minutes !== null ? `<span class="distance">· ${num(item.metro_minutes)} мин ${item.metro_mode === 'walk' ? 'пешком' : item.metro_mode === 'transport' ? 'транспортом' : '(способ не указан)'}</span>` : ''}</div>` : '<div class="metro-line distance">Метро не указано</div>';
  return `<article class="card"><div class="card-media"><img class="card-image" src="${esc(item.photos[0] || '/building.svg')}" alt="${esc(item.photos.length ? roomsName(item) : 'Иллюстрация дома — фото отсутствует')}" loading="lazy" data-detail="${id}" referrerpolicy="no-referrer"><span class="source-badge">${esc(sourceNames[item.source] || item.source)}</span><button class="save-button" data-save="${id}" aria-label="${saved?'Убрать из избранного':'Добавить в избранное'}" aria-pressed="${saved}">${saved?'♥':'♡'}</button>${item.photos.length ? `<span class="photo-count">▧ ${item.photos.length}</span>`:''}</div><div class="infra-badges">${infrastructureMarkup(item)}</div><div class="card-body"><div class="card-price">${priceMarkup(item)}</div><div class="sqm-price">${item.price !== null && item.area_total > 0 ? `${money(Math.round(item.price/item.area_total))} за м²${item.deal_type==='rent'?' в месяц':''}` : 'Цена и характеристики по данным источника'}</div><button class="card-title" data-detail="${id}">${roomsName(item)}, ${num(item.area_total)} м²</button><div class="card-address">${esc(item.address)}</div>${metro}<div class="card-reasons">${(item.reasons.length ? item.reasons : ['Соответствует выбранным фильтрам']).map(reason=>`<span class="reason">${esc(reason)}</span>`).join('')}</div><button class="card-detail-link" data-detail="${id}">Подробнее о квартире <span aria-hidden="true">↗</span></button></div></article>`;
}
function imageFallback(container) {
  container.querySelectorAll('img').forEach(img => img.addEventListener('error',()=>{img.src='/building.svg';img.alt='Иллюстрация дома — фото недоступно';},{once:true}));
}
function setRoom(value) {
  selectedRoom = String(value ?? '');
  document.querySelectorAll('[data-room]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.room === selectedRoom)));
}
function fillFilters(hard) {
  $('#filter-deal').value = hard.deal_type; activeDeal=hard.deal_type; setRoom(hard.rooms);
  $('#budget-label').firstChild.nodeValue=hard.deal_type==='rent'?'Бюджет, до ₽ / месяц':'Бюджет, до ₽';
  $('#filter-metro').parentElement.firstChild.nodeValue=hard.metro_mode_f==='transport'?'До метро на транспорте, мин':'До метро пешком, мин';
  $('#filter-price').value = hard.price_max ?? ''; $('#filter-area').value = hard.area_min ?? ''; $('#filter-metro').value = hard.metro_max ?? '';
}
function conditions(data) {
  const hard = data.hard;
  const conditions = ['Санкт-Петербург',hard.deal_type === 'sale' ? 'Покупка' : 'Аренда',hard.realty_type === 'flat' ? 'Квартира' : 'Дом'];
  if(hard.rooms !== undefined) conditions.push(hard.rooms === 0 ? 'Студия' : `${hard.rooms} комн.`);
  if(hard.price_max !== undefined) conditions.push(`До ${money(hard.price_max)}`);
  if(hard.price_min !== undefined) conditions.push(`От ${money(hard.price_min)}`);
  if(hard.area_min !== undefined) conditions.push(`От ${hard.area_min} м²`);
  if(hard.metro_max !== undefined) conditions.push(`Метро ≤ ${hard.metro_max} мин ${hard.metro_mode_f==='transport'?'на транспорте':'пешком'}`);
  for(const [key,label,type] of advancedGroups.flatMap(g=>g[1]))if(!['deal_type','rooms','price_max','price_min','area_min','metro_max','metro_mode_f','balcony_required','floor_not_first','floor_not_last','areas_any','areas_none','metro_any'].includes(key)&&hard[key]!==undefined)conditions.push(type==='check'?label:`${label}: ${key==='source'?(sourceNames[hard[key]]||hard[key]):hard[key]}`);
  if(hard.balcony_required !== undefined) conditions.push(hard.balcony_required ? 'С балконом / лоджией' : 'Без балкона');
  if(hard.floor_not_first) conditions.push('Не первый этаж');
  if(hard.floor_not_last) conditions.push('Не последний этаж');
  const labels=data.areaOptions||geoOptions;
  for(const [key,prefix] of [['areas_any','Территория'],['areas_none','Исключено']])if(hard[key]?.length)conditions.push(prefix+': '+hard[key].map(id=>labels.find(a=>a.id===id)?.label||id).join(' или '));
  if(hard.metro_any?.length)conditions.push('Метро: '+hard.metro_any.join(' или '));
  if(data.geoPreferred?.length)conditions.push('Предпочтительно: '+data.geoPreferred.map(id=>labels.find(a=>a.id===id)?.label||id).join(' или '));
  return conditions.map(text=>`<span class="condition">${esc(text)}</span>`).join('')
    + data.soft.map(key=>`<span class="condition soft">Желательно: ${esc(key==='metro'?'ближе к метро':key==='kitchen'?'большая кухня':infrastructureLabels[key]+' рядом')}</span>`).join('')
    + (data.soft.some(k=>infrastructureLabels[k])?'<span class="condition soft">Приоритет: '+esc(infrastructureLabels[data.soft.find(k=>infrastructureLabels[k])])+' · расстояние по прямой</span>':'')
    + (data.notes||[]).filter(n=>/схема проекта|Распознано:|исключения/.test(n)).map(n=>'<span class="condition geo-note">'+esc(n)+'</span>').join('')
    + data.unknown.map(text=>`<span class="condition warn">Не проверено: ${esc(text)}</span>`).join('');
}
function renderResults() {
  const savedOnly = new URLSearchParams(location.search).get('saved') === '1';
  const items=[...current], count=meta.totalMatched??items.length;
  $('#results-title').textContent = savedOnly ? `Избранное · ${num(count)}` : `${num(count)} ${count%10===1&&count%100!==11?'вариант':count%10>=2&&count%10<=4&&(count%100<12||count%100>14)?'варианта':'вариантов'} для вас`;
  $('#results-kicker').textContent = savedOnly ? 'ТО, ЧТО ПОНРАВИЛОСЬ' : 'ВАША ПОДБОРКА';
  $('#results-subtitle').textContent = savedOnly ? 'Сохранённые объекты покупки и аренды из доступного каталога.' : profile.soft.length ? 'Сначала — объекты, которые ближе к вашим пожеланиям.' : 'Подборка по обязательным условиям. Добавьте пожелания в описание.';
  $('#result-cards').innerHTML = items.map(card).join(''); imageFallback($('#result-cards'));
  $('#empty').classList.toggle('hidden',items.length>0);
  $('#empty h2').textContent = savedOnly ? 'Здесь будут ваши любимые варианты' : 'Пока нет точного совпадения';
  $('#empty p').textContent = savedOnly ? 'Нажмите на сердечко у понравившейся квартиры.' : 'Попробуйте изменить бюджет или комнатность. Мы сохранили ваши обязательные условия. В локальной выборке может просто не быть нужных объектов.';
  if(profile.outsideScope){$('#empty h2').textContent='Сейчас ищем только в Петербурге';$('#empty p').textContent='Ленинградская область и другие города не входят в исследование. Укажите квартиру в Санкт-Петербурге.';}
  if(profile.needsClarification){$('#empty h2').textContent='Уточните условия поиска';$('#empty p').textContent=profile.questions.join(' ')+' Измените описание и повторите поиск или задайте проверяемые условия через фильтры.';}
  $('#pagination').classList.toggle('hidden',count<=(meta.limit||24));
  $('#prev-page').disabled=!meta.offset;$('#next-page').disabled=!meta.hasMore;
  $('#page-label').textContent=count?`${num((meta.offset||0)+1)}–${num((meta.offset||0)+items.length)} из ${num(count)}`:'';
}
async function requestSearch(query, filters = {}, options={}) {
  const response = await fetch('/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,filters,...options})});
  const data = await response.json();
  if(!response.ok) throw new Error(data.error || 'Не удалось выполнить поиск');
  return data;
}
async function route() {
  const id = ++requestId;
  const onResults = location.pathname === '/search';
  $('#home').classList.toggle('hidden',onResults); $('#results').classList.toggle('hidden',!onResults);
  document.title = onResults ? 'Подбор квартир — Простор' : 'Простор — ваш Петербург, ваше место';
  if(!onResults){currentSearchId=null;syncHomeDeal();setSearchMode(activeSearchMode);return;}
  const params = new URLSearchParams(location.search), query = params.get('q') || '';
  const savedOnly=params.get('saved')==='1';
  $('.filters').classList.toggle('hidden',savedOnly);
  $('.result-layout').classList.toggle('saved-layout',savedOnly);
  activeSearchMode=params.get('mode')==='filters'?'filters':'text';
  $('#results-form').classList.toggle('hidden',activeSearchMode==='filters'||savedOnly);
  $('#results-method-label').textContent=activeSearchMode==='filters'?'Поиск по фильтрам':'Поиск по описанию';
  let filters = {};
  try {filters = JSON.parse(params.get('f') || '{}');} catch { /* invalid URL state starts without overrides */ }
  currentSearchId=null;current=[];profile=null;
  $('#result-query').value = query; $('#error').classList.add('hidden'); $('#empty').classList.add('hidden');
  $('#result-cards').innerHTML = '<p class="loading-text">Собираем подходящие варианты…</p>';
  $('#results-title').textContent = 'Ищем ваше место…'; $('#results-subtitle').textContent = '';
  $('#profile-info').innerHTML = ''; $('#data-notice').textContent = '';
  $('#results').setAttribute('aria-busy','true');
  $('#pagination').classList.add('hidden');
  $('#sort').value=params.get('sort')||'relevance';
  try {
    const options={offset:Number(params.get('offset')||0),sort:$('#sort').value};
    let data;
    if(savedOnly){
      const response=await fetch('/api/saved',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[...favorites].reverse(),...options})});
      data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось загрузить избранное');
    }else data=await requestSearch(query,filters,{searchMode:activeSearchMode,...options});
    if(id!==requestId) return;
    current=data.results;profile=data.profile;meta=data.meta;currentSearchId=data.searchId; if(!savedOnly)fillFilters(profile.hard);
    $('#results-method-label').textContent=activeSearchMode==='filters'?'Поиск по фильтрам':`Поиск по описанию · ${extractorLabel(meta)}`;
    $('#profile-info').innerHTML=savedOnly?'Покупка и аренда · все доступные сохранённые объявления':conditions(profile);
    if(savedOnly)$('#results-method-label').textContent='Избранное';
    const freshness = meta.mode==='snapshot' ? ` Дата файла ${new Date(meta.snapshotDate).toLocaleDateString('ru-RU')}; актуальность не проверялась.` : meta.mode==='database'?' Исторический снимок, актуальность объявлений не проверялась.':'';
    $('#data-notice').textContent=`${modeLabel(meta)}.${freshness} ${meta.mode==='demo'?'Вымышленные объекты. ':''}${meta.providerHasMore?'Провайдер вернул часть рынка (до 50 кандидатов). ':''}${profile.coverage}`;
    if(meta.geography)$('#data-notice').append(' Районы определяются по границам OSM и координатам объявлений; точность самих координат не подтверждена.');
    $('#dataset-badge').textContent = `${modeLabel(meta)} · ${extractorLabel(meta)}`;
    if(meta.infrastructure)$('#data-notice').insertAdjacentHTML('beforeend',' Инфраструктура: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors · ODbL</a>, снимок '+esc(meta.infrastructure.snapshotAt)+'. Покрытие неполное; расстояния по прямой, не пешие маршруты.');
    renderResults();
  } catch(error) {
    if(id!==requestId) return;
    current=[]; $('#result-cards').innerHTML=''; $('#results-title').textContent='Поиск не завершён';
    $('#error').textContent=error.message;$('#error').classList.remove('hidden');
    const retry=document.createElement('button');retry.className='secondary';retry.textContent='Повторить поиск';retry.addEventListener('click',route);$('#error').append(document.createElement('br'),retry);
    const fallback=document.createElement('button');fallback.className='secondary';fallback.textContent='Перейти к фильтрам';fallback.addEventListener('click',()=>navigate('',filters,false,'filters'));$('#error').append(fallback);
  } finally {if(id===requestId) $('#results').removeAttribute('aria-busy');}
}
function navigate(query='', filters={}, saved=false, mode=activeSearchMode) {
  const params = new URLSearchParams();
  params.set('mode',mode);
  if(query) params.set('q',query);
  if(Object.keys(filters).length) params.set('f',JSON.stringify(filters));
  if(saved) params.set('saved','1');
  history.pushState({},'',`/search${params.size?'?'+params:''}`);route();window.scrollTo({top:0,behavior:'instant'});
}
function homeFilters(query) { return /снять|сниму|аренд|куп|продаж/i.test(query)?{}:{deal_type:activeDeal}; }
function rentalDetails(item){
  if(item.deal_type!=='rent')return '';
  const r=item.rental||{},yn=v=>v===true?'Да':v===false?'Нет':'Нет сведений';
  return `<h3>Условия аренды по данным объявления</h3><div class="detail-facts"><div><small>Можно с животными</small>${yn(r.pets_allowed)}</div><div><small>Можно с детьми</small>${yn(r.kids_allowed)}</div><div><small>Залог</small>${esc(r.deposit_text||'Не указан')}</div><div><small>Комиссия</small>${esc(r.commission_text||'Не указана')}</div><div><small>Плательщик ЖКУ</small>${esc(r.utilities_payer||'Не указан')}</div><div><small>Срок аренды</small>${esc(r.rent_period||'Не указан')}</div></div><p class="detail-alert">Суммы ЖКУ, счётчиков и полная сумма на въезд не подтверждены. Ограничения по животным и детям нужно уточнить у собственника.</p>`;
}
function showDetails(id) {
  const item=[...current,...homeItems].find(v=>v.id===id);if(!item)return;
  track('detail_open',id);
  $('#detail-content').innerHTML=`<img class="detail-photo" src="${esc(item.photos[0] || '/building.svg')}" alt="Фотография квартиры" referrerpolicy="no-referrer"><div class="detail-text"><span class="section-kicker">${esc(sourceNames[item.source] || item.source)}</span><h2>${roomsName(item)}, ${num(item.area_total)} м²</h2><div class="card-price">${money(item.price)}</div><p class="card-address">${esc(item.address)}</p><div class="detail-facts"><div><small>Площадь</small>${num(item.area_total)} м²</div><div><small>Кухня</small>${num(item.area_kitchen)} м²</div><div><small>Этаж</small>${num(item.floor)} / ${num(item.floors_total)}</div><div><small>Местность по данным источника</small>${esc(item.district || 'Не указан')}</div><div><small>Балкон</small>${esc(item.balcony || 'Не указан')}</div><div><small>Ремонт</small>${esc(item.renovation || 'Не указан')}</div></div><div class="card-reasons">${item.reasons.map(reason=>`<span class="reason">${esc(reason)}</span>`).join('')}</div><div class="detail-infrastructure">${infrastructureMarkup(item)}${item.infrastructure?'<p>Расстояния до нанесённой точки или территории, а не до входа; координаты объявления не проверены. Наличие школы/поликлиники не гарантирует зачисление/прикрепление. Данные OSM могут быть неполными.</p>':''}</div>${rentalDetails(item)}<h3>Описание от источника</h3><p class="detail-description">${esc(item.description || 'Описание не предоставлено.')}</p>${item.url?`<a class="primary detail-source" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Открыть объявление ↗</a>`:'<p class="nosource">Ссылка на первоисточник недоступна в этой выборке.</p>'}<p class="detail-alert">${meta?.mode==='demo'?'Вымышленный пример.':'Характеристики и цена приведены по данным источника. Актуальность предложения нужно проверить на площадке.'} Причины подбора рассчитаны по правилам и не являются вероятностью соответствия.</p></div>`;
  imageFallback($('#detail-content'));$('#detail-dialog').showModal();
  $('#detail-content .card-price').innerHTML=priceMarkup(item);
  const source=$('#detail-content .detail-source');if(source)source.dataset.source=id;
}
function syncHomeDeal() {
  document.querySelectorAll('[data-home-deal]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.homeDeal===activeDeal)));
  $('#home-query').placeholder=activeDeal==='rent'?'Снять двушку до 70 тысяч в месяц, рядом с метро…':'Двушка до 15 млн, рядом с метро и с большой кухней…';
  $('#home-budget-label').textContent=activeDeal==='rent'?'Бюджет, до ₽ / месяц':'Бюджет, до ₽';
  const examples=[...document.querySelectorAll('[data-query]')];
  const queries=activeDeal==='rent'?['Снять однокомнатную до 50 тыс, до 15 минут пешком до метро','Снять двушку до 80 тыс с большой кухней рядом с метро','Снять студию до 35 тыс']:['Однокомнатная квартира до 13 млн, до 10 минут пешком до метро','Двушка до 25 млн с большой кухней, рядом с метро','Студия до 8 млн'];
  examples.forEach((button,i)=>button.dataset.query=queries[i]);
}
async function loadHome() {
  if(meta?.mode==='metrapi')return;
  const deal=activeDeal;
  try{const data=await requestSearch('Рядом с метро с большой кухней',{deal_type:deal,rooms:1,price_max:deal==='rent'?60000:15000000},{context:'preview',searchMode:'filters'});
    if(deal!==activeDeal)return;$('#home-picks-title').textContent=deal==='rent'?'Однокомнатные до 60 тыс. в месяц':'Однокомнатные до 15 млн';homeItems=data.results.slice(0,3);$('#home-cards').innerHTML=homeItems.map(card).join('');imageFallback($('#home-cards'));
  }catch{$('#home-cards').innerHTML='<p class="data-notice">Не удалось загрузить каталог.</p>';}
}
function changePage(offset) {
  const url=new URL(location.href);url.searchParams.set('offset',offset);url.searchParams.set('sort',$('#sort').value);
  history.pushState({},'',url.pathname+url.search);route();window.scrollTo({top:0,behavior:'instant'});
}
document.addEventListener('click', event => {
  const deal=event.target.closest('[data-home-deal]');if(deal){activeDeal=deal.dataset.homeDeal;syncHomeDeal();loadHome();return;}
  const source=event.target.closest('[data-source]');if(source)track('source_open',source.dataset.source);
  const save=event.target.closest('[data-save]');
  if(save){const id=save.dataset.save;track(favorites.has(id)?'favorite_remove':'favorite_add',id);favorites.has(id)?favorites.delete(id):favorites.add(id);try{localStorage.setItem('prostor:favorites',JSON.stringify([...favorites]));}catch{toast('Избранное сохранено только до закрытия страницы');}updateSaved();if(new URLSearchParams(location.search).get('saved')==='1')route();return;}
  const detail=event.target.closest('[data-detail]');if(detail){showDetails(detail.dataset.detail);return;}
  const example=event.target.closest('[data-query]');if(example){$('#home-query').value=example.dataset.query;navigate(example.dataset.query,{deal_type:activeDeal});return;}
  const room=event.target.closest('[data-room]');if(room){setRoom(room.dataset.room);return;}
  const link=event.target.closest('a');
  if(link && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button===0 && link.origin===location.origin && ['/','/search'].includes(link.pathname)){
    event.preventDefault();history.pushState({},'',link.pathname+link.search);route();window.scrollTo({top:0,behavior:'instant'});
  }
});
document.querySelectorAll('[data-search-mode]').forEach(button=>button.addEventListener('click',()=>setSearchMode(button.dataset.searchMode)));
$('#home-form').addEventListener('submit',event=>{event.preventDefault();const query=$('#home-query').value.trim();navigate(query,homeFilters(query),false,'text');});
$('#home-filter-form').addEventListener('submit',event=>{event.preventDefault();navigate('',{deal_type:activeDeal,rooms:$('#home-rooms').value,price_max:$('#home-price').value,metro_max:$('#home-metro').value},false,'filters');});
$('#switch-method').addEventListener('click',()=>{
  setSearchMode(activeSearchMode==='filters'?'text':'filters');
  history.pushState({},'','/');route();window.scrollTo({top:0,behavior:'instant'});
});
$('#home-query').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();const query=event.target.value.trim();navigate(query,homeFilters(query));}});
$('#results-form').addEventListener('submit',event=>{event.preventDefault();navigate($('#result-query').value.trim(),{},false,'text');});
$('#filter-form').addEventListener('submit',event=>{event.preventDefault();navigate($('#result-query').value.trim(),{...profile?.hard,deal_type:$('#filter-deal').value,rooms:selectedRoom,price_max:$('#filter-price').value,area_min:$('#filter-area').value,metro_max:$('#filter-metro').value});});
$('#sort').addEventListener('change',()=>{if(profile)changePage(0);});
$('#prev-page').addEventListener('click',()=>changePage(Math.max(0,meta.offset-meta.limit)));
$('#next-page').addEventListener('click',()=>changePage(meta.offset+meta.limit));
$('#reset-filters').addEventListener('click',()=>navigate());$('#empty-reset').addEventListener('click',()=>navigate());
$('#saved-nav').addEventListener('click',()=>navigate('',{},true,'filters'));
$('.dialog-close').addEventListener('click',()=>$('#detail-dialog').close());
$('#detail-dialog').addEventListener('click',event=>{if(event.target===$('#detail-dialog'))$('#detail-dialog').close();});
window.addEventListener('popstate',route);
updateSaved();
$('#home').classList.toggle('hidden',location.pathname==='/search');
$('#results').classList.toggle('hidden',location.pathname!=='/search');
try {
  const response=await fetch('/api/meta');meta=await response.json();
  if(meta.mode==='database'){
    favorites=new Set([...favorites].map(id=>/^(sale|rent):/.test(id)?id:`sale:${id}`));
    try{localStorage.setItem('prostor:favorites',JSON.stringify([...favorites]));}catch{}updateSaved();
  }
  $('#dataset-badge').textContent=`${modeLabel(meta)} · учебный прототип`;
  $('#home-mode').textContent=`${modeLabel(meta)}${meta.total!==null?' · '+meta.total+' записей':''} · ${extractorLabel(meta)}`;
  if(meta.total)$('#home-total').innerHTML=`${num(meta.total)}<br>предложений.`;
  syncHomeDeal();
  if(meta.mode!=='metrapi') {
    await loadHome();
  } else $('#home-cards').innerHTML='<p class="data-notice">Введите описание, чтобы получить актуальную подборку Metrapi.</p>';
} catch {$('#home-cards').innerHTML='<p class="data-notice">Не удалось загрузить выборку. Попробуйте поиск выше.</p>';}
// Establish the HttpOnly session cookie before issuing a search or recording events.
route();
