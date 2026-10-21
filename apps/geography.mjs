// Study scope: federal city Saint Petersburg, including its municipal towns.
// Regional labels alone are unreliable in source feeds; unknown geography is quarantined.
const localities = new Set(['санкт-петербург','петербург','колпино','пушкин','павловск','петергоф','ломоносов','кронштадт','сестрорецк','зеленогорск','красное село','парголово','шушары','стрельна','репино','комарово','солнечное','молодежное','смолячково','ушково','серово','песочный','белоостров','левашово','металлострой','понтонный','петро-славянка','усть-ижора','саперный','тярлево','александровская']);
export function spbScope(item) {
  const region=String(item.region||'').toLowerCase().replace(/ё/g,'е').trim();
  const locality=String(item.locality||'').toLowerCase().replace(/ё/g,'е').replace(/^(?:г\.?|город|п\.?|поселок)\s+/,'').trim();
  if (item.city !== 'spb' || (region && region !== 'санкт-петербург')) return 'outside';
  if (!locality || !region) return 'unverified';
  return localities.has(locality) ? 'accepted' : 'outside';
}
