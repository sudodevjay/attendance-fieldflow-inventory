@echo off
%SystemRoot%\System32\rundll32.exe SETUPAPI.DLL,InstallHinfSection DefaultInstall 132 .\android_winusb.inf
@echo on