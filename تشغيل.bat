@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -Command "$used = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port -contains 4545; if (-not $used) { exit 2 }; try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:4545/' -TimeoutSec 2; if ($response.Content -match '<title>Clubhouse mod by Darhous') { exit 0 } } catch {}; exit 1"
set "PORT_STATE=%ERRORLEVEL%"

if "%PORT_STATE%"=="0" (
  echo Clubhouse mod by Darhous is already running on http://localhost:4545
  start "" http://localhost:4545
  exit /b 0
)

if "%PORT_STATE%"=="1" (
  echo Port 4545 is being used by another program. Close it, then run this file again.
  pause
  exit /b 1
)

start "" http://localhost:4545
node server.js
pause
