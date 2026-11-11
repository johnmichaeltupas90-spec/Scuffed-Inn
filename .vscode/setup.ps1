# Creates .venv and installs the Python packages.
# Run it from VS Code with the "Setup" task, or directly:
#   powershell -ExecutionPolicy Bypass -File .vscode\setup.ps1

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

# Prefer the "python" command, then fall back to the Windows "py" launcher.
$pythonExe = ""
$pythonArgs = @()

if (Get-Command python -ErrorAction SilentlyContinue) {
    $pythonExe = "python"
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    $pythonExe = "py"
    $pythonArgs = @("-3")
} else {
    Write-Host "Python was not found. Install Python 3.10 or newer, then run setup again." -ForegroundColor Red
    exit 1
}

$venvPython = Join-Path $root ".venv\Scripts\python.exe"

if (Test-Path $venvPython) {
    Write-Step "Virtual environment already exists"
} else {
    Write-Step "Creating the virtual environment (.venv)"
    & $pythonExe @pythonArgs -m venv .venv
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Could not create the virtual environment." -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

Write-Step "Installing Python packages"
& $venvPython -m pip install --disable-pip-version-check --quiet -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Host "Package installation failed. Check your internet connection and try again." -ForegroundColor Red
    exit $LASTEXITCODE
}

# Friendly checks. These never print the connection string itself.
$envFile = Join-Path $root ".env"

if (-not (Test-Path $envFile)) {
    Write-Host ""
    Write-Host "[!] No .env file found in the project root." -ForegroundColor Yellow
    Write-Host "    Create one with your database connection string:" -ForegroundColor Yellow
    Write-Host "    DATABASE_URL=postgresql://user:password@host:5432/postgres" -ForegroundColor Yellow
    Write-Host "    Ask a teammate, or copy it from Supabase (Project Settings > Database)." -ForegroundColor Yellow
} else {
    $hasUrl = & $venvPython -c "from dotenv import load_dotenv; import os; load_dotenv(); print('yes' if os.getenv('DATABASE_URL') else 'no')"
    if ($hasUrl -eq "yes") {
        Write-Host ""
        Write-Host "[ok] .env found and DATABASE_URL is set." -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "[!] .env exists but DATABASE_URL is missing or empty." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host "Press Ctrl+Shift+B and choose 'Run Everything (API + Web)' to start both servers." -ForegroundColor Green
