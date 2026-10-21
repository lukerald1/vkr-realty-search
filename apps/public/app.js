const $ = selector => document.querySelector(selector);
const money = value => value === null ? 'Цена не указана' : `${new Intl.NumberFormat('ru-RU').format(value)} ₽`;
const num = value => value === null ? '—' : new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let favorites;
try { favorites = new Set(JSON.parse(localStorage.getItem('prostor:favorites') || '[]')); } catch { favorites = new Set(); }
let current = [], homeItems = [], profile = null, meta = null, selectedRoom = '', requestId = 0, toastTimer, activeDeal='sale', currentSearchId=null;
const sourceNames = {cian:'ЦИАН',domclick:'Домклик',yandex:'Яндекс Недвижимость',avito:'Авито',move:'Move.ru',demo:'Учебный пример'};
const roomsName = item => item.rooms === 0 ? 'Студия' : item.rooms === null ? 'Квартира' : `${item.rooms}-комн. квартира`;
const modeLabel = data => data.mode === 'demo' ? 'Учебные примеры · вымышленные объекты' : data.mode === 'metrapi' ? 'Данные Metrapi' : data.mode === 'database' ? 'Локальная база Петербурга' : 'Локальная выборка Metrapi';
const priceMarkup = item => money(item.price)+(item.deal_type==='rent'?'<span class="rent-unit"> / мес.</span>':'');
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
function card(item) {
  const id = esc(item.id), saved = favorites.has(item.id);
  const metro = item.metro ? `<div class="metro-line"><span class="metro-mark">м</span> ${esc(item.metro)}${item.metro_minutes !== null ? `<span class="distance">· ${num(item.metro_minutes)} мин ${item.metro_mode === 'walk' ? 'пешком' : item.metro_mode === 'transport' ? 'транспортом' : '(способ не указан)'}</span>` : ''}</div>` : '<div class="metro-line distance">Метро не указано</div>';
  return `<article class="card"><div class="card-media"><img class="card-image" src="${esc(item.photos[0] || '/building.svg')}" alt="${esc(item.photos.length ? roomsName(item) : 'Иллюстрация дома — фото отсутствует')}" loading="lazy" data-detail="${id}" referrerpolicy="no-referrer"><span class="source-badge">${esc(sourceNames[item.source] || item.source)}</span><button class="save-button" data-save="${id}" aria-label="${saved?'Убрать из избранного':'Добавить в избранное'}" aria-pressed="${saved}">${saved?'♥':'♡'}</button>${item.photos.length ? `<span class="photo-count">▧ ${item.photos.length}</span>`:''}</div><div class="card-body"><div class="card-price">${priceMarkup(item)}</div><div class="sqm-price">${item.price !== null && item.area_total > 0 ? `${money(Math.round(item.price/item.area_total))} за м²${item.deal_type==='rent'?' в месяц':''}` : 'Цена и характеристики по данным источника'}</div><button class="card-title" data-detail="${id}">${roomsName(item)}, ${num(item.area_total)} м²</button><div class="card-address">${esc(item.address)}</div>${metro}<div class="card-reasons">${(item.reasons.length ? item.reasons : ['Соответствует выбранным фильтрам']).map(reason=>`<span class="reason">${esc(reason)}</span>`).join('')}</div><button class="card-detail-link" data-detail="${id}">Подробнее о квартире <span aria-hidden="true">↗</span></button></div></article>`;
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
  $('#filter-price').value = hard.price_max ?? ''; $('#filter-area').value = hard.area_min ?? ''; $('#filter-metro').value = hard.metro_max ?? '';
}
function conditions(data) {
  const hard = data.hard;
  const conditions = ['Санкт-Петербург',hard.deal_type === 'sale' ? 'Покупка' : 'Аренда',hard.realty_type === 'flat' ? 'Квартира' : 'Дом'];
  if(hard.rooms !== undefined) conditions.push(hard.rooms === 0 ? 'Студия' : `${hard.rooms} комн.`);
  if(hard.price_max !== undefined) conditions.push(`До ${money(hard.price_max)}`);
  if(hard.price_min !== undefined) conditions.push(`От ${money(hard.price_min)}`);
  if(hard.area_min !== undefined) conditions.push(`От ${hard.area_min} м²`);
  if(hard.metro_max !== undefined) conditions.push(`Метро ≤ ${hard.metro_max} мин пешком`);
  if(hard.balcony_required !== undefined) conditions.push(hard.balcony_required ? 'С балконом / лоджией' : 'Без балкона');
  if(hard.floor_not_first) conditions.push('Не первый этаж');
  if(hard.floor_not_last) conditions.push('Не последний этаж');
  return conditions.map(text=>`<span class="condition">${esc(text)}</span>`).join('')
    + data.soft.map(key=>`<span class="condition soft">Желательно: ${key==='metro'?'ближе к метро':'большая кухня'}</span>`).join('')
    + data.unknown.map(text=>`<span class="condition warn">Не проверено: ${esc(text)}</span>`).join('');
}
function renderResults() {
  const savedOnly = new URLSearchParams(location.search).get('saved') === '1';
  const items=[...current], count=meta.totalMatched??items.length;
  $('#results-title').textContent = savedOnly ? `Избранное · ${num(count)}` : `${num(count)} ${count%10===1&&count%100!==11?'вариант':count%10>=2&&count%10<=4&&(count%100<12||count%100>14)?'варианта':'вариантов'} для вас`;
  $('#results-kicker').textContent = savedOnly ? 'ТО, ЧТО ПОНРАВИЛОСЬ' : 'ВАША ПОДБОРКА';
  $('#results-subtitle').textContent = savedOnly ? 'Сохранённые объекты из текущей доступной выборки.' : profile.soft.length ? 'Сначала — объекты, которые ближе к вашим пожеланиям.' : 'Подборка по обязательным условиям. Добавьте пожелания в описание.';
  $('#result-cards').innerHTML = items.map(card).join(''); imageFallback($('#result-cards'));
  $('#empty').classList.toggle('hidden',items.length>0);
  $('#empty h2').textContent = savedOnly ? 'Здесь будут ваши любимые варианты' : 'Пока нет точного совпадения';
  $('#empty p').textContent = savedOnly ? 'Нажмите на сердечко у понравившейся квартиры.' : 'Попробуйте изменить бюджет или комнатность. Мы сохранили ваши обязательные условия. В локальной выборке может просто не быть нужных объектов.';
  if(profile.outsideScope){$('#empty h2').textContent='Сейчас ищем только в Петербурге';$('#empty p').textContent='Ленинградская область и другие города не входят в исследование. Укажите квартиру в Санкт-Петербурге.';}
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
  if(!onResults){currentSearchId=null;syncHomeDeal();return;}
  const params = new URLSearchParams(location.search), query = params.get('q') || '';
  let filters = {};
  try {filters = JSON.parse(params.get('f') || '{}');} catch { /* invalid URL state starts without overrides */ }
  $('#result-query').value = query; $('#error').classList.add('hidden'); $('#empty').classList.add('hidden');
  $('#result-cards').innerHTML = '<p class="loading-text">Собираем подходящие варианты…</p>';
  $('#results-title').textContent = 'Ищем ваше место…'; $('#results-subtitle').textContent = '';
  $('#profile-info').innerHTML = ''; $('#data-notice').textContent = '';
  $('#results').setAttribute('aria-busy','true');
  $('#pagination').classList.add('hidden');
  $('#sort').value=params.get('sort')||'relevance';
  try {
    const data = await requestSearch(query,filters,{offset:Number(params.get('offset')||0),sort:$('#sort').value,...(params.get('saved')==='1'?{ids:[...favorites]}:{})});
    if(id!==requestId) return;
    current=data.results;profile=data.profile;meta=data.meta;currentSearchId=data.searchId; fillFilters(profile.hard);
    $('#profile-info').innerHTML=conditions(profile);
    const freshness = meta.mode==='snapshot' ? ` Дата файла ${new Date(meta.snapshotDate).toLocaleDateString('ru-RU')}; актуальность не проверялась.` : meta.mode==='database'?' Исторический снимок, актуальность объявлений не проверялась.':'';
    $('#data-notice').textContent=`${modeLabel(meta)}.${freshness} ${meta.mode==='demo'?'Вымышленные объекты. ':''}${meta.providerHasMore?'Провайдер вернул часть рынка (до 50 кандидатов). ':''}${profile.coverage}`;
    $('#dataset-badge').textContent = `${modeLabel(meta)} · разбор по правилам`;
    renderResults();
  } catch(error) {
    if(id!==requestId) return;
    current=[]; $('#result-cards').innerHTML=''; $('#results-title').textContent='Поиск не завершён';
    $('#error').textContent=error.message;$('#error').classList.remove('hidden');
  } finally {if(id===requestId) $('#results').removeAttribute('aria-busy');}
}
function navigate(query='', filters={}, saved=false) {
  const params = new URLSearchParams();
  if(query) params.set('q',query);
  if(Object.keys(filters).length) params.set('f',JSON.stringify(filters));
  if(saved) params.set('saved','1');
  history.pushState({},'',`/search${params.size?'?'+params:''}`);route();window.scrollTo({top:0,behavior:'instant'});
}
function homeFilters(query) { return /снять|сниму|аренд|куп|продаж/i.test(query)?{}:{deal_type:activeDeal}; }
function showDetails(id) {
  const item=[...current,...homeItems].find(v=>v.id===id);if(!item)return;
  track('detail_open',id);
  $('#detail-content').innerHTML=`<img class="detail-photo" src="${esc(item.photos[0] || '/building.svg')}" alt="Фотография квартиры" referrerpolicy="no-referrer"><div class="detail-text"><span class="section-kicker">${esc(sourceNames[item.source] || item.source)}</span><h2>${roomsName(item)}, ${num(item.area_total)} м²</h2><div class="card-price">${money(item.price)}</div><p class="card-address">${esc(item.address)}</p><div class="detail-facts"><div><small>Площадь</small>${num(item.area_total)} м²</div><div><small>Кухня</small>${num(item.area_kitchen)} м²</div><div><small>Этаж</small>${num(item.floor)} / ${num(item.floors_total)}</div><div><small>Район</small>${esc(item.district || 'Не указан')}</div><div><small>Балкон</small>${esc(item.balcony || 'Не указан')}</div><div><small>Ремонт</small>${esc(item.renovation || 'Не указан')}</div></div><div class="card-reasons">${item.reasons.map(reason=>`<span class="reason">${esc(reason)}</span>`).join('')}</div><h3>Описание от источника</h3><p class="detail-description">${esc(item.description || 'Описание не предоставлено.')}</p>${item.url?`<a class="primary detail-source" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Открыть объявление ↗</a>`:'<p class="nosource">Ссылка на первоисточник недоступна в этой выборке.</p>'}<p class="detail-alert">${meta?.mode==='demo'?'Вымышленный пример.':'Характеристики и цена приведены по данным источника. Актуальность предложения нужно проверить на площадке.'} Причины подбора рассчитаны по правилам и не являются вероятностью соответствия.</p></div>`;
  imageFallback($('#detail-content'));$('#detail-dialog').showModal();
  $('#detail-content .card-price').innerHTML=priceMarkup(item);
  const source=$('#detail-content .detail-source');if(source)source.dataset.source=id;
}
function syncHomeDeal() {
  document.querySelectorAll('[data-home-deal]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.homeDeal===activeDeal)));
  $('#home-query').placeholder=activeDeal==='rent'?'Снять двушку до 70 тысяч в месяц, рядом с метро…':'Двушка до 15 млн, рядом с метро и с большой кухней…';
  const examples=[...document.querySelectorAll('[data-query]')];
  const queries=activeDeal==='rent'?['Снять однокомнатную до 50 тыс, до 15 минут пешком до метро','Снять двушку до 80 тыс с большой кухней рядом с метро','Снять студию до 35 тыс']:['Однокомнатная квартира до 13 млн, до 10 минут пешком до метро','Двушка до 25 млн с большой кухней, рядом с метро','Студия до 8 млн'];
  examples.forEach((button,i)=>button.dataset.query=queries[i]);
}
async function loadHome() {
  if(meta?.mode==='metrapi')return;
  const deal=activeDeal;
  try{const data=await requestSearch('Рядом с метро с большой кухней',{deal_type:deal},{context:'preview'});
    if(deal!==activeDeal)return;homeItems=data.results.slice(0,3);$('#home-cards').innerHTML=homeItems.map(card).join('');imageFallback($('#home-cards'));
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
$('#home-form').addEventListener('submit',event=>{event.preventDefault();const query=$('#home-query').value.trim();navigate(query,homeFilters(query));});
$('#home-query').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();const query=event.target.value.trim();navigate(query,homeFilters(query));}});
$('#results-form').addEventListener('submit',event=>{event.preventDefault();navigate($('#result-query').value.trim());});
$('#filter-form').addEventListener('submit',event=>{event.preventDefault();navigate($('#result-query').value.trim(),{deal_type:$('#filter-deal').value,rooms:selectedRoom,price_max:$('#filter-price').value,area_min:$('#filter-area').value,metro_max:$('#filter-metro').value});});
$('#sort').addEventListener('change',()=>{if(profile)changePage(0);});
$('#prev-page').addEventListener('click',()=>changePage(Math.max(0,meta.offset-meta.limit)));
$('#next-page').addEventListener('click',()=>changePage(meta.offset+meta.limit));
$('#reset-filters').addEventListener('click',()=>navigate());$('#empty-reset').addEventListener('click',()=>navigate());
$('#saved-nav').addEventListener('click',()=>navigate('',{deal_type:activeDeal},true));
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
  $('#home-mode').textContent=`${modeLabel(meta)}${meta.total!==null?' · '+meta.total+' записей':''} · основные условия распознаются по правилам`;
  if(meta.total)$('#home-total').innerHTML=`${num(meta.total)}<br>предложений.`;
  syncHomeDeal();
  if(meta.mode!=='metrapi') {
    await loadHome();
  } else $('#home-cards').innerHTML='<p class="data-notice">Введите описание, чтобы получить актуальную подборку Metrapi.</p>';
} catch {$('#home-cards').innerHTML='<p class="data-notice">Не удалось загрузить выборку. Попробуйте поиск выше.</p>';}
// Establish the HttpOnly session cookie before issuing a search or recording events.
route();
