@echo off
chcp 65001 >nul
setlocal EnableExtensions
title INVCRIPTO Connector - Instalar e Executar

cd /d "%~dp0"

echo.
echo ==============================================
echo  INVCRIPTO CONNECTOR LOCAL - AUTO START
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
  ) > ".env"

  echo.
  echo .env criado. As APIs Binance continuam sendo salvas pelo painel do site.
)

if not exist "node_modules" (
  echo.
  echo Instalando dependencias...
  call npm install
  if errorlevel 1 (
    echo Falha ao instalar dependencias.
    pause
    exit /b 1
  )
) else (
  echo Dependencias ja instaladas.
)

echo.
echo Iniciando conector local...
echo Deixe esta janela aberta para atualizar saldo e executar comandos Binance.
echo.
call npm start

echo.
echo Conector finalizado.
pause
