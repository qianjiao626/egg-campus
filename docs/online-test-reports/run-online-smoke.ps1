$ErrorActionPreference = 'SilentlyContinue'
$base = 'https://dsxnb.com/dd'
$paths = @('/', '/health', '/api/users/leaderboard', '/login', '/api/auth/login', '/api/auth/register', '/api/tasks/mine', '/api/inquiries', '/api/buddy-box/features', '/api-client.js?v=20260826-registration-validation', '/sensitive-filter.js', '/char-eggy-game.jpg', '/char-eggy-hermit.jpg', '/blind-box/')
$round = 2
while ($true) {
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
  $results = @()
  foreach ($path in $paths) {
    try {
      $response = Invoke-WebRequest -Uri ($base + $path) -Method GET -UseBasicParsing -TimeoutSec 20
      $results += "| $path | $([int]$response.StatusCode) | $($response.Headers['Content-Type']) | $($response.RawContentLength) | $([int]$response.StatusCode -lt 500) |"
    } catch {
      $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode.value__ } else { 0 }
      $results += "| $path | $status | error | 0 | $($status -gt 0 -and $status -lt 500) |"
    }
  }
  $file = Join-Path $PSScriptRoot ("{0}-round-{1:00}.md" -f (Get-Date -Format 'yyyy-MM-dd'), $round)
  $body = @('# Online smoke test report', '', "- Time: $stamp", "- Environment: production read-only smoke test at $base", '- Database: not connected or written; no accounts created', "- Round: $round", '', '| Endpoint | HTTP status | Content-Type | Length | Pass |', '|---|---:|---|---:|---|') + $results + @('', '# Conclusion', 'GET-only read-only check. No login, registration, or write request was submitted.')
  Set-Content -LiteralPath $file -Value ($body -join [Environment]::NewLine) -Encoding UTF8
  $round++
  Start-Sleep -Seconds 600
}
