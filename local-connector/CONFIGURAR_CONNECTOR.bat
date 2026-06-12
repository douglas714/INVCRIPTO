@echo off
chcp 65001 >nul
title INVCRIPTO Connector - Configurar

echo.
echo ==============================================
echo  CONFIGURAR INVCRIPTO CONNECTOR LOCAL
echo ==============================================
echo.
echo Informe os mesmos dados configurados no Netlify.
echo O arquivo .env fica somente nesta maquina e nao deve ir para o GitHub.
echo.

set SUPABASE_URL=https://pxczyddzqagzijsipche.supabase.co
echo SUPABASE_URL=%SUPABASE_URL%
set /p SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY: 
set /p APP_ENCRYPTION_KEY=APP_ENCRYPTION_KEY: 

if "%SUPABASE_URL%"=="" (
  echo SUPABASE_URL obrigatorio.
  pause
  exit /b 1
)

if "%SUPABASE_SERVICE_ROLE_KEY%"=="" (
  echo SUPABASE_SERVICE_ROLE_KEY obrigatorio.
  pause
  exit /b 1
)

if "%APP_ENCRYPTION_KEY%"=="" (
  echo APP_ENCRYPTION_KEY obrigatorio.
  pause
  exit /b 1
)

(
  echo SUPABASE_URL=%SUPABASE_URL%
  echo SUPABASE_SERVICE_ROLE_KEY=%SUPABASE_SERVICE_ROLE_KEY%
  echo APP_ENCRYPTION_KEY=%APP_ENCRYPTION_KEY%
  echo CONNECTOR_NODE_KEY=pc-douglas-principal
  echo CONNECTOR_NAME=INVCRIPTO Connector Local
  echo CONNECTOR_INTERVAL_MS=5000
  echo BINANCE_SPOT_BASE_URL=https://api.binance.com
  echo BINANCE_TESTNET_BASE_URL=https://testnet.binance.vision
) > .env

echo.
echo Arquivo .env criado com sucesso.
echo As APIs da Binance devem ser salvas pelo painel do site.
echo Agora rode INSTALAR_WINDOWS.bat e depois INICIAR_CONNECTOR.bat.
echo.
pause
