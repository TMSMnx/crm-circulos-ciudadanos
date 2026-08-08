# ================================================================
#  bump-version.ps1
#  Uso: .\bump-version.ps1 -Nueva 15.1 -Desc "Descripción del cambio"
#
#  Actualiza en UN SOLO COMANDO:
#    1. APP_VERSION en config.js          (fuente de verdad)
#    2. Entrada nueva en CHANGELOG        (en config.js)
#    3. Todos los ?v= en index.html       (cache-busting de archivos)
#    4. Placeholder <span id="app-version"> en index.html
#    5. Fallback hardcodeado en api-service.js
# ================================================================
param(
    [Parameter(Mandatory=$true)]
    [string]$Nueva,

    [Parameter(Mandatory=$true)]
    [string]$Desc
)

$baseDir       = $PSScriptRoot
$configJs      = Join-Path $baseDir 'js\config.js'
$indexHtml     = Join-Path $baseDir 'index.html'
$apiServiceJs  = Join-Path $baseDir 'js\api-service.js'
$hoy           = (Get-Date -Format 'yyyy-MM-dd')

# ── 1. Leer versión actual de config.js ─────────────────────────
$configText = [System.IO.File]::ReadAllText($configJs, [System.Text.Encoding]::UTF8)
if ($configText -notmatch "APP_VERSION = '([\d.]+)'") {
    Write-Host "ERROR: No se encontro APP_VERSION en config.js" -ForegroundColor Red
    exit 1
}
$anterior = $matches[1]

if ($anterior -eq $Nueva) {
    Write-Host "AVISO: La version ya es $Nueva. Sin cambios." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "  Bumping  $anterior  →  $Nueva" -ForegroundColor Cyan
Write-Host ""

# ── 2. config.js: APP_VERSION + nueva entrada en CHANGELOG ──────
$configText = $configText -replace "APP_VERSION = '$anterior'", "APP_VERSION = '$Nueva'"
$nuevaEntrada = "    { v: '$Nueva', fecha: '$hoy', desc: '$Desc' },"
$configText = $configText -replace "(window\.CRM\.CHANGELOG = \[)", "`$1`n$nuevaEntrada"
[System.IO.File]::WriteAllText($configJs, $configText, (New-Object System.Text.UTF8Encoding $false))
Write-Host "  ✅ config.js  →  APP_VERSION = '$Nueva'  +  changelog entry" -ForegroundColor Green

# ── 3. index.html: todos los ?v= ────────────────────────────────
$htmlText = [System.IO.File]::ReadAllText($indexHtml, [System.Text.Encoding]::UTF8)
$htmlText = $htmlText -replace '\?v=[\d.]+', "?v=$Nueva"

# ── 4. index.html: placeholder del login ────────────────────────
$htmlText = $htmlText -replace '(<span id="app-version">)[\d.]+(<\/span>)', "`${1}$Nueva`$2"
[System.IO.File]::WriteAllText($indexHtml, $htmlText, (New-Object System.Text.UTF8Encoding $false))
Write-Host "  ✅ index.html →  ?v=$Nueva  +  <span id=app-version>$Nueva</span>" -ForegroundColor Green

# ── 5. api-service.js: fallback hardcodeado ─────────────────────
$apiText = [System.IO.File]::ReadAllText($apiServiceJs, [System.Text.Encoding]::UTF8)
$apiText = $apiText -replace "(APP_VERSION \|\| ')[\d.]+(')","`${1}$Nueva`$2"
[System.IO.File]::WriteAllText($apiServiceJs, $apiText, (New-Object System.Text.UTF8Encoding $false))
Write-Host "  ✅ api-service.js  →  fallback '$Nueva'" -ForegroundColor Green

# ── Resumen ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Listo. Versión $Nueva aplicada en 3 archivos." -ForegroundColor Green
Write-Host ""
Write-Host "  Archivos a subir al servidor:" -ForegroundColor Yellow
Write-Host "    - js/config.js"
Write-Host "    - js/api-service.js"
Write-Host "    - index.html"
Write-Host "    - (+ los archivos JS/CSS que modificaste en esta sesión)"
Write-Host ""
Write-Host "  Después: Clear Cache en cPanel / reload NGINX." -ForegroundColor Yellow
Write-Host ""
