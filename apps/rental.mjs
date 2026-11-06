const bool=v=>v===true||/^да$/i.test(String(v))?true:v===false||/^нет$/i.test(String(v))?false:null;
function money(v,zeroPattern){
  if(typeof v!=='string')return null;const s=v.trim();if(zeroPattern.test(s)||/^0(?:[.,]0+)?(?:\s*[%₽])?$/.test(s))return 0;
  const m=s.match(/^([\d\s\u00a0]+(?:[.,]\d+)?)\s*(?:₽|руб\.?|рублей)$/i);return m?Number(m[1].replace(/[\s\u00a0]/g,'').replace(',','.')):null;
}
export function rentalFacts(item){
  if(item.deal_type!=='rent')return null;
  if(item.rental?.source==='listing_fields'&&item.deposit===undefined&&item.commission===undefined)return item.rental;
  let commission=money(item.commission,/^без комиссии$/i);
  const percent=typeof item.commission==='string'?item.commission.trim().match(/^(\d+(?:[.,]\d+)?)\s*%$/):null;
  if(percent&&Number.isFinite(Number(item.price)))commission=Number(item.price)*Number(percent[1].replace(',','.'))/100;
  return {source:'listing_fields',pets_allowed:bool(item.pets_allowed),kids_allowed:bool(item.kids_allowed),deposit_amount:money(item.deposit,/^без залога$/i),commission_amount:commission,
    deposit_text:typeof item.deposit==='string'?item.deposit.slice(0,200):null,commission_text:typeof item.commission==='string'?item.commission.slice(0,200):null,
    utilities_payer:typeof item.utilities_payer==='string'?item.utilities_payer.slice(0,100):null,rent_period:typeof item.rent_period==='string'?item.rent_period.slice(0,100):null};
}
export function parseRental(query,deal){
  const text=query.toLowerCase().replace(/ё/g,'е'),hard={},unknown=[],questions=[];
  if(deal==='rent'){
    if(/с (?:кошк[а-я]*|котом|котами|собак[а-я]*|животн[а-я]*)/.test(text)){
      hard.pets_required=true;
      if(/больш[а-я]* собак|двумя|нескольк[а-я]* животн/.test(text))questions.push('Разрешение животных указано без ограничений размера и количества. Эти условия нужно подтвердить у собственника.');
    }
    if(/с ребенком|с детьми/.test(text))hard.kids_required=true;
    if(/без комиссии/.test(text))hard.no_commission=true;
    if(/без залога/.test(text))hard.deposit_max=0;
    const d=text.match(/залог\s*(?:до|не более)\s*(\d+(?:[.,]\d+)?)\s*(тыс[а-я]*|руб[а-я]*|₽)/);
    if(d)hard.deposit_max=Number(d[1].replace(',','.'))*(d[2].startsWith('тыс')?1000:1);
    if(/включая (?:ку|жку|коммунал)|(?:вместе|со всеми)\s+(?:с\s+)?(?:ку|жку|коммунал|платеж)|с учетом (?:ку|жку|коммунал)|(?:ку|жку|коммунал[а-я]*) включен|с\s+(?:ку|жку|коммуналкой)(?![а-я])|все включено/.test(text))questions.push('Полный ежемесячный бюджет с ЖКУ пока нельзя проверить: суммы ЖКУ и счётчиков отсутствуют. Уточните бюджет самой аренды.');
    if(/на въезд|первоначальн[а-я]* платеж|залог.*(?:частями|разбить)|регистраци|на\s+\d+\s+месяц/.test(text))questions.push('Сумму на въезд, рассрочку залога, регистрацию и конкретный срок нужно подтвердить отдельно; полного набора этих данных в каталоге нет.');
  }
  if(/евро[- ]?(?:двуш|треш|двухкомнат|трехкомнат)/.test(text))questions.push('Уточните планировку евроформата: число спален и отдельность кухни. Обычная комнатность этого не подтверждает.');
  if(/без (?:пересадок|перехода)|до работ[ыа]|до родителей|между работой|без.*(?:мост|кад)|\d+\s*минут.*(?:работ|родител)/.test(text))questions.push('Для такого условия нужен маршрут до конкретной точки. Сейчас время поездки, пересадки, мосты и переходы дорог не проверяются.');
  for(const [re,label]of [[/человейник/,'Плотность застройки и число квартир'],[/окна во двор|окна в окна|вид на|солнечно после/,'Вид и ориентация окон'],[/без ступен|коляск|безбарьер/,'Безбарьерная доступность'],[/с чемоданом|для работы|кабинет|не проходн/,'Оснащение и планировка'],[/ипотек|маткапитал|обременени/,'Финансирование и юридические условия сделки']])if(re.test(text))unknown.push(label);
  return {hard,unknown,questions};
}
