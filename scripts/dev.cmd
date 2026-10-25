@echo off
cd /d "%~dp0.."
if not exist node_modules (
  call npm ci
  if errorlevel 1 exit /b %errorlevel%
)
call npm run dev
