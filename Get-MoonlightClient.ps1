<#
    Get-MoonlightClient.ps1
    Run this ONCE on the PC that will copy the Moonlight client over Tailscale (Taildrive).

    REQUIREMENTS:
      - Tailscale installed, signed in, and connected (you must be a member of the
        'm4pster@gmail.com' tailnet - accept James's email invite first).
      - Run this script AS ADMINISTRATOR (right-click -> Run with PowerShell as admin,
        or in an elevated PowerShell:  powershell -ExecutionPolicy Bypass -File .\Get-MoonlightClient.ps1)

    It enables the Windows WebDAV client, lifts the 47 MB file-size cap so the large
    .wz files copy, mounts the share, and copies everything to a local folder.
#>

param(
    # Where to copy the client on THIS pc:
    [string]$Destination = "$HOME\Moonlight\client"
)

$ErrorActionPreference = 'Stop'

# --- must be elevated ---
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
          ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw "Please run this script as Administrator." }

Write-Host "1/5 Enabling WebDAV client (WebClient service)..." -ForegroundColor Cyan
Set-Service WebClient -StartupType Automatic
Start-Service WebClient

Write-Host "2/5 Raising WebDAV max file size to ~4 GB (default is only 47 MB)..." -ForegroundColor Cyan
$params = 'HKLM:\SYSTEM\CurrentControlSet\Services\WebClient\Parameters'
Set-ItemProperty -Path $params -Name FileSizeLimitInBytes -Value 0xFFFFFFFF -Type DWord
# Also raise the attribute/collection timeout so big directory listings don't time out
Set-ItemProperty -Path $params -Name FileAttributesLimitInBytes -Value 0xFFFFFFFF -Type DWord -ErrorAction SilentlyContinue

Write-Host "3/5 Restarting WebClient to apply the limit..." -ForegroundColor Cyan
Restart-Service WebClient
Start-Sleep -Seconds 2

# Mount the Taildrive WebDAV ROOT, then auto-discover the share path.
# The root lists one folder per tailnet; inside is one folder per device, then its shares.
# We don't hardcode the tailnet name (it differs per account) - we find it.
$root = '\\100.100.100.100@8080\DavWWWRoot'
Write-Host "4/5 Mounting Taildrive root ($root) and locating the 'moonlight' share..." -ForegroundColor Cyan
# NOTE: redirect stderr INSIDE cmd (>nul 2>nul), never with PowerShell's 2>$null -
# PS turns a native command's stderr into a terminating error under ErrorActionPreference=Stop.
cmd /c "net use M: /delete /y >nul 2>nul"   # ok if nothing was mapped
cmd /c "net use M: ""$root"" 2>&1" | Write-Host
if ($LASTEXITCODE -ne 0) {
    throw "Could not mount Taildrive. Check Tailscale is connected (try: tailscale ping james) and that you were granted the 'drive:access' attribute in the tailnet ACLs."
}

# Find james\moonlight regardless of what the tailnet folder is called.
$sharePath = $null
foreach ($tnet in Get-ChildItem M:\ -Directory -ErrorAction SilentlyContinue) {
    $candidate = Join-Path $tnet.FullName 'james\moonlight'
    if (Test-Path $candidate) { $sharePath = $candidate; break }
}
if (-not $sharePath) {
    $found = Get-ChildItem M:\ -Recurse -Depth 2 -Directory -ErrorAction SilentlyContinue |
             Where-Object { $_.Name -eq 'moonlight' } | Select-Object -First 1
    if ($found) { $sharePath = $found.FullName }
}
if (-not $sharePath) {
    cmd /c "net use M: /delete /y >nul 2>nul"
    throw "Mounted Taildrive but couldn't find the 'moonlight' share. Open M:\ in Explorer to see what's there, or check the ACL drive:access attribute."
}
Write-Host "Found share at: $sharePath" -ForegroundColor Green

Write-Host "5/5 Copying client to $Destination  (this is ~17 GB, be patient)..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
# robocopy: /E all subdirs, /Z restartable, /MT multithread, /R retries, no per-file spam
robocopy "$sharePath" "$Destination" /E /Z /MT:16 /R:3 /W:5 /NFL /NDL /NP
$rc = $LASTEXITCODE  # robocopy: 0-7 are success codes
cmd /c "net use M: /delete /y >nul 2>nul"

if ($rc -ge 8) { throw "robocopy reported errors (code $rc). Some files may not have copied." }
Write-Host "`nDone. Client copied to: $Destination" -ForegroundColor Green
Write-Host "Launch it with 'Moonlight v214 Launcher.exe' in that folder (Tailscale must stay connected to play)." -ForegroundColor Green
