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

$share = '\\100.100.100.100@8080\DavWWWRoot\m4pster@gmail.com\james\moonlight'
Write-Host "4/5 Mounting the share:`n    $share" -ForegroundColor Cyan
# Clean up any stale mapping on M:
cmd /c "net use M: /delete /y" 2>$null | Out-Null
cmd /c "net use M: `"$share`"" | Write-Host
if ($LASTEXITCODE -ne 0) {
    throw "Could not mount the share. Check that Tailscale is connected and that you can reach 'james' (try: tailscale ping james)."
}

Write-Host "5/5 Copying client to $Destination  (this is ~17 GB, be patient)..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
# robocopy: /E all subdirs, /Z restartable, /MT multithread, /R retries, no per-file spam
robocopy "M:\" "$Destination" /E /Z /MT:16 /R:3 /W:5 /NFL /NDL /NP
$rc = $LASTEXITCODE  # robocopy: 0-7 are success codes
cmd /c "net use M: /delete /y" 2>$null | Out-Null

if ($rc -ge 8) { throw "robocopy reported errors (code $rc). Some files may not have copied." }
Write-Host "`nDone. Client copied to: $Destination" -ForegroundColor Green
Write-Host "Launch it with 'Moonlight v214 Launcher.exe' in that folder (Tailscale must stay connected to play)." -ForegroundColor Green
