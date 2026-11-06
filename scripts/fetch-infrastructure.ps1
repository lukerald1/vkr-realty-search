param([string]$Proxy = '', [ValidateSet('points','school','park')][string]$Layer = 'points', [ValidateSet('vk','main')][string]$Server = 'vk')
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force 'data/infrastructure' | Out-Null
# A bounded offline snapshot. No listing or user information is sent.
$query = @'
[out:json][timeout:90];
(
nwr["leisure"~"^(park|garden|playground|fitness_centre)$"](59.65,29.4,60.25,30.85);
nwr["shop"~"^(supermarket|convenience|mall)$"](59.65,29.4,60.25,30.85);
nwr["amenity"~"^(school|kindergarten|clinic|hospital|pharmacy|university|cafe)$"](59.65,29.4,60.25,30.85);
nwr["healthcare"="clinic"](59.65,29.4,60.25,30.85);
);
out tags center;
'@
if($Layer -eq 'school'){$query='[out:json][timeout:60];way["amenity"="school"](59.65,29.4,60.25,30.85);out tags center geom;'}
if($Layer -eq 'park'){$query='[out:json][timeout:60];way["leisure"~"^(park|garden)$"](59.65,29.4,60.25,30.85);out tags center geom;'}
$filename=if($Layer -eq 'points'){'osm-spb'}else{"osm-$Layer-geometry"}
$endpoint=if($Server -eq 'vk'){'https://maps.mail.ru/osm/tools/overpass/api/interpreter'}else{'https://overpass-api.de/api/interpreter'}
[IO.File]::WriteAllText((Join-Path $PWD 'data/infrastructure/download-query.overpass'), $query, [Text.UTF8Encoding]::new($false))
$curlArgs=@('--fail','--max-time','110','--user-agent','VKR-Prostor-LocalPilot/0.6.1','--get','--data-urlencode','data@data/infrastructure/download-query.overpass',$endpoint,'--output',"data/infrastructure/$filename.download.json",'--silent','--show-error')
if($Proxy){$curlArgs=@('--proxy',$Proxy)+$curlArgs}
& curl.exe @curlArgs
if($LASTEXITCODE -ne 0){throw 'Загрузка не завершена; предыдущий снимок сохранён. Повторите позже.'}
node --input-type=module -e "import{readFileSync}from'node:fs';import{parseOsm,applyGeometryOverlay}from'./apps/infrastructure.mjs';const v=JSON.parse(readFileSync('data/infrastructure/$filename.download.json','utf8'));if(!parseOsm(v).length)throw Error('Empty snapshot');if('$Layer'!=='points'){const b=JSON.parse(readFileSync('data/infrastructure/osm-spb.json','utf8'));applyGeometryOverlay(parseOsm(b),v,{category:'$Layer',baseTimestamp:b.osm3s.timestamp_osm_base});}console.log('Snapshot validated')"
if($LASTEXITCODE -ne 0){throw 'Неполный снимок; предыдущий файл сохранён.'}
Move-Item -LiteralPath "data/infrastructure/$filename.download.json" -Destination "data/infrastructure/$filename.json" -Force
Write-Output 'Downloaded OSM snapshot. Next: npm run enrich:infrastructure'
