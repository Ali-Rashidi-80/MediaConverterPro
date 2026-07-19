@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
color 0E

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ===================================================
echo   Galaxy Media Pro — Portable EXE (default build)
echo   Single file: FFmpeg + fonts + icon embedded
echo ===================================================
echo.

if not exist "galaxy_ultimate.py" ( echo [ERROR] galaxy_ultimate.py missing & pause & exit /b 1 )
if not exist "ffmpeg.exe" ( echo [ERROR] ffmpeg.exe missing & pause & exit /b 1 )
if not exist "GalaxyConverter.portable.spec" ( echo [ERROR] spec missing & pause & exit /b 1 )

echo [1/6] Python...
python --version >nul 2>&1
if errorlevel 1 ( echo [ERROR] Python not found. & pause & exit /b 1 )
python --version
echo.

echo [2/6] Dependencies...
python -m pip install --upgrade pip -q
python -m pip install pyside6 pyinstaller pillow pillow-heif -q
if errorlevel 1 ( echo [ERROR] pip failed & pause & exit /b 1 )

echo [3/6] UPX (optional compression)...
set "UPX_DIR="
if exist "tools\upx\upx.exe" set "UPX_DIR=%ROOT%tools\upx"
if exist "C:\Program Files\upx-5.0.2-win64\upx.exe" set "UPX_DIR=C:\Program Files\upx-5.0.2-win64"
where upx >nul 2>&1
if not errorlevel 1 if not defined UPX_DIR (
    for /f "delims=" %%U in ('where upx 2^>nul') do set "UPX_DIR=%%~dpU"
    if defined UPX_DIR set "UPX_DIR=!UPX_DIR:~0,-1!"
)
if not defined UPX_DIR (
    echo UPX not found — downloading to tools\upx...
    if not exist "tools" mkdir "tools"
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "$u='https://github.com/upx/upx/releases/download/v4.2.4/upx-4.2.4-win64.zip';" ^
        "$z='%ROOT%tools\upx.zip'; $d='%ROOT%tools\upx_tmp';" ^
        "Invoke-WebRequest -Uri $u -OutFile $z -UseBasicParsing;" ^
        "Expand-Archive -Path $z -DestinationPath $d -Force;" ^
        "$exe=Get-ChildItem $d -Recurse -Filter upx.exe | Select-Object -First 1;" ^
        "New-Item -ItemType Directory -Force -Path '%ROOT%tools\upx' | Out-Null;" ^
        "Copy-Item $exe.FullName '%ROOT%tools\upx\upx.exe' -Force;" ^
        "Remove-Item $z -Force; Remove-Item $d -Recurse -Force"
    if exist "tools\upx\upx.exe" set "UPX_DIR=%ROOT%tools\upx"
)
if defined UPX_DIR ( echo UPX: !UPX_DIR! ) else ( echo [WARN] UPX unavailable — building without extra compression )

echo [4/6] Clean portable artifacts...
if exist "build\GalaxyMediaPro_Portable" rmdir /s /q "build\GalaxyMediaPro_Portable"
if exist "dist\GalaxyMediaPro_Portable.exe" del /f /q "dist\GalaxyMediaPro_Portable.exe"

echo [5/6] PyInstaller onefile...
set "UPX_ARG="
if defined UPX_DIR set "UPX_ARG=--upx-dir \"!UPX_DIR!\""

python -m PyInstaller --noconfirm --clean !UPX_ARG! GalaxyConverter.portable.spec
if errorlevel 1 ( echo [ERROR] Build failed & pause & exit /b 1 )

echo [6/6] Verify...
if not exist "dist\GalaxyMediaPro_Portable.exe" (
    echo [ERROR] dist\GalaxyMediaPro_Portable.exe not found
    pause & exit /b 1
)

for %%A in ("dist\GalaxyMediaPro_Portable.exe") do set "SZ=%%~zA"
set /a "SZMB=!SZ!/1048576"
echo.
echo ===================================================
echo   SUCCESS — Portable EXE ready
echo   File: dist\GalaxyMediaPro_Portable.exe
echo   Size: ~!SZMB! MB
echo.
echo   Copy this ONE file anywhere (USB, Desktop...)
echo   FFmpeg is embedded — no install needed.
echo   First launch may take 10-20 sec (extract cache).
echo.
echo   Onedir build: run build_onedir.bat
echo ===================================================
pause
endlocal
