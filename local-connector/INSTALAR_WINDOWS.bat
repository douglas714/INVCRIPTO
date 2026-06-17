@echo off
chcp 65001 >nul
title INVCRIPTO Connector - Instalação

echo.
echo ==============================================
echo  INVCRIPTO CONNECTOR LOCAL - INSTALACAO
echo ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado.
  echo Instale o Node.js 20 LTS antes de continuar:
  echo https://nodejs.org/
  pause
  exit /b 1
)

if not exist .env (
  echo Arquivo .env nao encontrado.
  echo Vou abrir a configuracao agora.
  echo.
  call CONFIGURAR_CONNECTOR.bat
)

echo Conector sem dependencias externas. Nenhum npm install necessario.

echo.
echo Instalacao verificada.
echo Rode INSTALAR_E_EXECUTAR_CONNECTOR.bat e deixe a janela aberta.
echo.
pause
