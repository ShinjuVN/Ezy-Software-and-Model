@echo off
cd /d "%~dp0"
call npm install
call npm run build
if errorlevel 1 goto :end
echo.
echo Xong! Trong thu muc dist co EzyMaker.exe
:end
pause
