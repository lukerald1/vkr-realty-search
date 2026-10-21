// Fictional fixtures for a reproducible fresh checkout. No provider data.
export const demoListings = Array.from({length: 12}, (_, i) => ({
  source: 'demo', source_id: `example-${i + 1}`, city: 'spb', locality: 'Санкт-Петербург',
  deal_type: 'sale', realty_type: 'flat', rooms: [1,2,0,3][i % 4],
  area_total: [38,64,25,81][i % 4] + i, area_kitchen: [10,15,6,18][i % 4],
  price: [8900000,14500000,6700000,19000000][i % 4] + i * 100000,
  address: `Учебный адрес, дом ${i + 1}`, district: ['Приморский','Московский','Выборгский'][i % 3],
  metro: ['Пионерская','Московская','Озерки'][i % 3], metro_minutes: 5 + i,
  metro_mode: i % 3 ? 'walk' : 'transport', floor: 2 + i, floors_total: 18,
  balcony: i % 2 ? 'Лоджия' : 'Нет', renovation: 'Косметический',
  description: 'Вымышленный объект для демонстрации интерфейса. Не является объявлением о продаже.',
  photos: [], url: null, published_at: null
}));
