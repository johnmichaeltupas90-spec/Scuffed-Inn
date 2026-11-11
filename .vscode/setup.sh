#!/usr/bin/env bash
# Creates .venv and installs the Python packages.
# Run it from VS Code with the "Setup" task, or directly: bash .vscode/setup.sh

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

step() {
    printf '\n==> %s\n' "$1"
}

if command -v python3 >/dev/null 2>&1; then
    python_cmd="python3"
elif command -v python >/dev/null 2>&1; then
    python_cmd="python"
else
    echo "Python was not found. Install Python 3.10 or newer, then run setup again." >&2
    exit 1
fi

if [ -x ".venv/bin/python" ]; then
    step "Virtual environment already exists"
else
    step "Creating the virtual environment (.venv)"
    "$python_cmd" -m venv .venv
fi

step "Installing Python packages"
.venv/bin/python -m pip install --disable-pip-version-check --quiet -r requirements.txt

# Friendly checks. These never print the connection string itself.
if [ ! -f ".env" ]; then
    printf '\n[!] No .env file found in the project root.\n'
    printf '    Create one with your database connection string:\n'
    printf '    DATABASE_URL=postgresql://user:password@host:5432/postgres\n'
    printf '    Ask a teammate, or copy it from Supabase (Project Settings > Database).\n'
else
    has_url="$(.venv/bin/python -c "from dotenv import load_dotenv; import os; load_dotenv(); print('yes' if os.getenv('DATABASE_URL') else 'no')")"
    if [ "$has_url" = "yes" ]; then
        printf '\n[ok] .env found and DATABASE_URL is set.\n'
    else
        printf '\n[!] .env exists but DATABASE_URL is missing or empty.\n'
    fi
fi

printf '\nSetup complete.\n'
printf "Press Ctrl+Shift+B and choose 'Run Everything (API + Web)' to start both servers.\n"
