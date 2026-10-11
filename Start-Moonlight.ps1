param([switch]$Rebuild)
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
