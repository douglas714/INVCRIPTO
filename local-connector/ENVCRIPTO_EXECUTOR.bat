@echo off
chcp 65001 >nul
setlocal EnableExtensions
title ENVCRIPTO Executor

cd /d "%~dp0ENVCRIPTO_ARQUIVOS"

if exist "%~dp0INVCRIPTO.ico" if not exist "%~dp0CLIQUE AQUI - ENVCRIPTO.lnk" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%~dp0CLIQUE AQUI - ENVCRIPTO.lnk'); $s.TargetPath='%~f0'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%~dp0INVCRIPTO.ico'; $s.Save()" >nul 2>nul
)

if not exist "INSTALAR_E_EXECUTAR_CONNECTOR.bat" (
  echo.
  echo Nao encontrei a pasta ENVCRIPTO_ARQUIVOS com os arquivos do conector.
  echo Extraia o ZIP completo mantendo a estrutura original.
  echo.
  pause
  exit /b 1
)

call "INSTALAR_E_EXECUTAR_CONNECTOR.bat"
