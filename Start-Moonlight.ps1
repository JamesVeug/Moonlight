param(
    [switch]$Rebuild,
    [switch]$NoAdminPanel
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
foreach ($relative in @('Character.wz', 'Map002.wz/Map', 'String.wz/Skill.img.xml', 'Quest.wz/QuestInfo.img.xml')) {
    if (-not (Test-Path (Join-Path 'Server/wz' $relative))) {
        throw "Missing exported v214 WZ data: Server/wz/$relative. See LOCAL-SETUP.md."
    }
}
$machine = podman machine inspect podman-machine-default | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Podman VM.' }
if ($machine.State -ne 'running') {
    podman machine start podman-machine-default
    if ($LASTEXITCODE -ne 0) { throw 'Cannot start Podman VM.' }
}
podman --connection podman-machine-default image exists localhost/moonlight-server:latest
if ($Rebuild -or $LASTEXITCODE -ne 0) {
    podman --connection podman-machine-default build -t localhost/moonlight-server:latest -f Server/Dockerfile .
    if ($LASTEXITCODE -ne 0) { throw 'Server build failed.' }
}
& "$PSScriptRoot/Compose.ps1" up -d --no-build

if (-not $NoAdminPanel) {
    $adminRoot = Join-Path $PSScriptRoot 'tools/moonlight-admin'
    $adminPort = 8787
    $adminEnvPath = Join-Path $adminRoot '.env'
    $adminEnvExamplePath = Join-Path $adminRoot '.env.example'
    $adminLogDir = Join-Path $adminRoot 'logs'
    $adminPidPath = Join-Path $adminLogDir 'admin-panel.pid'
    $adminOutPath = Join-Path $adminLogDir 'admin-panel.out.log'

    if (Test-Path $adminRoot) {
        if (-not (Test-Path $adminLogDir)) {
            New-Item -ItemType Directory -Path $adminLogDir -Force | Out-Null
        }

        if (-not (Test-Path $adminEnvPath) -and (Test-Path $adminEnvExamplePath)) {
            Copy-Item $adminEnvExamplePath $adminEnvPath
            Write-Host "Created tools/moonlight-admin/.env from .env.example."
        }

        if (Test-Path $adminEnvPath) {
            $portLine = Get-Content $adminEnvPath | Where-Object { $_ -match '^\s*PORT\s*=\s*\d+\s*$' } | Select-Object -First 1
            if ($portLine -match '(\d+)') {
                $adminPort = [int]$matches[1]
            }
        }

        $listening = Get-NetTCPConnection -State Listen -LocalPort $adminPort -ErrorAction SilentlyContinue
        if ($listening) {
            Write-Host "Moonlight admin panel already running on http://localhost:$adminPort"
        }
        else {
            $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
            if (-not $npmCmd) {
                throw 'npm.cmd not found. Install Node.js to run tools/moonlight-admin.'
            }

            if (-not (Test-Path (Join-Path $adminRoot 'node_modules'))) {
                & $npmCmd.Source --prefix $adminRoot ci
                if ($LASTEXITCODE -ne 0) { throw 'moonlight-admin dependency install failed.' }
            }

            $cmdLine = "cd /d `"$adminRoot`" && npm run start >> `"$adminOutPath`" 2>&1"
            $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $cmdLine -WindowStyle Minimized -PassThru
            Set-Content -Path $adminPidPath -Value $proc.Id
            Write-Host "Started moonlight-admin on http://localhost:$adminPort (PID $($proc.Id))."
        }
    }
    else {
        Write-Host 'Skipping admin panel startup (tools/moonlight-admin not found).'
    }
}
