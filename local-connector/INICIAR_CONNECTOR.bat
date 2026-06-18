@echo off
chcp 65001 >nul
setlocal EnableExtensions
title INVCRIPTO Connector V1.6
cd /d "%~dp0"

if not exist ".env" (
  echo Arquivo .env nao encontrado.
  echo Execute ATUALIZAR_E_EXECUTAR_V1_6.bat ou CONFIGURAR_CONNECTOR.bat.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" ^| Where-Object { $_.CommandLine -match 'src[\\/]index\.js' } ^| ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }" 2>nul
node src\index.js
pause
