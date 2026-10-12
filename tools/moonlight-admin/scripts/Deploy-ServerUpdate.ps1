param(
    [switch]$RestartOnly
)
$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$adminRoot = Resolve-Path (Join-Path $scriptRoot '..')
$repoRoot = Resolve-Path (Join-Path $adminRoot '..\..\..')

Set-Location $repoRoot

function Write-Step([string]$message) {
    Write-Host ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message)
}

if ($RestartOnly) {
    Write-Step 'Starting restart-only workflow.'
}
else {
    Write-Step 'Starting deploy workflow.'

    # Keep pull safe on ops host; do not auto-merge.
    Write-Step 'Running git pull --ff-only.'
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) {
        throw 'git pull failed. Resolve local changes/divergence first.'
    }
}

$machine = podman machine inspect podman-machine-default | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) {
    throw 'Cannot inspect Podman VM.'
}
if ($machine.State -ne 'running') {
    Write-Step 'Starting podman-machine-default.'
    podman machine start podman-machine-default
    if ($LASTEXITCODE -ne 0) {
        throw 'Cannot start Podman VM.'
    }
}

if (-not $RestartOnly) {
    Write-Step 'Building replacement server image.'
    podman --connection podman-machine-default build -t localhost/moonlight-server:latest -f Server/Dockerfile .
    if ($LASTEXITCODE -ne 0) {
        throw 'Server build failed.'
    }
}

$runningServer = podman --connection podman-machine-default ps --filter name=moonlight-server --format '{{.ID}}'
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to query running server container.'
}

if (-not [string]::IsNullOrWhiteSpace($runningServer)) {
    Write-Step 'Gracefully stopping running server (timeout 120s).'
    podman --connection podman-machine-default stop --time 120 moonlight-server
    if ($LASTEXITCODE -ne 0) {
        throw 'Graceful stop failed.'
    }

    Write-Step 'Checking shutdown logs for persistence markers.'
    $serverLogs = podman --connection podman-machine-default logs moonlight-server 2>&1
    $savedAccounts = $serverLogs | Select-String -SimpleMatch 'Accounts have been saved.' -Quiet
    $shutdownComplete = $serverLogs | Select-String -SimpleMatch 'Shutdown complete!' -Quiet

    if (-not $savedAccounts -or -not $shutdownComplete) {
        throw 'Did not find expected shutdown markers in logs: Accounts have been saved. and Shutdown complete!'
    }
}
else {
    Write-Step 'No running moonlight-server container found; skipping stop.'
}

if ($RestartOnly) {
    Write-Step 'Starting server (restart-only mode).' 
}
else {
    Write-Step 'Starting server with replacement image.'
}
powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'Compose.ps1') up -d --no-build server
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to start server container.'
}

Write-Step 'Current compose status:'
powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'Compose.ps1') ps
if ($LASTEXITCODE -ne 0) {
    throw 'Compose status check failed.'
}

if ($RestartOnly) {
    Write-Step 'Restart-only workflow completed successfully.'
}
else {
    Write-Step 'Deploy workflow completed successfully.'
}
