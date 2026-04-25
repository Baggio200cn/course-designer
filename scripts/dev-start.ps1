$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Zhaol\Desktop\course-designer'
$esbuild = Join-Path $root 'node_modules\@esbuild\win32-x64\esbuild.exe'
$viteCli = Join-Path $root 'node_modules\vite\bin\vite.js'
$electron = Join-Path $root 'node_modules\.store\electron@28.3.3\node_modules\electron\dist\electron.exe'
$main = Join-Path $root 'src\main\index.js'

if (-not (Test-Path $esbuild)) { Write-Host "esbuild not found: $esbuild" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $viteCli)) { Write-Host "vite cli not found: $viteCli" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $electron)) { Write-Host "electron not found: $electron" -ForegroundColor Red; exit 1 }

# Stop stale processes
Get-Process | Where-Object { $_.ProcessName -match 'node|electron|npm|npx' } | Stop-Process -Force -ErrorAction SilentlyContinue

# Start Vite in visible terminal
Start-Process -FilePath 'powershell.exe' -ArgumentList @(
  '-NoExit',
  '-Command',
  "Set-Location '$root'; `$env:ESBUILD_BINARY_PATH='$esbuild'; node '$viteCli'"
)

Start-Sleep -Seconds 4

# Launch Electron
$env:NODE_ENV = 'development'
$env:VITE_DEV_SERVER_URL = 'http://localhost:5173'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath $electron -ArgumentList @($main) -WorkingDirectory $root

Write-Host 'Dev startup script executed.' -ForegroundColor Green
