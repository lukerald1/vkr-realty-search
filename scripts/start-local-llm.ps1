$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$ollamaExe = Join-Path $projectRoot 'artifacts\runtime\ollama\ollama.exe'
if (-not (Test-Path -LiteralPath $ollamaExe)) {
    $installedOllama = Get-Command ollama -ErrorAction SilentlyContinue
    if (-not $installedOllama) { throw 'Ollama not found. See docs/local-llm.md.' }
    $ollamaExe = $installedOllama.Source
}
$modelName = if ($env:OLLAMA_MODEL) { $env:OLLAMA_MODEL } else { 'qwen3:8b' }
if ($modelName -match 'cloud') { throw 'Cloud models are disabled for this launcher.' }
$nodeExe = (Get-Command node -ErrorAction Stop).Source
$ownedService = $null
$savedEnv = @{}
foreach ($key in @('OLLAMA_MODELS','OLLAMA_HOST','OLLAMA_NO_CLOUD','EXTRACTOR_MODE','OLLAMA_MODEL','OLLAMA_URL')) {
    $savedEnv[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
}
try {
    $env:OLLAMA_HOST = '127.0.0.1:11434'
    $env:OLLAMA_NO_CLOUD = '1'
    $env:OLLAMA_MODELS = Join-Path $projectRoot 'artifacts\runtime\models'
    $env:OLLAMA_MODEL = $modelName
    $env:OLLAMA_URL = 'http://127.0.0.1:11434'
    $env:EXTRACTOR_MODE = 'ollama'
    try { $null = Invoke-RestMethod "$env:OLLAMA_URL/api/tags" -TimeoutSec 2 }
    catch {
        $ownedService = Start-Process -FilePath $ollamaExe -ArgumentList 'serve' -WindowStyle Hidden -PassThru
        $ready = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Milliseconds 500
            try { $null = Invoke-RestMethod "$env:OLLAMA_URL/api/tags" -TimeoutSec 2; $ready = $true; break } catch {}
        }
        if (-not $ready) { throw 'Ollama did not start. Check port 11434.' }
    }
    $models = Invoke-RestMethod "$env:OLLAMA_URL/api/tags" -TimeoutSec 5
    if ($modelName -notin @($models.models.name)) {
        Write-Host "Downloading local model $modelName. This may take several minutes."
        & $ollamaExe pull $modelName
        if ($LASTEXITCODE -ne 0) { throw 'Model download failed. Retry this launcher later.' }
    }
    Write-Host "Loading $modelName into memory. The first load may take a minute."
    $warmupBody = @{model=$modelName;prompt='Reply OK';stream=$false;keep_alive='15m';options=@{num_ctx=4096;num_predict=1}}
    if ($modelName -like 'qwen3:*') { $warmupBody['think'] = $false }
    $warmup = $warmupBody | ConvertTo-Json -Depth 4
    $null = Invoke-RestMethod "$env:OLLAMA_URL/api/generate" -Method Post -ContentType 'application/json' -Body $warmup -TimeoutSec 120
    Write-Host "Local LLM: $modelName. Open the URL printed below. Ctrl+C stops the site."
    & $nodeExe --env-file-if-exists=.env apps/server.mjs
} finally {
    if ($ownedService -and -not $ownedService.HasExited) { Stop-Process -Id $ownedService.Id -ErrorAction SilentlyContinue }
    foreach ($key in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($key, $savedEnv[$key], 'Process') }
}
