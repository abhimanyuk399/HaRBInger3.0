$ErrorActionPreference = 'Stop'

$gitBash = 'C:\Program Files\Git\bin\bash.exe'
$bashCommand = Get-Command bash -ErrorAction SilentlyContinue
$bashExe = if (Test-Path $gitBash) { $gitBash } elseif ($bashCommand) { $bashCommand.Source } else { $null }

if (-not $bashExe) {
  throw "Missing required command: bash (Git Bash/WSL)."
}

& $bashExe ./scripts/security-hardening-smoke.sh
exit $LASTEXITCODE
