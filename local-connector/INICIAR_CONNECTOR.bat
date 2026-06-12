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

echo Conector sem dependencias externas. Nenhum npm install necessario.

node src\index.js
pause
