@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
color 0B

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ===================================================
echo   Galaxy Media Pro — Build System
echo   Bundle: EXE + FFmpeg + Icon (onedir)
echo ===================================================
echo.

echo [1/7] Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found.
    pause & exit /b 1
)
python --version
echo.

echo [2/7] Dependencies...
python -m pip install --upgrade pip -q
python -m pip install pyside6 pyinstaller pillow pillow-heif -q
if errorlevel 1 ( echo [ERROR] pip failed. & pause & exit /b 1 )
echo OK
echo.

echo [3/7] Required files...
set "ERR=0"
if not exist "galaxy_ultimate.py" ( echo [ERROR] galaxy_ultimate.py missing & set "ERR=1" )
if not exist "GalaxyConverter.spec" ( echo [ERROR] GalaxyConverter.spec missing & set "ERR=1" )
if not exist "ffmpeg.exe" ( echo [ERROR] ffmpeg.exe missing — place it in project root & set "ERR=1" )
if not exist "icon.ico" ( echo [WARN] icon.ico missing )
if "%ERR%"=="1" ( pause & exit /b 1 )
echo ffmpeg.exe OK
echo.

echo [4/7] Clean old build...
if exist "build" rmdir /s /q "build"
if exist "dist" rmdir /s /q "dist"
echo.

echo [5/7] PyInstaller onedir build (bundled tools)...
python -m PyInstaller --noconfirm --clean GalaxyConverter.spec
if errorlevel 1 ( echo [ERROR] Build failed. & pause & exit /b 1 )
echo.

echo [6/7] Release package...
set "SRC=%ROOT%dist\GalaxyConverter"
set "REL=%ROOT%dist\GalaxyConverter_Release"
if not exist "%SRC%\GalaxyConverter.exe" (
    echo [ERROR] GalaxyConverter.exe not found in dist
    pause & exit /b 1
)
if exist "%REL%" rmdir /s /q "%REL%"
mkdir "%REL%"
xcopy /E /I /Y "%SRC%\*" "%REL%\" >nul

echo Galaxy Media Pro > "%REL%\README.txt"
echo. >> "%REL%\README.txt"
echo Run: GalaxyConverter.exe >> "%REL%\README.txt"
echo Bundled: _internal\ffmpeg.exe >> "%REL%\README.txt"
echo Output: Desktop\GalaxyOutput >> "%REL%\README.txt"
echo. >> "%REL%\README.txt"
echo Do NOT delete the _internal folder. >> "%REL%\README.txt"

(
echo @echo off
echo cd /d "%%~dp0"
echo start "" "%%~dp0GalaxyConverter.exe"
) > "%REL%\Run_GalaxyConverter.bat"

echo.

echo [7/7] Verify bundle...
if exist "%REL%\_internal\ffmpeg.exe" (
    echo [OK] ffmpeg.exe bundled in _internal
) else if exist "%REL%\ffmpeg.exe" (
    echo [OK] ffmpeg.exe bundled
) else (
    echo [WARN] ffmpeg NOT found in release
)
if exist "%REL%\GalaxyConverter.exe" echo [OK] GalaxyConverter.exe
echo.
echo DONE
echo   Folder: dist\GalaxyConverter\
echo   Release: dist\GalaxyConverter_Release\
echo   Zip the Release folder for distribution.
echo ===================================================
pause
endlocal
