@echo off
setlocal

set "MODE=%~1"
set "PROJECT=%~2"

if /I "%MODE%"=="hosting" (
  if /I "%PROJECT%"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" -HostingOnly
  ) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" -HostingOnly -ProjectId "%PROJECT%"
  )
  goto :end
)

if /I "%MODE%"=="rules" (
  if /I "%PROJECT%"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" -RulesOnly
  ) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" -RulesOnly -ProjectId "%PROJECT%"
  )
  goto :end
)

if /I "%MODE%"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1"
  goto :end
)

if /I "%PROJECT%"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" -ProjectId "%MODE%"
  goto :end
)

echo Usage:
echo   deploy.bat                      ^(Hosting + Database rules using .firebaserc default^)
echo   deploy.bat PROJECT_ID           ^(Hosting + Database rules using explicit project^)
echo   deploy.bat hosting              ^(Hosting only using .firebaserc default^)
echo   deploy.bat hosting PROJECT_ID   ^(Hosting only using explicit project^)
echo   deploy.bat rules                ^(Database rules only using .firebaserc default^)
echo   deploy.bat rules PROJECT_ID     ^(Database rules only using explicit project^)
exit /b 1

:end
if errorlevel 1 exit /b %errorlevel%
exit /b 0
