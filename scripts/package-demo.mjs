// Explicit allowlist: no .env, activity history or raw Metrapi exports.
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {openCatalog,listingValues} from '../apps/catalog.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const target=path.join(root,'artifacts','prostor-mvp');
await mkdir(path.join(target,'apps','public'),{recursive:true});
await mkdir(path.join(target,'data'),{recursive:true});
for(const relative of ['package.json','start.cmd','apps/server.mjs','apps/search.mjs','apps/catalog.mjs','apps/activity.mjs','apps/geography.mjs','apps/metrapi.mjs','apps/demo.mjs','apps/public/index.html','apps/public/styles.css','apps/public/air.css','apps/public/app.js','apps/public/building.svg','apps/public/hero.png'])
  await copyFile(path.join(root,relative),path.join(target,relative));
const source=openCatalog(path.join(root,'data','catalog.sqlite'));
const dest=openCatalog(path.join(target,'data','catalog.sqlite'));
try {
  const rows=['sale','rent'].flatMap(deal=>source.db.prepare("SELECT payload FROM listings WHERE deal_type=? AND rooms=1 AND price IS NOT NULL ORDER BY price,id LIMIT 60").all(deal));
  const insert=dest.db.prepare(`INSERT OR REPLACE INTO listings VALUES (${Array(13).fill('?').join(',')})`);
  dest.db.exec('BEGIN');
  try {
    dest.db.exec('DELETE FROM listings');
    const byDeal={sale:0,rent:0};
    for(const row of rows){const item=JSON.parse(row.payload);byDeal[item.deal_type]++;
      // Drop free text entirely to avoid exporting contact details embedded by sellers.
      item.description='Описание исключено из переносной учебной выборки. Объект из исторического снимка Metrapi.';
      const values=listingValues(item);values[0]=item.id;const payload=JSON.parse(values[12]);payload.id=item.id;values[12]=JSON.stringify(payload);
      insert.run(...values);
    }
    dest.db.prepare('INSERT OR REPLACE INTO catalog_meta VALUES (?,?)').run('import',JSON.stringify({accepted:rows.length,byDeal,importedAt:new Date().toISOString(),portableDemo:true}));
    dest.db.exec('COMMIT');
  }catch(error){dest.db.exec('ROLLBACK');throw error;}
  console.log(`Portable demo: ${rows.length} historical offers, ${target}`);
}finally{source.close();dest.close();}
await writeFile(path.join(target,'README.md'),`# Простор — MVP для демонстрации\n\nНужен Node.js 24+. Запуск: двойной щелчок start.cmd или npm start. Затем http://127.0.0.1:3100.\n\nВ комплекте 120 реальных исторических предложений (по 60 покупка/аренда, однокомнатные), выбранных по возрастанию цены для воспроизводимости. Это ограниченная учебная выборка, не обзор рынка. Актуальность не проверена, описания продавцов исключены. Фотографии загружаются с исходных CDN и требуют интернета; при ошибке есть иллюстрация. Цены и характеристики не выдуманы.\n\nРаботают поиск по фразе (правила, LLM ещё нет), обычные фильтры, карточка, избранное, сортировка. API-ключи и платные запросы не нужны. Большая обложка — AI-иллюстрация, не реальное объявление. После запуска локально создаётся журнал поисков и действий. Перед дальнейшей пересылкой не включать созданный activity.sqlite.\n\nПримеры: «Однушка до 15 млн рядом с метро», «Снять однокомнатную до 60 тыс», «Однушка до 1 руб» (пустая выдача).\n`,'utf8');
