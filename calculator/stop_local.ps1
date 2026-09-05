# stop_local.ps1 - Arrete proprement le calculateur local.
param([int]$Id = 0)

$ErrorActionPreference = 'SilentlyContinue'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $dir

if ($Id -gt 0) {
    $calcPid = $Id
} elseif (Test-Path 'pi_calculate.pid') {
    $calcPid = (Get-Content 'pi_calculate.pid').Trim()
} else {
    Write-Host 'Aucun PID trouve.'
    exit 0
}

if ($calcPid -match '^\d+$') {
    try {
        Stop-Process -Id $calcPid -Force
        Write-Host "🛑 Calculateur PID=$calcPid arrete."
    } catch {
        Write-Host "Impossible d'arrêter PID=$calcPid : $_"
    }
} else {
    Write-Host "PID invalide : $calcPid"
}

Remove-Item -Path 'pi_calculate.lock' -Force -ErrorAction SilentlyContinue
