@echo off
pushd "%~dp0"
set "PYTHON_EXE=%LocalAppData%\Programs\Python\Python314\python.exe"
"%PYTHON_EXE%" -u futu_market_bridge.py > futu_bridge.log 2>&1
