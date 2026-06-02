# Run Galaxy Converter QA gate locally (Windows)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host "== Bootstrap FFmpeg (if missing) ==" -ForegroundColor Cyan
python tools/bootstrap_ffmpeg.py

Write-Host "== QA Gate (full) ==" -ForegroundColor Cyan
python tools/qa_full.py @args
exit $LASTEXITCODE
