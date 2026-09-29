@echo off
setlocal
pushd "%~dp0"
set "PYTHON_EXE="
set "PYTHONPATH=%~dp0.futu-sdk;%PYTHONPATH%"
set "APPDATA=%~dp0.futu-runtime"
for %%P in ("%LocalAppData%\Programs\Python\Python314\python.exe" "%LocalAppData%\Programs\Python\Python313\python.exe" "%LocalAppData%\Programs\Python\Python312\python.exe" "%LocalAppData%\Programs\Python\Python311\python.exe") do if not defined PYTHON_EXE if exist "%%~P" set "PYTHON_EXE=%%~P"
if not defined PYTHON_EXE for /f "delims=" %%P in ('where python 2^>nul') do if not defined PYTHON_EXE set "PYTHON_EXE=%%P"
if not defined PYTHON_EXE if exist "%UserProfile%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" set "PYTHON_EXE=%UserProfile%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
echo Starting NOVA full Futu bridge on 127.0.0.1:6189...
echo Python: %PYTHON_EXE%
if not exist "%PYTHON_EXE%" (
  echo Python not found. Install Python 3.11+ and run: python -m pip install -r requirements.txt
  pause
  exit /b 1
)
"%PYTHON_EXE%" -u futu_market_bridge.py
echo.
echo The Futu bridge exited. Copy the error above and send it here.
pause
