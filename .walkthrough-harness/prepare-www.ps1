$ErrorActionPreference = 'Stop'
$ws = 'D:\桌面文件\蛋蛋校园'
$tmp = Join-Path $env:TEMP 'dd-walkthrough-www'
$src = Join-Path $ws 'backend-handoff-package'
if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
New-Item -ItemType Directory -Path $tmp | Out-Null
Copy-Item -Path (Join-Path $src '*') -Destination $tmp -Recurse -Force
$inject = '<script>window.DANDAN_API_ORIGIN=''/dd'';</script>'
$main = Join-Path $tmp 'growth-school.html'
$t = Get-Content -LiteralPath $main -Raw -Encoding UTF8
$marker = '<script src="api-client.js'
if ($t.Contains($marker)) {
  $t = $t.Replace($marker, $inject + [char]10 + $marker)
  Set-Content -LiteralPath $main -Value $t -Encoding UTF8 -NoNewline
  Write-Output 'injected growth-school.html'
} else { Write-Output 'MARKER NOT FOUND in growth-school.html' }
$bb = Join-Path $tmp 'blind-box\index.html'
$b = Get-Content -LiteralPath $bb -Raw -Encoding UTF8
$bmarker = '<script defer src="city-data.js'
if ($b.Contains($bmarker)) {
  $b = $b.Replace($bmarker, $inject + [char]10 + $bmarker)
  Set-Content -LiteralPath $bb -Value $b -Encoding UTF8 -NoNewline
  Write-Output 'injected blind-box/index.html'
} else { Write-Output 'BB MARKER NOT FOUND in blind-box/index.html' }
Write-Output ("TEMP_ROOT=" + $tmp)
