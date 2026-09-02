@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Your Imagination
REM Your Imagination launcher. Looks for ComfyUI_windows_portable next to this folder.
cd /d "%~dp0"

set "PYEXE="
set "PYTAG="
for /f "delims=" %%I in ('py -3.12 -c "import sys; print(sys.executable)" 2^>nul') do set "PYEXE=%%I"
if defined PYEXE set "PYTAG=3.12"
if not defined PYEXE (
  for /f "delims=" %%I in ('py -3 -c "import sys; print(sys.executable)" 2^>nul') do set "PYEXE=%%I"
)
if not defined PYEXE (
  for /f "delims=" %%I in ('python -c "import sys; print(sys.executable)" 2^>nul') do set "PYEXE=%%I"
)
if not defined PYEXE (
  echo Python not found. Install Python 3.12 from python.org, then re-run.
  pause
  exit /b 1
)

echo Using Python: %PYEXE%

set "VENV=%LOCALAPPDATA%\YourImagination\venv"
if exist "%VENV%\Scripts\python.exe" if "%PYTAG%"=="3.12" (
  "%VENV%\Scripts\python.exe" -c "import sys; raise SystemExit(0 if sys.version_info[:2]==(3,12) else 1)" 2>nul
  if errorlevel 1 (
    echo Recreating the app environment with Python 3.12...
    rmdir /s /q "%VENV%"
  )
)
if not exist "%VENV%\Scripts\python.exe" (
  echo Creating app environment in:
  echo   %VENV%
  "%PYEXE%" -m venv "%VENV%"
  if errorlevel 1 (
    echo Could not create the environment.
    pause
    exit /b 1
  )
)
set "APP_PY=%VENV%\Scripts\python.exe"

echo Installing dependencies (first run only)...
"%APP_PY%" -m pip install -q -r "%~dp0requirements.txt" --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu
if errorlevel 1 (
  echo pip install failed.
  pause
  exit /b 1
)

set "COMFY_ROOT="
if exist "%~dp0..\ComfyUI_windows_portable\python_embeded\python.exe" (
  for %%I in ("%~dp0..\ComfyUI_windows_portable") do set "COMFY_ROOT=%%~fI"
)

if exist "%COMFY_ROOT%\ComfyUI\models" (
  set "COMFY_MODELS=%COMFY_ROOT%\ComfyUI\models"
)

set "STARTED_COMFY=0"
set "COMFY_PID=0"
set "LAUNCHER_PID=0"
set "COMFY_URL=http://127.0.0.1:8188"
set "COMFY_CTL=%~dp0backend\comfy_ctl.py"
set "PIDFILE=%TEMP%\yi-cmd.pid"

call :run_ctl launcher-pid
set "LAUNCHER_PID=%CTL_OUT%"
if not defined LAUNCHER_PID set "LAUNCHER_PID=0"

echo.
curl.exe -sf -o nul -m 2 %COMFY_URL%/system_stats >nul 2>nul
if not errorlevel 1 (
  if defined COMFY_ROOT (
    call :run_ctl pid "%COMFY_ROOT%"
    set "COMFY_PID=%CTL_OUT%"
  )
  if not "!COMFY_PID!"=="0" if not "!COMFY_PID!"=="" (
    echo ComfyUI is already running ^(started by this app^).
    set "STARTED_COMFY=1"
  ) else (
    echo ComfyUI is already running.
  )
  goto start_imagine
)

if not defined COMFY_ROOT (
  echo Could not find ComfyUI_windows_portable next to this folder.
  echo Your Imagination will still open. In Settings, set the ComfyUI folder
  echo or download the official portable, then Start Comfy.
  goto start_imagine
)

echo Starting ComfyUI from:
echo   %COMFY_ROOT%
echo A ComfyUI console window will stay open. Closing Your Imagination stops it.
echo Your Imagination will open now; the pill turns green when ComfyUI finishes loading.
call :run_ctl launch "%COMFY_ROOT%"
set "COMFY_PID=%CTL_OUT%"
if "!COMFY_PID!"=="" set "COMFY_PID=0"
if "!COMFY_PID!"=="0" (
  echo Could not start ComfyUI from that folder.
  echo Your Imagination will still open. Use Settings to set the path and Start Comfy.
  goto start_imagine
)
set "STARTED_COMFY=1"

:start_imagine
"%APP_PY%" "%COMFY_CTL%" free-ui 7860 >nul 2>nul
if "%STARTED_COMFY%"=="1" if not "%LAUNCHER_PID%"=="0" if not "%COMFY_PID%"=="0" (
  set "WATCH_PY=%VENV%\Scripts\pythonw.exe"
  if not exist "!WATCH_PY!" set "WATCH_PY=%APP_PY%"
  start "yi-comfy-watch" /MIN "!WATCH_PY!" "%COMFY_CTL%" watch %LAUNCHER_PID% %COMFY_PID% "%COMFY_ROOT%"
)

set "YI_FLASK_LOOP=1"
set "YI_RESTART_MARK=%TEMP%\yi-flask-restart"
echo Starting Your Imagination at http://127.0.0.1:7860
start "" /B cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:7860"
:flask_loop
if exist "%YI_RESTART_MARK%" del /q "%YI_RESTART_MARK%" >nul 2>nul
"%APP_PY%" "%~dp0backend\server.py"
if exist "%YI_RESTART_MARK%" (
  echo Restarting Your Imagination...
  goto flask_loop
)

if "%STARTED_COMFY%"=="1" (
  echo.
  echo Stopping the ComfyUI we started...
  "%APP_PY%" "%COMFY_CTL%" stop "%COMFY_ROOT%" %COMFY_PID%
  taskkill /FI "WINDOWTITLE eq yi-comfy-watch*" /T /F >nul 2>nul
)

endlocal
pause
goto :eof

:run_ctl
set "CTL_OUT=0"
"%APP_PY%" "%COMFY_CTL%" %* > "%PIDFILE%"
if exist "%PIDFILE%" set /p CTL_OUT=<"%PIDFILE%"
if not defined CTL_OUT set "CTL_OUT=0"
goto :eof
