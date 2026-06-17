@echo off
chcp 65001 >nul
setlocal EnableExtensions
title ENVCRIPTO Executor

cd /d "%~dp0ENVCRIPTO_ARQUIVOS"

if not exist "INSTALAR_E_EXECUTAR_CONNECTOR.bat" (
  echo.
  echo Nao encontrei a pasta ENVCRIPTO_ARQUIVOS com os arquivos do conector.
  echo Extraia o ZIP completo mantendo a estrutura original.
  echo.
  pause
  exit /b 1
)

call "INSTALAR_E_EXECUTAR_CONNECTOR.bat"
