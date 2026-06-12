@echo off
chcp 65001 >nul
title INVCRIPTO Connector Local

echo.
echo ==============================================
echo  INVCRIPTO CONNECTOR LOCAL
echo ==============================================
echo.

if not exist .env (
  echo Arquivo .env nao encontrado.
  echo Rode INSTALAR_E_EXECUTAR_CONNECTOR.bat primeiro.
  pause
  exit /b 1
)

if exist "..\node_modules\@supabase\supabase-js" (
  set "NODE_PATH=%~dp0..\node_modules"
) else if not exist "node_modules\@supabase\supabase-js" (
  echo Dependencias nao encontradas.
  echo Use o zip completo do projeto ou rode npm install na pasta principal quando sua rede permitir.
  pause
  exit /b 1
)

node src\index.js
pause
