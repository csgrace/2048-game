@echo off
cd /d "%~dp0"
echo Starting AI Training Loop...
node scripts/auto-train-loop.js
pause
