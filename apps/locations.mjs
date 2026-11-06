// Product zones are explicit groups, not official administrative divisions.
const names=['Адмиралтейский','Василеостровский','Выборгский','Калининский','Кировский','Колпинский','Красногвардейский','Красносельский','Кронштадтский','Курортный','Московский','Невский','Петроградский','Петродворцовый','Приморский','Пушкинский','Фрунзенский','Центральный'];
export const areas=names.map((label,i)=>({id:`district:${i}`,label:`${label} район`,kind:'district',pattern:label.toLowerCase().replace(/ий$/,'[а-я]*')}));
const districtId=name=>areas.find(a=>a.label===`${name} район`).id;
for(const [id,label,pattern,members]of [
 ['north','Север — схема проекта','на севере|север города|север петербурга|север',['Приморский','Выборгский','Калининский']],
 ['south','Юг — схема проекта','на юге|юг города|юг петербурга|юг',['Московский','Фрунзенский','Кировский','Красносельский']],
 ['centre','Центр — схема проекта','в центре|центр города|центр петербурга|центр',['Центральный','Адмиралтейский','Петроградский','Василеостровский']],
 ['northwest','Северо-запад — схема проекта','на северо-западе|северо-запад города',['Приморский']],
 ['southwest','Юго-запад — схема проекта','на юго-западе|юго-запад города',['Кировский','Красносельский']]
])areas.push({id:`zone:${id}`,label,pattern,members:members.map(districtId),kind:'zone'});
for(const [id,label,pattern,sourceLabels,localities]of [
 ['lakhta','Лахта-Ольгино (МО)','лахт[а-я]*|ольгино',['Лахта-Ольгино'],[]],
 ['kolomyagi','Коломяги','коломяг[а-я]*',['Коломяги'],[]],
 ['ozerki','Шувалово-Озерки (МО)','(?:шувалово[- ]?)?озерк[а-я]*',['Шувалово-Озерки'],[]],
 ['kupchino','Купчино (по названию источника)','купчино',['Купчино'],[]],
 ['kronstadt','Кронштадт','кронштадт[а-я]*',[],['Кронштадт']],
 ['pushkin','Пушкин','пушкин(?:е|а|у|ом)?',[],['Пушкин']],
 ['peterhof','Петергоф','петергоф[а-я]*|петродворец',[],['Петергоф']],
 ['lomonosov','Ломоносов','ломоносов(?:е|а|у|ом)?',[],['Ломоносов']],
 ['sestroretsk','Сестрорецк','сестрорецк[а-я]*',[],['Сестрорецк']],
 ['kolpino','Колпино','колпино',[],['Колпино']],
 ['shushary','Шушары','шушар[а-я]*',['Шушары'],['Шушары']],
 ['pargolovo','Парголово','парголово',['Парголово'],['Парголово']]
])areas.push({id:`place:${id}`,label,pattern,sourceLabels,localities,kind:'place'});
// Conversational aliases with a visible, exact interpretation.
areas.find(a=>a.label==='Василеостровский район').pattern+='|на ваське|васильевск[а-я]* остров[а-я]*';
areas.find(a=>a.label==='Петроградский район').pattern+='|на петроградке|петроградк[а-я]*';
export const areaIds=new Set(areas.map(a=>a.id));
export const placeParents={'place:kronstadt':districtId('Кронштадтский'),'place:pushkin':districtId('Пушкинский'),'place:peterhof':districtId('Петродворцовый'),'place:lomonosov':districtId('Петродворцовый'),'place:sestroretsk':districtId('Курортный'),'place:kolpino':districtId('Колпинский'),'place:shushary':districtId('Пушкинский'),'place:pargolovo':districtId('Выборгский')};
const clean=v=>String(v||'').toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
let metroNames=[];
export function setMetroNames(names){metroNames=[...new Set(names.filter(n=>typeof n==='string'&&n.trim()))];}
export function parseMetroNames(query){
  const text=clean(query);if(!/метро|станци|м\./.test(text))return [];
  return metroNames.filter(name=>{const n=clean(name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const pattern=n.endsWith('ая')?n.slice(0,-2)+'(?:ая|ой|ую)':n;return new RegExp(`(?<![а-я])${pattern}(?![а-я])`).test(text);});
}
export function listingAreas(item){
  const ids=new Set(Array.isArray(item.geography?.area_ids)?item.geography.area_ids.filter(id=>areaIds.has(id)):[]);
  // Source-label evidence is retained separately from coordinate-based assignment.
  for(const a of areas){
    if(a.kind==='district'&&!item.geography?.districtResolved&&clean(item.district)===clean(a.label.replace(/ район$/,'')))ids.add(a.id);
    if(a.kind==='place'&&!item.geography?.checked_places?.includes(a.id)&&(a.sourceLabels.some(v=>clean(v)===clean(item.district))||a.localities.some(v=>clean(v)===clean(item.locality))))ids.add(a.id);
  }
  for(const a of areas)if(a.kind==='zone'&&a.members.some(id=>ids.has(id)))ids.add(a.id);
  return [...ids];
}
export function parseLocations(query){
  const text=clean(query).replace(/кроншдадт/g,'кронштадт'),include=[],exclude=[],preferred=[],notes=[],questions=[];
  for(const a of areas){
    const re=new RegExp(`(?<![а-я])(?:${a.pattern})(?![а-я])`,'g');
    for(const m of text.matchAll(re)){
      const before=text.slice(Math.max(0,m.index-55),m.index),after=text.slice(m.index+m[0].length,m.index+m[0].length+25);
      if(a.kind==='place'&&/(?:метро|станции|станция|м\.)\s*$/.test(before))continue;
      if(a.id==='place:lakhta'&&/[- ]?центр/.test(after)){questions.push('У Лахта-центра: укажите предел расстояния или времени. Близость к зданию не равна территории Лахта-Ольгино.');continue;}
      const negative=/(?:кроме|исключая|не в|не на|без|только не|не)\s*$/.test(before)||/(?:кроме|исключая)[^,.;!?]{0,40}$/.test(before);
      const soft=/(?:желательно|предпочтительно)[^.;!?]{0,40}$/.test(before);
      (negative?exclude:soft?preferred:include).push(a.id);
      if(a.kind==='zone')notes.push(`${a.label}: ${a.members.map(id=>areas.find(v=>v.id===id).label).join(', ')}. Это условная зона; измените её состав выбором районов.`);
      if(['place:lakhta','place:ozerki'].includes(a.id))notes.push(`Распознано: ${a.label}. Это муниципальная территория, не радиус от метро или достопримечательности.`);
    }
  }
  if(/историческ[а-я]* центр|почти центр|ближе к центру/.test(text))questions.push('Уточните границы центра: перечислите районы или выберите территорию в фильтрах. Исторический центр не равен Центральному району.');
  const foreign=[...text.matchAll(/(?<![а-я])(?:москв[аеуы]|мурино|кудров[а-я]*|ленинградск[а-я]* област[а-я]*|казан[ьи]|сочи|новосибирск[а-я]*)(?![а-я])/g)];
  const outsideScope=foreign.some(m=>!/(?:кроме|исключая|не в|не на|только не|не)\s*$|(?:кроме|исключая)[^,.;!?]{0,50}$/.test(text.slice(Math.max(0,m.index-55),m.index)));
  if(foreign.length&&!outsideScope)notes.push('Указанные исключения за пределами СПб уже не входят в каталог.');
  const any=[...new Set(include)],none=[...new Set(exclude)];
  if(any.length&&any.every(id=>none.includes(id)))questions.push('Все выбранные территории одновременно исключены. Измените список территорий.');
  return {hard:{...(any.length?{areas_any:any}:{}),...(none.length?{areas_none:none}:{})},preferred:[...new Set(preferred)],outsideScope,notes:[...new Set(notes)],questions:[...new Set(questions)],recognized:include.length+exclude.length+preferred.length>0};
}
export function matchesLocation(item,hard){
  const ids=listingAreas(item);
  // Missing location evidence never passes an exclusion either.
  return (!hard.areas_any?.length||hard.areas_any.some(id=>ids.includes(id)))&&(!hard.areas_none?.length||(hard.areas_none.every(id=>id.startsWith('place:')?item.geography?.checked_places?.includes(id):ids.some(v=>v.startsWith('district:')))&&!hard.areas_none.some(id=>ids.includes(id))));
}
