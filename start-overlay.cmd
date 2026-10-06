@echo off
rem Draws the build page's next steps on top of the game. Start start-live.cmd first.
rem It runs hidden: the tray icon (or Ctrl+Alt+O) switches list, badge and off, and has Exit.
rem The game has to be borderless or windowed. Options, such as -Corner BottomLeft or -Scale 1.2,
rem can be added after the file name; see the top of tools\overlay.ps1.
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0tools\overlay.ps1" %*
