<#
    Enable-RemoteAccess.ps1
    Exposes the Moonlight server ports on the Tailscale interface.

    WHY THIS IS NEEDED:
    Podman runs in a WSL2 VM. WSL2 re-publishes container ports on Windows at
    127.0.0.1 only (via wslrelay), so the Tailscale IP can't reach them even though
    docker-compose binds 0.0.0.0 *inside* the VM. This adds a Windows netsh portproxy
    that listens on the Tailscale IP and forwards to the loopback wslrelay listener,
    plus a firewall rule. Re-run after a reboot if the proxy is cleared, or after the
    Tailscale IP changes (pass -TailscaleIP <new ip>).

    RUN AS ADMINISTRATOR:
      powershell -ExecutionPolicy Bypass -File .\Enable-RemoteAccess.ps1
    To undo:
      powershell -ExecutionPolicy Bypass -File .\Enable-RemoteAccess.ps1 -Remove
#>

param(
    [string]$TailscaleIP = '100.114.235.74',
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
          ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw "Please run this script as Administrator." }

# Moonlight ports: API 8483, login 8484, channels 8585-8594
$ports = @(8483, 8484) + (8585..8594)
$fwName = 'Moonlight Server (Tailscale)'

if ($Remove) {
    Write-Host "Removing portproxy rules and firewall rule..." -ForegroundColor Cyan
    foreach ($p in $ports) {
        netsh interface portproxy delete v4tov4 listenaddress=$TailscaleIP listenport=$p 2>$null | Out-Null
    }
    Get-NetFirewallRule -DisplayName $fwName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Write-Host "Removed." -ForegroundColor Green
    netsh interface portproxy show v4tov4
    return
}

Write-Host "Adding portproxy: ${TailscaleIP}:<port> -> 127.0.0.1:<port> for $($ports.Count) ports..." -ForegroundColor Cyan
foreach ($p in $ports) {
    # delete any stale entry first so re-runs are clean
    netsh interface portproxy delete v4tov4 listenaddress=$TailscaleIP listenport=$p 2>$null | Out-Null
    netsh interface portproxy add v4tov4 listenaddress=$TailscaleIP listenport=$p connectaddress=127.0.0.1 connectport=$p
}

Write-Host "Adding firewall allow rule '$fwName'..." -ForegroundColor Cyan
Get-NetFirewallRule -DisplayName $fwName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $fwName -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort $ports -Profile Any | Out-Null

Write-Host "`nActive portproxy rules:" -ForegroundColor Green
netsh interface portproxy show v4tov4
Write-Host "`nDone. Test from this PC:  Test-NetConnection $TailscaleIP -Port 8484" -ForegroundColor Green
