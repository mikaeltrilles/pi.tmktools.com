# run_local.ps1 - Lance calculate_pi.py sur le poste Windows actuel en tâche de fond.
# Usage : .\run_local.ps1
#         .\run_local.ps1 -Digits 50000
#         .\run_local.ps1 -Reset
#         .\run_local.ps1 -Chunk 5000
param(
    [int]$Digits = 0,
    [switch]$Reset,
    [int]$Chunk = 0
)

$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $dir

$pyCmd = Get-Command python3 -ErrorAction SilentlyContinue
if (-not $pyCmd) {
    $pyCmd = Get-Command py -ErrorAction SilentlyContinue
}
if (-not $pyCmd) {
    Write-Host '❌ Python 3 non trouvé (essayez python3 ou py)' -ForegroundColor Red
    exit 1
}
$py = $pyCmd.Source

# Arrêter proprement une ancienne instance
if (Test-Path 'pi_calculate.pid') {
    $oldPid = Get-Content 'pi_calculate.pid' -ErrorAction SilentlyContinue
    if ($oldPid) {
        try {
            $proc = Get-Process -Id $oldPid -ErrorAction Stop
            Write-Host "🛑 Arrêt de l'ancien calculateur (PID=$oldPid)..."
            $proc.Kill()
            $proc.WaitForExit(5000)
        } catch {
            Write-Host '   Ancien processus déjà absent.'
        }
    }
}

# Nettoyer les locks
Remove-Item -Path 'pi_calculate.lock' -Force -ErrorAction SilentlyContinue

# Construire les arguments Python
$argList = @('-u', 'calculate_pi.py')
if ($Digits -gt 0) { $argList += '--digits'; $argList += $Digits }
if ($Reset) { $argList += '--reset' }
if ($Chunk -gt 0) { $argList += '--chunk'; $argList += $Chunk }

$logFile = Join-Path $dir 'pi_calculate.log'
$errFile = Join-Path $dir 'pi_calculate.err.log'

# Rotation simple des logs
if (Test-Path $logFile) { Move-Item $logFile ($logFile + '.bak') -Force -ErrorAction SilentlyContinue }
if (Test-Path $errFile) { Move-Item $errFile ($errFile + '.bak') -Force -ErrorAction SilentlyContinue }

Write-Host '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' -ForegroundColor Cyan
Write-Host '  🥧 Calcul de π — mode local' -ForegroundColor Cyan
Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
Write-Host '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' -ForegroundColor Cyan
Write-Host "  Dossier : $dir"
Write-Host "  Python  : $py"
Write-Host "  Args    : $($argList -join ' ')"

# Lancer le processus Python en arrière-plan avec redirection vers des fichiers.
# Start-Process crée un processus indépendant : la console peut être fermée.
$proc = Start-Process -FilePath $py `
    -ArgumentList $argList `
    -WorkingDirectory $dir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $logFile `
    -RedirectStandardError $errFile `
    -PassThru

$proc.Id | Out-File -FilePath 'pi_calculate.pid' -Encoding ASCII -NoNewline

Write-Host ''
Write-Host "✅ Calculateur lancé (PID=$($proc.Id))" -ForegroundColor Green
Write-Host "   Suivi du log   : Get-Content pi_calculate.log -Tail 20 -Wait"
Write-Host "   Suivi erreurs  : Get-Content pi_calculate.err.log -Tail 20 -Wait"
Write-Host "   Progression    : Get-Content pi_progress.txt"
Write-Host "   Arrêt propre   : Stop-Process -Id $($proc.Id)"
