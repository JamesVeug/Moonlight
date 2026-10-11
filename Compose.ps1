$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$compose = Get-Command docker-compose -ErrorAction SilentlyContinue
$composePath = if ($compose) { $compose.Source } else { $null }
if (-not $compose) {
    $composePath = Get-ChildItem "$env:LOCALAPPDATA/Microsoft/WinGet/Packages/Docker.DockerCompose_*/docker-compose.exe" |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $composePath) { throw 'Docker Compose is not installed.' }
$previousHost = $env:DOCKER_HOST
try {
    # Podman Desktop exposes its Docker-compatible API on this named pipe.
    $env:DOCKER_HOST = 'npipe:////./pipe/docker_engine'
    & $composePath -p moonlight @args
    exit $LASTEXITCODE
} finally {
    $env:DOCKER_HOST = $previousHost
}
