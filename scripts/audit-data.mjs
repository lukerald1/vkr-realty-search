import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
const fields = ['price','rooms','area_total','area_kitchen','metro_minutes','metro_mode','description','photos','group_id'];
const reports = [];
for (const file of process.argv.slice(2)) {
  const report={file,records:0,invalid:0,cities:{},localities:{},regions:{},deals:{},types:{},sources:{},missing:Object.fromEntries(fields.map(k=>[k,0])),dated:{}};
  const count=(object,key)=>{key=String(key??'null');object[key]=(object[key]||0)+1;};
  const ids=new Set();
  for await (const line of createInterface({input:createReadStream(file,{encoding:'utf8'}),crlfDelay:Infinity})) {
    if(!line.trim())continue;
    let item;try{item=JSON.parse(line.replace(/^\uFEFF/,''));}catch{report.invalid++;continue;}
    report.records++;
    for(const [target,key] of [['cities','city'],['localities','locality'],['regions','region'],['deals','deal_type'],['types','realty_type'],['sources','source']])count(report[target],item[key]);
    for(const field of fields)if(item[field]===null||item[field]===undefined||item[field]===''||(Array.isArray(item[field])&&!item[field].length))report.missing[field]++;
    count(report.dated,String(item.updated_at||item.last_seen||'unknown').slice(0,10));
    ids.add(item.group_id?`g:${item.group_id}`:`${item.source}:${item.source_id}`);
  }
  report.uniqueGroups=ids.size;
  report.localities=Object.fromEntries(Object.entries(report.localities).sort((a,b)=>b[1]-a[1]).slice(0,15));
  report.dated=Object.fromEntries(Object.entries(report.dated).sort().slice(-8));
  reports.push(report);
}
console.log(JSON.stringify(reports,null,2));
