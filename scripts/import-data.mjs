import {createReadStream,existsSync} from 'node:fs';
import {mkdir,stat,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openCatalog,columns,listingValues} from '../apps/catalog.mjs';
import {spbScope} from '../apps/geography.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=process.argv.slice(2).length?process.argv.slice(2):['backup 06.10/spb_sale.jsonl','backup 06.10/spb_rent.jsonl'];
for(const file of files)if(!existsSync(path.resolve(root,file)))throw new Error(`Файл не найден: ${file}`);
await mkdir(path.join(root,'data'),{recursive:true});
const catalog=openCatalog(path.resolve(root,process.env.CATALOG_PATH||'data/catalog.sqlite'));
catalog.db.exec(`CREATE TEMP TABLE import_stage (${columns}); BEGIN IMMEDIATE;`);
const insert=catalog.db.prepare(`INSERT OR IGNORE INTO import_stage VALUES (${Array(13).fill('?').join(',')})`);
const report={importedAt:new Date().toISOString(),scope:'Санкт-Петербург (субъект РФ), без Ленинградской области',files:[],totalRead:0,accepted:0,duplicates:0,invalid:0,outside:0,unverified:0,unsupported:0,byDeal:{},bySource:{}};
try {
  for(const file of files){
    const entry={file:path.basename(file),bytes:(await stat(path.resolve(root,file))).size,records:0,invalidLines:[]};
    let lineNo=0;
    for await(const line of createInterface({input:createReadStream(path.resolve(root,file),{encoding:'utf8'}),crlfDelay:Infinity})){
      lineNo++;if(!line.trim())continue;report.totalRead++;
      let raw;try{raw=JSON.parse(line.replace(/^\uFEFF/,''));}catch{report.invalid++;entry.invalidLines.push(lineNo);continue;}
      entry.records++;
      const scope=spbScope(raw);
      if(scope!=='accepted'){report[scope]++;continue;}
      if(!['sale','rent'].includes(raw.deal_type)||raw.realty_type!=='flat'){report.unsupported++;continue;}
      const result=insert.run(...listingValues(raw));
      if(!result.changes){report.duplicates++;continue;}
      report.accepted++;report.byDeal[raw.deal_type]=(report.byDeal[raw.deal_type]||0)+1;report.bySource[raw.source]=(report.bySource[raw.source]||0)+1;
    }
    report.files.push(entry);
  }
  if(!report.accepted)throw new Error('Не найдено подходящих записей; существующий каталог сохранён.');
  catalog.db.exec('DELETE FROM listings; INSERT INTO listings SELECT * FROM import_stage;');
  catalog.db.prepare('INSERT OR REPLACE INTO catalog_meta VALUES (?,?)').run('import',JSON.stringify(report));
  catalog.db.exec('COMMIT; PRAGMA optimize;');
  await writeFile(path.join(root,'data','import-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,files:report.files.map(({invalidLines,...file})=>({...file,invalidLines:invalidLines.length}))},null,2));
}catch(error){try{catalog.db.exec('ROLLBACK');}catch{}throw error;}finally{catalog.close();}
