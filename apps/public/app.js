const $ = selector => document.querySelector(selector);
const money = value => value === null ? 'Цена не указана' : `${new Intl.NumberFormat('ru-RU').format(value)} ₽`;
const num = value => value === null ? '—' : new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let favorites;
try { favorites = new Set(JSON.parse(localStorage.getItem('prostor:favorites') || '[]')); } catch { favorites = new Set(); }
let current = [], homeItems = [], profile = null, meta = null, selectedRoom = '', requestId = 0, toastTimer;
const sourceNames = {cian:'ЦИАН',domclick:'Домклик',yandex:'Яндекс Недвижимость',avito:'Авито',demo:'Учебный пример'};
const roomsName = item => item.rooms === 0 ? 'Студия' : item.rooms === null ? 'Квартира' : `${item.rooms}-комн. квартира`;
const modeLabel = data => data.mode === 'demo' ? 'Учебные примеры · вымышленные объекты' : data.mode === 'metrapi' ? 'Данные Metrapi' : 'Локальная выборка Metrapi';
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
  return `<article class="card"><div class="card-media"><img class="card-image" src="${esc(item.photos[0] || '/building.svg')}" alt="${esc(item.photos.length ? roomsName(item) : 'Иллюстрация дома — фото отсутствует')}" loading="lazy" data-detail="${id}" referrerpolicy="no-referrer"><span class="source-badge">${esc(sourceNames[item.source] || item.source)}</span><button class="save-button" data-save="${id}" aria-label="${saved?'Убрать из избранного':'Добавить в избранное'}" aria-pressed="${saved}">${saved?'♥':'♡'}</button>${item.photos.length ? `<span class="photo-count">▧ ${item.photos.length}</span>`:''}</div><div class="card-body"><div class="card-price">${money(item.price)}</div><div class="sqm-price">${item.price !== null && item.area_total > 0 ? `${money(Math.round(item.price/item.area_total))} за м²` : 'Цена и характеристики по данным источника'}</div><button class="card-title" data-detail="${id}">${roomsName(item)}, ${num(item.area_total)} м²</button><div class="card-address">${esc(item.address)}</div>${metro}<div class="card-reasons">${(item.reasons.length ? item.reasons : ['Соответствует выбранным фильтрам']).map(reason=>`<span class="reason">${esc(reason)}</span>`).join('')}</div><button class="card-detail-link" data-detail="${id}">Подробнее о квартире <span aria-hidden="true">↗</span></button></div></article>`;
}
function imageFallback(container) {
  container.querySelectorAll('img').forEach(img => img.addEventListener('error',()=>{img.src='/building.svg';img.alt='Иллюстрация дома — фото недоступно';},{once:true}));
}
function setRoom(value) {
  selectedRoom = String(value ?? '');
  document.querySelectorAll('[data-room]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.room === selectedRoom)));
}
function fillFilters(hard) {
  $('#filter-city').value = hard.city; setRoom(hard.rooms);
  $('#filter-price').value = hard.price_max ?? ''; $('#filter-area').value = hard.area_min ?? ''; $('#filter-metro').value = hard.metro_max ?? '';
}
function conditions(data) {
  const hard = data.hard;
  const conditions = [hard.city === 'spb' ? 'Санкт-Петербург' : 'Москва',hard.deal_type === 'sale' ? 'Покупка' : 'Аренда',hard.realty_type === 'flat' ? 'Квартира' : 'Дом'];
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
  let items = savedOnly ? current.filter(item=>favorites.has(item.id)) : [...current];
  const sort = $('#sort').value;
  if(sort==='price') items.sort((a,b)=>(a.price??Infinity)-(b.price??Infinity));
  if(sort==='area') items.sort((a,b)=>(b.area_total??-Infinity)-(a.area_total??-Infinity));
  $('#results-title').textContent = savedOnly ? `Избранное · ${items.length}` : `${items.length} ${items.length%10===1&&items.length%100!==11?'вариант':items.length%10>=2&&items.length%10<=4&&(items.length%100<12||items.length%100>14)?'варианта':'вариантов'} для вас`;
  $('#results-kicker').textContent = savedOnly ? 'ТО, ЧТО ПОНРАВИЛОСЬ' : 'ВАША ПОДБОРКА';
  $('#results-subtitle').textContent = savedOnly ? 'Сохранённые объекты из текущей доступной выборки.' : profile.soft.length ? 'Сначала — объекты, которые ближе к вашим пожеланиям.' : 'Подборка по обязательным условиям. Добавьте пожелания в описание.';
  $('#result-cards').innerHTML = items.map(card).join(''); imageFallback($('#result-cards'));
  $('#empty').classList.toggle('hidden',items.length>0);
  $('#empty h2').textContent = savedOnly ? 'Здесь будут ваши любимые варианты' : 'Пока нет точного совпадения';
  $('#empty p').textContent = savedOnly ? 'Нажмите на сердечко у понравившейся квартиры.' : 'Попробуйте изменить бюджет или комнатность. Мы сохранили ваши обязательные условия. В локальной выборке может просто не быть нужных объектов.';
}
async function requestSearch(query, filters = {}) {
  const response = await fetch('/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,filters})});
  const data = await response.json();
  if(!response.ok) throw new Error(data.error || 'Не удалось выполнить поиск');
  return data;
}
async function route() {
  const id = ++requestId;
  const onResults = location.pathname === '/search';
  $('#home').classList.toggle('hidden',onResults); $('#results').classList.toggle('hidden',!onResults);
  document.title = onResults ? 'Подбор квартир — Простор' : 'Простор — жильё, которое подходит вам';
  if(!onResults) return;
  const params = new URLSearchParams(location.search), query = params.get('q') || '';
  let filters = {};
  try {filters = JSON.parse(params.get('f') || '{}');} catch { /* invalid URL state starts without overrides */ }
  $('#result-query').value = query; $('#error').classList.add('hidden'); $('#empty').classList.add('hidden');
  $('#result-cards').innerHTML = '<p class="loading-text">Собираем подходящие варианты…</p>';
  $('#results-title').textContent = 'Ищем ваше место…'; $('#results-subtitle').textContent = '';
  $('#profile-info').innerHTML = ''; $('#data-notice').textContent = '';
  $('#results').setAttribute('aria-busy','true');
  try {
    const data = await requestSearch(query,filters);
    if(id!==requestId) return;
    current=data.results;profile=data.profile;meta=data.meta; fillFilters(profile.hard);
    $('#profile-info').innerHTML=conditions(profile);
    const freshness = meta.mode==='snapshot' ? ` Дата файла ${new Date(meta.snapshotDate).toLocaleDateString('ru-RU')}; актуальность не проверялась.` : '';
    $('#data-notice').textContent=`${modeLabel(meta)}.${freshness} ${meta.mode==='demo'?'Это вымышленные объекты, а не предложения о продаже. ':''}${meta.hasMore?'Показана часть доступной выборки (до 50 объектов); это не полный рынок. ':''}${profile.notes.join('. ')}. ${profile.coverage}`;
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
function showDetails(id) {
  const item=[...current,...homeItems].find(v=>v.id===id);if(!item)return;
  $('#detail-content').innerHTML=`<img class="detail-photo" src="${esc(item.photos[0] || '/building.svg')}" alt="Фотография квартиры" referrerpolicy="no-referrer"><div class="detail-text"><span class="section-kicker">${esc(sourceNames[item.source] || item.source)}</span><h2>${roomsName(item)}, ${num(item.area_total)} м²</h2><div class="card-price">${money(item.price)}</div><p class="card-address">${esc(item.address)}</p><div class="detail-facts"><div><small>Площадь</small>${num(item.area_total)} м²</div><div><small>Кухня</small>${num(item.area_kitchen)} м²</div><div><small>Этаж</small>${num(item.floor)} / ${num(item.floors_total)}</div><div><small>Район</small>${esc(item.district || 'Не указан')}</div><div><small>Балкон</small>${esc(item.balcony || 'Не указан')}</div><div><small>Ремонт</small>${esc(item.renovation || 'Не указан')}</div></div><div class="card-reasons">${item.reasons.map(reason=>`<span class="reason">${esc(reason)}</span>`).join('')}</div><h3>Описание от источника</h3><p class="detail-description">${esc(item.description || 'Описание не предоставлено.')}</p>${item.url?`<a class="primary detail-source" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Открыть объявление ↗</a>`:'<p class="nosource">Ссылка на первоисточник недоступна в этой выборке.</p>'}<p class="detail-alert">${meta?.mode==='demo'?'Вымышленный пример.':'Характеристики и цена приведены по данным источника. Актуальность предложения нужно проверить на площадке.'} Причины подбора рассчитаны по правилам и не являются вероятностью соответствия.</p></div>`;
  imageFallback($('#detail-content'));$('#detail-dialog').showModal();
}
document.addEventListener('click', event => {
  const save=event.target.closest('[data-save]');
  if(save){const id=save.dataset.save;favorites.has(id)?favorites.delete(id):favorites.add(id);try{localStorage.setItem('prostor:favorites',JSON.stringify([...favorites]));}catch{toast('Избранное сохранено только до закрытия страницы');}updateSaved();if(new URLSearchParams(location.search).get('saved')==='1')renderResults();return;}
  const detail=event.target.closest('[data-detail]');if(detail){showDetails(detail.dataset.detail);return;}
  const example=event.target.closest('[data-query]');if(example){$('#home-query').value=example.dataset.query;navigate(example.dataset.query);return;}
  const room=event.target.closest('[data-room]');if(room){setRoom(room.dataset.room);return;}
  const link=event.target.closest('a');
  if(link && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button===0 && link.origin===location.origin && ['/','/search'].includes(link.pathname)){
    event.preventDefault();history.pushState({},'',link.pathname+link.search);route();window.scrollTo({top:0,behavior:'instant'});
  }
});
$('#home-form').addEventListener('submit',event=>{event.preventDefault();navigate($('#home-query').value.trim());});
$('#home-query').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();navigate(event.target.value.trim());}});
$('#results-form').addEventListener('submit',event=>{event.preventDefault();navigate($('#result-query').value.trim());});
$('#filter-form').addEventListener('submit',event=>{event.preventDefault();navigate($('#result-query').value.trim(),{city:$('#filter-city').value,rooms:selectedRoom,price_max:$('#filter-price').value,area_min:$('#filter-area').value,metro_max:$('#filter-metro').value});});
$('#sort').addEventListener('change',()=>{if(profile)renderResults();});
$('#reset-filters').addEventListener('click',()=>navigate());$('#empty-reset').addEventListener('click',()=>navigate());
$('#saved-nav').addEventListener('click',()=>navigate('',{},true));
$('.dialog-close').addEventListener('click',()=>$('#detail-dialog').close());
$('#detail-dialog').addEventListener('click',event=>{if(event.target===$('#detail-dialog'))$('#detail-dialog').close();});
window.addEventListener('popstate',route);
updateSaved();route();
try {
  const response=await fetch('/api/meta');meta=await response.json();
  $('#dataset-badge').textContent=`${modeLabel(meta)} · учебный прототип`;
  $('#home-mode').textContent=`${modeLabel(meta)}${meta.total!==null?' · '+meta.total+' записей':''} · основные условия распознаются по правилам`;
  if(meta.mode!=='metrapi') {
    const data=await requestSearch('');homeItems=data.results.slice(0,3);
    $('#home-cards').innerHTML=homeItems.map(card).join('');imageFallback($('#home-cards'));
  } else $('#home-cards').innerHTML='<p class="data-notice">Введите описание, чтобы получить актуальную подборку Metrapi.</p>';
} catch {$('#home-cards').innerHTML='<p class="data-notice">Не удалось загрузить выборку. Попробуйте поиск выше.</p>';}
