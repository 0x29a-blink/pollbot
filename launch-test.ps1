<#
    launch-test.ps1 — one-command local test launcher for PollBot (Windows).

    Starts the whole stack (render service, dashboard service, Discord shards,
    webhook server) via `npm run dev`, after a few pre-flight checks so you don't
    accidentally run against production or a half-installed tree.

    Usage (from a PowerShell prompt in the repo root):
        ./launch-test.ps1                 # start the bot
        ./launch-test.ps1 -Deploy         # (re)register slash commands first
        ./launch-test.ps1 -Install        # force `npm install` in root + dashboard
        ./launch-test.ps1 -DashboardDev   # also start the Vite dev server (hot reload)

    First-time run: use  ./launch-test.ps1 -Install -Deploy
#>
[CmdletBinding()]
param(
    [switch]$Deploy,
    [switch]$Install,
    [switch]$DashboardDev
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Warn2($msg) { Write-Host "WARNING: $msg" -ForegroundColor Yellow }

# --- 1. Node present? ---------------------------------------------------------
Write-Step "Checking Node.js"
$nodeVersion = (& node --version) 2>$null
if (-not $nodeVersion) { throw "Node.js not found on PATH. Install Node 20+ and retry." }
Write-Host "Node $nodeVersion"
if ($nodeVersion -match '^v(\d+)\.') {
    if ([int]$Matches[1] -lt 20) { Write-Warn2 "Node 20+ is recommended (found $nodeVersion)." }
}

# --- 2. .env present and safe for testing ------------------------------------
Write-Step "Checking .env"
if (-not (Test-Path (Join-Path $root '.env'))) {
    Write-Warn2 ".env not found. Copying .env.example -> .env; fill in your credentials then re-run."
    Copy-Item (Join-Path $root '.env.example') (Join-Path $root '.env')
    Write-Host "Edit .env (DISCORD_TOKEN, SUPABASE_URL, SUPABASE_KEY, DEV_GUILD_ID) and run again." -ForegroundColor Green
    exit 1
}

$envText = Get-Content (Join-Path $root '.env') -Raw
if ($envText -notmatch '(?im)^\s*DEV_ONLY_MODE\s*=\s*true') {
    Write-Warn2 "DEV_ONLY_MODE is not 'true'. For single-user testing set DEV_ONLY_MODE=true and DEV_GUILD_ID to your test server, so commands don't register globally / on production."
    $answer = Read-Host "Continue anyway? (y/N)"
    if ($answer -ne 'y') { exit 1 }
}

# --- 3. Dependencies ----------------------------------------------------------
if ($Install -or -not (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Step "Installing backend dependencies (this also installs the Chromium used for rendering)"
    & npm install
}
if ($Install -or -not (Test-Path (Join-Path $root 'dashboard/node_modules'))) {
    Write-Step "Installing dashboard dependencies"
    Push-Location (Join-Path $root 'dashboard')
    & npm install
    Pop-Location
}

# --- 4. Build the dashboard so the Dashboard Service can serve it -------------
if (-not $DashboardDev) {
    if ($Install -or -not (Test-Path (Join-Path $root 'dashboard/dist'))) {
        Write-Step "Building the dashboard"
        Push-Location (Join-Path $root 'dashboard')
        & npm run build
        Pop-Location
    }
}

# --- 5. (Optional) register slash commands to the test guild ------------------
if ($Deploy) {
    Write-Step "Registering slash commands (npm run deploy)"
    & npm run deploy
}

# --- 6. (Optional) start the Vite dev server in a new window ------------------
if ($DashboardDev) {
    Write-Step "Starting the dashboard dev server (Vite) in a new window"
    Start-Process powershell -ArgumentList @(
        '-NoExit', '-Command',
        "Set-Location '$([IO.Path]::Combine($root, 'dashboard'))'; npm run dev"
    )
}

# --- 7. Launch the bot --------------------------------------------------------
Write-Step "Starting PollBot (npm run dev). Press Ctrl+C to stop."
Write-Host "Reminder: apply supabase/migrations/17 and /18 in your Supabase SQL editor for the atomic vote path and dashboard stat RPCs (the bot still works without them via a safe fallback)." -ForegroundColor DarkGray
& npm run dev
