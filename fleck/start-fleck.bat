@echo off
REM ---------------------------------------------------------------------------
REM  Fleck -- start the game.
REM
REM  Double-click this file. It serves this folder on http://localhost:8765 and
REM  opens the game in your browser. Close the black window to stop it.
REM
REM  WHY A SERVER AT ALL: the sprites are ~1000 separate PNG files now instead
REM  of one 18MB page. A browser opening a file directly (file://) refuses to
REM  fetch them, so the game needs something serving the folder. Nothing is
REM  uploaded anywhere -- "localhost" is this computer only, and it works with
REM  the wifi off.
REM
REM  PORTABLE: this needs Python OR Node, whichever the machine has. Most
REM  Windows machines have neither out of the box; if both are missing the
REM  script says so and tells you the one thing to install.
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"
set PORT=8765

where python >nul 2>nul && (
  echo Starting Fleck with Python on http://localhost:%PORT%/fleck.html
  start "" http://localhost:%PORT%/fleck.html
  python serve.py %PORT%
  goto :eof
)
where py >nul 2>nul && (
  echo Starting Fleck with Python on http://localhost:%PORT%/fleck.html
  start "" http://localhost:%PORT%/fleck.html
  py serve.py %PORT%
  goto :eof
)
where npx >nul 2>nul && (
  echo Starting Fleck with Node on http://localhost:%PORT%/fleck.html
  start "" http://localhost:%PORT%/fleck.html
  npx --yes serve -l %PORT% .
  goto :eof
)

echo.
echo  Could not find Python or Node on this computer.
echo.
echo  Install Python from https://www.python.org/downloads/  -- tick
echo  "Add python.exe to PATH" on the first screen -- then run this again.
echo.
pause
