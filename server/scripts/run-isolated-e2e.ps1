[CmdletBinding()]
param(
  [string]$HostName = '119.45.253.94',
  [string]$User = 'root',
  [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\id_ed25519'),
  [string]$RemoteBootstrap = '/root/dandan-world-server-20260826-admin-fix/scripts/ensure-isolated-e2e-admin.mjs',
  [string]$RemoteCleanup = '/root/dandan-world-server-20260826-admin-fix/scripts/cleanup-isolated-e2e.mjs',
  [int]$TunnelPort = 13311,
  [int]$RemotePort = 3311
)

$ErrorActionPreference = 'Stop'
$sshOptions = @('-i', $KeyPath, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10')
$identifier = 'isolated-e2e-admin'
$randomBytes = New-Object byte[] 24
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $random.GetBytes($randomBytes) } finally { $random.Dispose() }
$password = [Convert]::ToBase64String($randomBytes) + 'Aa1!'
$tunnel = $null
$oldIdentifier = $env:E2E_ADMIN_IDENTIFIER
$oldPassword = $env:E2E_ADMIN_PASSWORD

try {
  if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) { throw "SSH private key not found: $KeyPath" }

  $payload = @{ identifier = $identifier; password = $password } | ConvertTo-Json -Compress
  $remoteCommand = "set -a; . /root/dandan-world-server-20260826-admin-fix/.env.test; set +a; node $RemoteBootstrap"
  $payload | & ssh.exe @sshOptions "$User@$HostName" $remoteCommand
  if ($LASTEXITCODE -ne 0) { throw "isolated admin bootstrap failed with exit code $LASTEXITCODE" }

  $cleanupSource = Join-Path $PSScriptRoot 'cleanup-isolated-e2e.mjs'
  & scp.exe @sshOptions $cleanupSource "$User@$HostName`:$RemoteCleanup"
  if ($LASTEXITCODE -ne 0) { throw "isolated cleanup upload failed with exit code $LASTEXITCODE" }
  $cleanupCommand = "set -a; . /root/dandan-world-server-20260826-admin-fix/.env.test; set +a; node $RemoteCleanup"
  & ssh.exe @sshOptions "$User@$HostName" $cleanupCommand
  if ($LASTEXITCODE -ne 0) { throw "isolated cleanup failed with exit code $LASTEXITCODE" }

  $tunnelArgs = @('-N', '-o', 'ExitOnForwardFailure=yes', '-L', "${TunnelPort}:127.0.0.1:${RemotePort}") + $sshOptions + "$User@$HostName"
  $tunnelLog = Join-Path $env:TEMP "dandan-isolated-e2e-tunnel-$TunnelPort.log"
  Remove-Item -LiteralPath $tunnelLog -ErrorAction SilentlyContinue
  $tunnel = Start-Process -FilePath 'ssh.exe' -ArgumentList $tunnelArgs -WindowStyle Hidden -RedirectStandardError $tunnelLog -PassThru
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    if ($tunnel.HasExited) {
      $details = if (Test-Path -LiteralPath $tunnelLog) { Get-Content -LiteralPath $tunnelLog -Raw } else { '' }
      throw "SSH tunnel exited with code $($tunnel.ExitCode): $details"
    }
    $probe = Test-NetConnection -ComputerName '127.0.0.1' -Port $TunnelPort -InformationLevel Quiet -WarningAction SilentlyContinue
    if ($probe) { $ready = $true; break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $ready) {
    $details = if (Test-Path -LiteralPath $tunnelLog) { Get-Content -LiteralPath $tunnelLog -Raw } else { '' }
    throw "SSH tunnel did not open local port ${TunnelPort}: $details"
  }

  $env:E2E_ADMIN_IDENTIFIER = $identifier
  $env:E2E_ADMIN_PASSWORD = $password
  & node (Join-Path $PSScriptRoot 'isolated-e2e.mjs')
  if ($LASTEXITCODE -ne 0) { throw "isolated E2E failed with exit code $LASTEXITCODE" }
  & ssh.exe @sshOptions "$User@$HostName" $cleanupCommand
  if ($LASTEXITCODE -ne 0) { throw "isolated post-E2E cleanup failed with exit code $LASTEXITCODE" }
  Write-Output 'ISOLATED_E2E_RUN_COMPLETE'
}
finally {
  if ($null -ne $oldIdentifier) { $env:E2E_ADMIN_IDENTIFIER = $oldIdentifier } else { Remove-Item Env:E2E_ADMIN_IDENTIFIER -ErrorAction SilentlyContinue }
  if ($null -ne $oldPassword) { $env:E2E_ADMIN_PASSWORD = $oldPassword } else { Remove-Item Env:E2E_ADMIN_PASSWORD -ErrorAction SilentlyContinue }
  if ($null -ne $tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
}
