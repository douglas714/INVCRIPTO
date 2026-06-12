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

if exist "..\node_modules\@supabase\supabase-js" (
  echo Dependencias encontradas no projeto principal.
) else if exist "node_modules\@supabase\supabase-js" (
  echo Dependencias encontradas no conector.
) else (
  echo.
  echo Dependencias nao encontradas.
  echo Para evitar erro de certificado, este instalador NAO baixa pacotes automaticamente.
  echo Use o zip completo do projeto ou rode npm install apenas na pasta principal quando sua rede permitir.
  pause
  exit /b 1
)

echo.
echo Instalacao verificada.
echo Rode INSTALAR_E_EXECUTAR_CONNECTOR.bat e deixe a janela aberta.
echo.
pause
