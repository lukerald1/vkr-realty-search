import {readFile} from 'node:fs/promises';
import {parseAreaBoundaries} from '../apps/area-boundaries.mjs';
const [file,kind]=process.argv.slice(2);if(!['district','place'].includes(kind))throw Error('Expected district/place');
const body=JSON.parse(await readFile(file,'utf8'));const parsed=parseAreaBoundaries(body,{expectedDistricts:kind==='district'?18:3,kind});
console.log(JSON.stringify({validated:parsed.length,snapshotAt:body.osm3s.timestamp_osm_base}));
