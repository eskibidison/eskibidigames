@echo off
REM ---------------------------------------------------------------------------
REM  Fleck -- start the game.
REM
REM  You do NOT need this file any more: fleck.html works if you double-click
REM  it directly. This is here for a slightly faster load and for browsers that
REM  are strict about local files.
REM
REM  Finding Python is fussier than it looks. Windows ships a FAKE python.exe
REM  in WindowsApps that opens the Microsoft Store and exits, so `where python`
REM  succeeds and the server never starts -- which looked exactly like a broken
REM  game. Every candidate below is TESTED before it is used.
REM ---------------------------------------------------------------------------
setlocal EnableDelayedExpansion
cd /d "%~dp0"
set PORT=8765
set PY=

REM Real installs first, the PATH last.
for %%D in ("%LOCALAPPDATA%\Programs\Python\Python313"
            "%LOCALAPPDATA%\Programs\Python\Python312"
            "%LOCALAPPDATA%\Programs\Python\Python311"
            "%ProgramFiles%\Python313" "%ProgramFiles%\Python312"
            "%ProgramFiles%\Python311") do (
  if exist "%%~D\python.exe" if not defined PY set "PY=%%~D\python.exe"
)

if not defined PY (
  py -3 -c "print(1)" >nul 2>nul && set "PY=py -3"
)
if not defined PY (
  python -c "print(1)" >nul 2>nul && set "PY=python"
)

if defined PY (
  echo Starting Fleck on http://localhost:%PORT%/fleck.html
  echo Close this window to stop it.
  REM Server FIRST, browser after a moment -- opening the page before the
  REM server is listening is what produces "unable to connect".
  start "" /b cmd /c "timeout /t 2 >nul & start "" http://localhost:%PORT%/fleck.html"
  %PY% serve.py %PORT%
  goto :eof
)

echo.
echo  No working Python found -- but you do not need one.
echo  Just double-click  fleck.html  in this folder instead.
echo.
pause
