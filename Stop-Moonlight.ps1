param([switch]$NoServer)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$adminRoot = Join-Path $PSScriptRoot 'tools/moonlight-admin'
$adminEnvPath = Join-Path $adminRoot '.env'
$adminPidPath = Join-Path $adminRoot 'logs/admin-panel.pid'
$adminPort = 8787

if (Test-Path $adminEnvPath) {
    $portLine = Get-Content $adminEnvPath | Where-Object { $_ -match '^\s*PORT\s*=\s*\d+\s*$' } | Select-Object -First 1
    if ($portLine -match '(\d+)') {
        $adminPort = [int]$matches[1]
    }
}

$stoppedByPid = $false
if (Test-Path $adminPidPath) {
    $pidRaw = (Get-Content $adminPidPath -ErrorAction SilentlyContinue | Select-Object -First 1)
    $adminPid = 0
    [void][int]::TryParse($pidRaw, [ref]$adminPid)
    if ($adminPid -gt 0) {
        $proc = Get-Process -Id $adminPid -ErrorAction SilentlyContinue
        if ($proc) {
            Stop-Process -Id $adminPid -Force -ErrorAction Stop
            Write-Host "Stopped moonlight-admin process PID $adminPid."
            $stoppedByPid = $true
        }
    }
    Remove-Item $adminPidPath -Force -ErrorAction SilentlyContinue
}

if (-not $stoppedByPid) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $adminPort -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($listener) {
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Host "Stopped process on admin port $adminPort (PID $($listener.OwningProcess))."
    } else {
        Write-Host "Moonlight admin panel not running on port $adminPort."
    }
}

if (-not $NoServer) {
    & "$PSScriptRoot/Compose.ps1" stop
} else {
    Write-Host 'Skipped server stop (-NoServer supplied).'
}
