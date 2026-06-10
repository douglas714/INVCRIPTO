@echo off
setlocal enabledelayedexpansion

echo ===============================================
echo  INVCRIPTO IA - SUBIR PARA GITHUB/NETLIFY
echo ===============================================

set "REPO_URL=https://github.com/douglas714/INVCRIPTO.git"
set "LOCAL_DIR=C:\Users\douglas.tabella\Downloads\Douglas extensao\INV CRIPTO\INV_CRIPTO_IA"

cd /d "%LOCAL_DIR%"
if errorlevel 1 (
  echo ERRO: Nao consegui acessar a pasta local:
  echo %LOCAL_DIR%
  pause
  exit /b 1
)

if not exist ".git" (
  echo Inicializando repositorio Git...
  git init
  git remote add origin "%REPO_URL%"
) else (
  git remote set-url origin "%REPO_URL%"
)

echo Conferindo status...
git status

echo Adicionando arquivos...
git add .

echo Criando commit...
git commit -m "fix: corrigir grafico Binance e adicionar saldo ENV" || echo Nada novo para commitar.

echo Enviando para GitHub...
git branch -M main
git push -u origin main

if errorlevel 1 (
  echo.
  echo ERRO ao enviar. Verifique login do GitHub, permissao do repositorio ou token.
  pause
  exit /b 1
)

echo.
echo Concluido. O Netlify deve iniciar o deploy automatico.
pause
