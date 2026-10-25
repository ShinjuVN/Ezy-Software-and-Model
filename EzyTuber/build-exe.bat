@echo off
cd /d "%~dp0"
call npm install
call npm run build
if errorlevel 1 goto :end
:: Model nam CANH file exe (khong nam trong exe): chep thu muc model sang dist
xcopy /E /I /Y "model" "dist\model" >nul
echo.
echo Xong! Trong thu muc dist co:
echo   EzyTuber.exe
echo   model\   (them/bot model o day, khong can build lai)
:end
pause
