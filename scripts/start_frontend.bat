@echo off
REM DeepTutor Frontend Startup Script
REM Starts the Vue 3 Vite development server

REM Move to the project root (this script lives in scripts/)
cd /d "%~dp0.."
echo Starting DeepTutor Frontend...
echo Frontend will be available at: http://localhost:3782
echo Press Ctrl+C to stop the server.
cd web-vue3
npm run dev -- --port 3782
pause
