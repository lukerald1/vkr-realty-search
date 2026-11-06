param([string]$Proxy='', [ValidateSet('main','vk')][string]$Server='main')
$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force 'data/infrastructure' | Out-Null
$endpoint=if($Server -eq 'main'){'https://overpass-api.de/api/interpreter'}else{'https://maps.mail.ru/osm/tools/overpass/api/interpreter'}
$layers=@(
 @{Kind='district';Name='osm-area-boundaries.full';Ids='337424,338635,338636,363103,367375,368287,369514,1114193,1114252,1114354,1114806,1114809,1114895,1114902,1114905,1115082,1115366,1115367'},
 @{Kind='place';Name='osm-place-boundaries.full';Ids='1181032,1205319,1205339'}
)
foreach($layer in $layers){
 $query='[out:json][timeout:90];rel(id:'+$layer.Ids+');out body geom;'
 [IO.File]::WriteAllText((Join-Path $PWD 'data/infrastructure/location-query.overpass'),$query,[Text.UTF8Encoding]::new($false))
 $temp='data/infrastructure/'+$layer.Name+'.download.json'
 $argsList=@('--fail','--max-time','110','--user-agent','VKR-Prostor-LocalPilot/0.7','--get','--data-urlencode','data@data/infrastructure/location-query.overpass',$endpoint,'--output',$temp,'--silent','--show-error')
 if($Proxy){$argsList=@('--proxy',$Proxy)+$argsList}
 & curl.exe @argsList
 if($LASTEXITCODE -ne 0){throw 'Сервис недоступен. Предыдущий слой сохранён; повторите позже, без частых автоматических попыток.'}
 node scripts/validate-location-data.mjs $temp $layer.Kind
 if($LASTEXITCODE -ne 0){throw 'Неполный слой. Предыдущие границы сохранены.'}
 Move-Item -LiteralPath $temp -Destination ('data/infrastructure/'+$layer.Name+'.json') -Force
}
Write-Output 'Boundaries downloaded. Next: npm run enrich:locations'
