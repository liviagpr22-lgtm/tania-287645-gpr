@echo off
cd /d "%~dp0"
netstat -ano | findstr /R ":8080 .*LISTENING" >nul
if errorlevel 1 (
  start "Servidor Tania Brief" /min node server.js
  timeout /t 3 /nobreak >nul
)
start "" http://localhost:8080