@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
color 0B

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ===================================================
echo   Galaxy Media Pro — Onedir Build (folder release)
echo ===================================================
echo.

python --version >nul 2>&1
if errorlevel 1 ( echo [ERROR] Python not found. & pause & exit /b 1 )

echo [1/6] Dependencies...
python -m pip install --upgrade pip -q
python -m pip install pyside6 pyinstaller pillow pillow-heif -q
if errorlevel 1 ( echo [ERROR] pip failed. & pause & exit /b 1 )

echo [2/6] Required files...
if not exist "galaxy_ultimate.py" ( echo [ERROR] galaxy_ultimate.py missing & pause & exit /b 1 )
if not exist "GalaxyConverter.spec" ( echo [ERROR] GalaxyConverter.spec missing & pause & exit /b 1 )
if not exist "ffmpeg.exe" ( echo [ERROR] ffmpeg.exe missing & pause & exit /b 1 )

echo [3/6] Clean onedir artifacts...
if exist "build\GalaxyConverter" rmdir /s /q "build\GalaxyConverter"
if exist "build\GalaxyMediaPro" rmdir /s /q "build\GalaxyMediaPro"
if exist "dist\GalaxyMediaPro" rmdir /s /q "dist\GalaxyMediaPro"
if exist "dist\GalaxyMediaPro_Release" rmdir /s /q "dist\GalaxyMediaPro_Release"

echo [4/6] PyInstaller onedir...
python -m PyInstaller --noconfirm --clean GalaxyConverter.spec
if errorlevel 1 ( echo [ERROR] Build failed. & pause & exit /b 1 )

echo [5/6] Release package...
set "SRC=%ROOT%dist\GalaxyMediaPro"
set "REL=%ROOT%dist\GalaxyMediaPro_Release"
if not exist "%SRC%\GalaxyMediaPro.exe" (
    echo [ERROR] GalaxyMediaPro.exe not found in dist\GalaxyMediaPro
    pause & exit /b 1
)
if exist "%REL%" rmdir /s /q "%REL%"
xcopy /E /I /Y "%SRC%" "%REL%\" >nul

echo [6/6] Verify...
if exist "%REL%\_internal\ffmpeg.exe" ( echo [OK] ffmpeg in _internal ) else ( echo [WARN] ffmpeg missing )
if exist "%REL%\GalaxyMediaPro.exe" echo [OK] GalaxyMediaPro.exe
echo.
echo DONE: dist\GalaxyMediaPro_Release\
pause
endlocal
