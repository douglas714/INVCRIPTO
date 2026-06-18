@echo off
chcp 65001 >nul
setlocal EnableExtensions
title INVCRIPTO Connector V1.6 - Atualizar e Executar
cd /d "%~dp0"

echo.
echo ==========================================================
echo  INVCRIPTO CONNECTOR V1.6 - CONTA REAL RESILIENTE
echo ==========================================================
echo  Feche qualquer janela antiga do conector antes de seguir.
echo  Este atualizador encerra somente processos Node executando
echo  o arquivo src\index.js do conector INVCRIPTO.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale Node.js 20 LTS ou superior.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$self=$PID; Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" ^| Where-Object { $_.CommandLine -match 'src[\\/]index\.js' } ^| ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; Write-Host ('Conector antigo encerrado. PID ' + $_.ProcessId) } catch {} }" 2>nul

if not exist ".env" (
  echo.
  echo O .env nao foi encontrado nesta pasta.
  echo Informe a pasta do conector antigo para copiar a configuracao.
  set /p OLD_CONNECTOR_DIR=Pasta antiga: 
  if not "%OLD_CONNECTOR_DIR%"=="" if exist "%OLD_CONNECTOR_DIR%\.env" (
    copy /y "%OLD_CONNECTOR_DIR%\.env" ".env" >nul
    echo .env copiado com sucesso.
  )
)

if not exist ".env" (
  echo.
  echo Nao foi possivel localizar o .env.
  echo Execute CONFIGURAR_CONNECTOR.bat antes de iniciar.
  pause
  exit /b 1
)

findstr /b /c:"CONNECTOR_REQUEST_TIMEOUT_MS=" ".env" >nul 2>nul
if errorlevel 1 echo CONNECTOR_REQUEST_TIMEOUT_MS=12000>>".env"
findstr /b /c:"CONNECTOR_MAX_BACKOFF_MS=" ".env" >nul 2>nul
if errorlevel 1 echo CONNECTOR_MAX_BACKOFF_MS=60000>>".env"
findstr /b /c:"CONNECTOR_CREDENTIAL_SYNC_MS=" ".env" >nul 2>nul
if errorlevel 1 echo CONNECTOR_CREDENTIAL_SYNC_MS=30000>>".env"

echo.
echo Iniciando INVCRIPTO Connector V1.6...
echo A tela deve mostrar: Versao 1.6.0-real-resilient
echo A API Spot nao confirma permissao de saque; confira manualmente na Binance.
echo.
node src\index.js

echo.
echo Conector finalizado.
pause
