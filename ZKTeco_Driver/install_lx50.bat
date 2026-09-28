@echo off
rem LX50 mini-USB setup: ZKTeco USB driver (Attendance Device, VID_1B55 PID_0A01) + zkemkeeper SDK 6.2.5.7 (32-bit).
rem Right-click -> Run as administrator.
net session >nul 2>&1 || (echo Administrator se chalayein: Right-click ^> Run as administrator & pause & exit /b 1)
cd /d "%~dp0ZKTime5.0\ZKTime5.0\ZKTecov4.8.8build157"

echo [1/2] USB driver install...
pnputil /add-driver "USBDriver\X20\ZKFP.inf" /install

echo [2/2] ZKTeco SDK register...
copy /y "files\sdk\*.dll" "%windir%\SysWOW64\" >nul
"%windir%\SysWOW64\regsvr32.exe" /s "%windir%\SysWOW64\zkemkeeper.dll" && echo SDK registered. || echo SDK register FAILED.

echo.
echo Ab device ka mini-USB cable ek baar nikaal kar dobara lagayein.
if /i not "%~1"=="nopause" pause
