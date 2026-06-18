@echo off
chcp 65001 >nul
setlocal EnableExtensions
title INVCRIPTO Connector - Instalar e Executar

cd /d "%~dp0"

echo.
echo ==============================================
echo  INVCRIPTO CONNECTOR V1.6 - CONTA REAL
echo ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado.
  echo Instale o Node.js 20 LTS: https://nodejs.org/
  pause
  exit /b 1
)

set "SUPABASE_URL=https://pxczyddzqagzijsipche.supabase.co"

if exist ".env" (
  echo .env encontrado. Verificando configuracao salva.
  findstr /c:"COLE_A_MESMA_APP_ENCRYPTION_KEY_DO_NETLIFY" ".env" >nul 2>nul
  if not errorlevel 1 (
    echo.
    echo Falta preencher a APP_ENCRYPTION_KEY igual ao Netlify.
    set /p APP_ENCRYPTION_KEY=APP_ENCRYPTION_KEY igual ao Netlify: 
    if "%APP_ENCRYPTION_KEY%"=="" (
      echo APP_ENCRYPTION_KEY obrigatorio.
      pause
      exit /b 1
    )
    powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-Content '.env') -replace 'APP_ENCRYPTION_KEY=COLE_A_MESMA_APP_ENCRYPTION_KEY_DO_NETLIFY', ('APP_ENCRYPTION_KEY=' + $env:APP_ENCRYPTION_KEY) | Set-Content '.env' -Encoding UTF8"
  )
) else (
  echo Criando .env do conector.
  echo.
  echo SUPABASE_URL ja configurado:
  echo %SUPABASE_URL%
  echo.

  if "%SUPABASE_SERVICE_ROLE_KEY%"=="" (
    set /p SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY: 
  ) else (
    echo SUPABASE_SERVICE_ROLE_KEY carregado das variaveis do Windows.
  )

  if "%APP_ENCRYPTION_KEY%"=="" (
    set /p APP_ENCRYPTION_KEY=APP_ENCRYPTION_KEY igual ao Netlify: 
  ) else (
    echo APP_ENCRYPTION_KEY carregado das variaveis do Windows.
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
    echo CONNECTOR_REQUEST_TIMEOUT_MS=12000
    echo CONNECTOR_MAX_BACKOFF_MS=60000
    echo CONNECTOR_CREDENTIAL_SYNC_MS=30000
  ) > ".env"

  echo.
  echo .env criado. As APIs Binance continuam sendo salvas pelo painel do site.
)

echo Conector V1.6 sem dependencias externas. Nenhum npm install necessario.

powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" ^| Where-Object { $_.CommandLine -match 'src[\\/]index\.js' } ^| ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }" 2^>nul

echo.
echo Iniciando conector local V1.6...
echo A tela deve mostrar Versao 1.6.0-real-resilient.
echo Deixe esta janela aberta para atualizar saldo e executar comandos Binance.
echo.
node src\index.js

echo.
echo Conector finalizado.
pause
