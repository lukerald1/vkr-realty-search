import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createExtractor,createOllama,schemaVersion,promptVersion} from '../apps/extractor.mjs';
import path from 'node:path';
const mode=process.env.EXTRACTOR_MODE||'rules',model=process.env.OLLAMA_MODEL||null;
const extractor=createExtractor({mode,model,...(mode==='ollama'?{extract:createOllama({model,baseUrl:process.env.OLLAMA_URL||'http://127.0.0.1:11434',...(process.env.OLLAMA_THINK===undefined?{}:{thinking:process.env.OLLAMA_THINK==='1'})})}:{})});
const input=process.argv[2]||'tests/extraction-cases.json';
const cases=JSON.parse(await readFile(input,'utf8'));
const results=[];
for(const item of cases){
  const started=performance.now();
  try{
    const p=await extractor({query:item.query,session:'synthetic-evaluation'});
    const failures=Object.entries(item.hard).filter(([k,v])=>p.hard[k]!==v).map(([k,v])=>`${k}: expected ${v}, actual ${p.hard[k]}`);
    const expectedHard={city:'spb',deal_type:'sale',realty_type:'flat',...item.hard};
    for(const [key,value] of Object.entries(p.hard))if(!Object.hasOwn(expectedHard,key)||expectedHard[key]!==value)failures.push(`unexpected constraint ${key}=${value}`);
    if(item.soft?.some(k=>!p.soft.includes(k)))failures.push('missing soft preference');
    if(item.unknown&&!p.unknown.length)failures.push('missing unsupported condition');
    if(p.outsideScope!==Boolean(item.outsideScope))failures.push('incorrect scope');
    if(Boolean(p.needsClarification)!==Boolean(item.needsClarification))failures.push('incorrect clarification status');
    results.push({id:item.id,query:item.query,passed:failures.length===0,failures,elapsedMs:Math.round(performance.now()-started),profile:p});
  }catch(error){results.push({id:item.id,passed:false,error:error.message,elapsedMs:Math.round(performance.now()-started)});}
  console.log(`${results.at(-1).passed?'PASS':'FAIL'} ${item.id} (${results.at(-1).elapsedMs} ms)`);
}
const report={createdAt:new Date().toISOString(),mode,model,schemaVersion,promptVersion,dataset:path.basename(input),
  limitation:'Small development smoke set; checks expected hard constraints and rejects additional ones, not complete semantic correctness or conversion.',
  passed:results.filter(r=>r.passed).length,total:results.length,results};
await mkdir('artifacts/evaluation',{recursive:true});
const output=`artifacts/evaluation/${mode}-${(model||'baseline').replace(/[^a-zA-Z0-9.-]/g,'-')}-${path.basename(input,'.json')}.json`;await writeFile(output,JSON.stringify(report,null,2));
console.log(`${report.passed}/${report.total}; ${output}`);
if(report.passed!==report.total)process.exitCode=1;
