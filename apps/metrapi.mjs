import {metrapiParams} from './search.mjs';

export class ProviderError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
export function createMetrapi({key, fetchImpl = fetch, now = Date.now} = {}) {
  let nextAllowed = 0, busy = false;
  const cache = new Map();
  return async hard => {
    if (!key) throw new ProviderError('Добавьте ключ Metrapi в серверный .env.', 503);
    const params = metrapiParams(hard), cacheKey = params.toString();
    const cached = cache.get(cacheKey);
    if (cached && now() < cached.expires) return cached.value;
    if (busy || now() < nextAllowed) throw new ProviderError('Подождите несколько секунд перед следующим запросом.', 429);
    busy = true; nextAllowed = now() + 2100;
    try {
      const response = await fetchImpl(`https://api.metrapi.ru/v1/items?${params}`, {
        headers: {'X-Api-Key':key, Accept:'application/json'}, signal: AbortSignal.timeout(12000)
      });
      if (response.status === 429) {
        const body = await response.json().catch(() => ({}));
        const retry = Number(body.detail?.retry_after);
        // A daily-limit response stops attempts for a day in this process.
        nextAllowed = now() + (Number.isFinite(retry) && retry > 0 ? Math.max(2.1,retry)*1000 : 86400000);
        throw new ProviderError('Лимит Metrapi: повторите позже. Автоматических повторов нет.', 429);
      }
      if ([401,403].includes(response.status)) throw new ProviderError('Metrapi отклонил ключ или права доступа.', 503);
      if (!response.ok) throw new ProviderError('Metrapi временно недоступен. Попробуйте позже.');
      const body = await response.json();
      if (!Array.isArray(body.items)) throw new ProviderError('Неожиданный формат ответа Metrapi.');
      const value = {items:body.items, hasMore:Boolean(body.next_cursor), fetchedAt:new Date(now()).toISOString()};
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, {value, expires:now()+60000}); return value;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('Не удалось получить ответ Metrapi. Проверьте соединение и повторите позже.');
    } finally { busy = false; }
  };
}
