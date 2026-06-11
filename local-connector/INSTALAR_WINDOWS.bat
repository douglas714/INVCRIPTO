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
  copy .env.example .env >nul
  echo Arquivo .env criado.
  echo.
  echo Abra o arquivo .env e preencha SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e APP_ENCRYPTION_KEY.
  echo Depois rode INICIAR_CONNECTOR.bat
  echo.
)

echo Instalando dependencias...
npm install

echo.
echo Instalacao finalizada.
echo Configure o .env e rode INICIAR_CONNECTOR.bat
echo.
pause
