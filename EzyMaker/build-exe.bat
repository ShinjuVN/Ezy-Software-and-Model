@echo off
cd /d "%~dp0"
call npm install
call npm run build
if errorlevel 1 goto :end
:: prompt.txt de canh exe de co the tu sua
copy /Y "prompt.txt" "dist\prompt.txt" >nul
echo.
echo Xong! Trong thu muc dist co EzyMaker.exe va prompt.txt
:end
pause
