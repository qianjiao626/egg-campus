$ErrorActionPreference = 'Stop'

$codexHome = Join-Path $HOME '.codex'
$agentsHome = Join-Path $HOME '.agents'
$browserHome = Join-Path $HOME '.agent-browser'
$errors = @()
$warnings = @()

function Add-Error([string]$message) { $script:errors += $message }
function Add-Warning([string]$message) { $script:warnings += $message }

foreach ($root in @((Join-Path $codexHome 'skills'), (Join-Path $agentsHome 'skills'))) {
  if (-not (Test-Path $root -PathType Container)) {
    Add-Error "Missing skill root: $root"
    continue
  }

  $skillFiles = @(Get-ChildItem $root -Recurse -Filter 'SKILL.md' -File -ErrorAction SilentlyContinue)
  if ($skillFiles.Count -eq 0) {
    Add-Error "No SKILL.md files found under $root"
    continue
  }

  foreach ($file in $skillFiles) {
    $content = Get-Content -Raw $file.FullName
    if ($content -notmatch '(?m)^name:\s*\S+') { Add-Error "Missing frontmatter name: $($file.FullName)" }
    if ($content -notmatch '(?m)^description:\s*\S+') { Add-Error "Missing frontmatter description: $($file.FullName)" }
  }
}

$partialDirs = @(Get-ChildItem (Join-Path $codexHome 'skills') -Directory -Filter '*.partial-install' -ErrorAction SilentlyContinue)
foreach ($dir in $partialDirs) {
  $hasSkill = Test-Path (Join-Path $dir.FullName 'SKILL.md') -PathType Leaf
  if ($hasSkill) { Add-Error "Incomplete skill directory contains SKILL.md: $($dir.FullName)" }
  else { Add-Warning "Ignored incomplete skill directory: $($dir.FullName)" }
}

$pluginRoot = Join-Path $codexHome 'plugins/cache/openai-primary-runtime'
if (Test-Path $pluginRoot -PathType Container) {
  $manifests = @(Get-ChildItem $pluginRoot -Recurse -Filter 'plugin.json' -File -ErrorAction SilentlyContinue)
  foreach ($manifest in $manifests) {
    try { $plugin = Get-Content -Raw $manifest.FullName | ConvertFrom-Json }
    catch { Add-Error "Invalid plugin JSON: $($manifest.FullName)"; continue }
    if (-not $plugin.name) { Add-Error "Plugin name missing: $($manifest.FullName)" }
    if ($plugin.skills) {
      $skillsPath = Join-Path $manifest.Directory.Parent.FullName ([string]$plugin.skills).TrimStart('./')
      if (-not (Test-Path $skillsPath -PathType Container)) { Add-Error "Plugin skills path missing: $skillsPath" }
    }
  }
}
else { Add-Error "Missing primary runtime plugin cache: $pluginRoot" }

$hostExe = Join-Path $codexHome '.sandbox-bin/codex-code-mode-host.exe'
if (-not (Test-Path $hostExe -PathType Leaf)) { Add-Error "Missing code mode host: $hostExe" }

$agentBrowser = Get-Command agent-browser -ErrorAction SilentlyContinue
if (-not $agentBrowser) { Add-Error 'agent-browser is not on PATH' }
$browserConfig = Join-Path $browserHome 'config.json'
if (-not (Test-Path $browserConfig -PathType Leaf)) { Add-Error "Missing agent-browser config: $browserConfig" }
else {
  try {
    $config = Get-Content -Raw $browserConfig | ConvertFrom-Json
    if ($config.args -isnot [string] -or $config.args -notmatch '--no-sandbox') { Add-Error 'agent-browser config args must include --no-sandbox' }
  }
  catch { Add-Error "Invalid agent-browser config: $browserConfig" }
}

Write-Output "Codex skill roots checked: $codexHome\skills and $agentsHome\skills"
Write-Output "Primary runtime plugin cache checked: $pluginRoot"
Write-Output "agent-browser command: $($agentBrowser.Source)"
Write-Output "code mode host: $hostExe"
foreach ($warning in $warnings) { Write-Warning $warning }
if ($errors.Count -gt 0) {
  $errors | ForEach-Object { Write-Error $_ }
  exit 1
}
Write-Output 'SKILLS_HEALTH_OK'
