@echo off
REM Double-clickable wrapper for launch-test.ps1 (bypasses the PS script-run policy).
REM Pass flags through, e.g.:  launch-test.cmd -Install -Deploy
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-test.ps1" %*
pause
