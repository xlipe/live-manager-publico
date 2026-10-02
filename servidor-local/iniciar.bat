@echo off
cd /d "%~dp0"
title Widgets da live - servidor local

set NODE=node
if exist "runtime\node.exe" set NODE=runtime\node.exe

%NODE% -v >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Node.js nao encontrado.
  echo  Coloque a versao portatil em "runtime\node.exe" ou instale o Node.js em https://nodejs.org
  echo.
  pause
  exit /b 1
)

start "" http://localhost:8787/config
%NODE% server.js
pause
