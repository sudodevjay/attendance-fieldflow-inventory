@echo off
rem Installs USBPcap (USB capture driver) and Wireshark (viewer + tshark). Run as administrator.
net session >nul 2>&1 || (echo Run as administrator & exit /b 1)
cd /d "%~dp0"
echo [1/2] USBPcap...
USBPcapSetup-1.5.4.0.exe /S
echo USBPcap exit code %errorlevel%
echo [2/2] Wireshark...
Wireshark-4.6.9-x64.exe /S /desktopicon=no /quicklaunchicon=no
echo Wireshark exit code %errorlevel%
