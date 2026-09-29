@echo off
setlocal
pushd "%~dp0"
start "NOVA Futu Bridge" /min cmd /c ""%~dp0启动富途行情桥接.cmd""
node --use-system-ca -e "process.exit(0)" >nul 2>&1
if errorlevel 1 (
  echo Current Node does not support --use-system-ca; starting with the default certificate store.
  start "NOVA Finance Server" /min node server.cjs
) else (
  start "NOVA Finance Server" /min node --use-system-ca server.cjs
)
timeout /t 1 /nobreak >nul
start "NOVA Finance" "http://127.0.0.1:4183/"
