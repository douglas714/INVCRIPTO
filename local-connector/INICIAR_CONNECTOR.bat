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
  echo Rode INSTALAR_WINDOWS.bat primeiro.
  pause
  exit /b 1
)

npm start
pause
