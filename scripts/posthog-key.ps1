# Saves the PostHog project key that builds send to, in %USERPROFILE%\.tauri\gachamod.env, where
# scripts/build-installer.mjs finds it from any checkout. Typing is hidden and the key is never printed. It works out
# which PostHog server (US or EU) knows the key by asking both. Run it with `npm run posthog-key`.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$dir = Join-Path $env:USERPROFILE '.tauri'
$file = Join-Path $dir 'gachamod.env'
$us = 'https://us.i.posthog.com'
$eu = 'https://eu.i.posthog.com'

function Read-Key {
  while ($true) {
    $secure = Read-Host 'Project API key' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $k = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ($k -match '^phc_[A-Za-z0-9_-]{20,}$') { return $k }
    if ($k -eq '') { Write-Host 'Nothing was typed. Paste the key, then press Enter.' -ForegroundColor Yellow }
    elseif ($k -match '^phx_') { Write-Host "That's a personal API key (phx_). Builds need the project key, which starts with phc_." -ForegroundColor Yellow }
    else { Write-Host "That doesn't look like a project key. It starts with phc_." -ForegroundColor Yellow }
  }
}

# 200 when the server knows the key, 401 when it doesn't, 0 when it couldn't be reached
function Test-Server([string]$server, [string]$k) {
  $body = @{ api_key = $k; distinct_id = 'gachamod-key-check' } | ConvertTo-Json -Compress
  try {
    $r = Invoke-WebRequest -Uri "$server/flags?v=2" -Method Post -Body $body -ContentType 'application/json' -UseBasicParsing -TimeoutSec 15
    return [int]$r.StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return 0
  }
}

Write-Host ''
Write-Host 'PostHog key for gachamod builds' -ForegroundColor Cyan
Write-Host 'In PostHog, open Settings, then Project, and copy the Project API key (it starts with phc_).'
Write-Host 'Typing is hidden. Paste with Ctrl+V or a right-click, then press Enter.'
Write-Host ''

$server = $null
while (-not $server) {
  $key = Read-Key
  Write-Host 'Checking the key with PostHog...'
  $atUs = Test-Server $us $key
  $atEu = Test-Server $eu $key
  if ($atUs -eq 200 -and $atEu -ne 200) { $server = $us; Write-Host 'PostHog knows this key on its US server.' -ForegroundColor Green }
  elseif ($atEu -eq 200 -and $atUs -ne 200) { $server = $eu; Write-Host 'PostHog knows this key on its EU server.' -ForegroundColor Green }
  elseif ($atUs -eq 401 -and $atEu -eq 401) {
    Write-Host "Neither PostHog server knows this key. Check that it's the Project API key and paste it again." -ForegroundColor Yellow
  } else {
    Write-Host "Couldn't check the key with PostHog (US answered $atUs, EU answered $atEu)." -ForegroundColor Yellow
    $pick = Read-Host 'Which server is your project on? Type US or EU'
    $server = if ($pick -match '^\s*e') { $eu } else { $us }
  }
}

# keep any other settings already in the file
$keep = @()
if (Test-Path $file) { $keep = @(Get-Content $file | Where-Object { $_ -notmatch '^\s*GACHAMOD_POSTHOG_(KEY|HOST)\s*=' }) }
$lines = $keep + @("GACHAMOD_POSTHOG_KEY=$key", "GACHAMOD_POSTHOG_HOST=$server")
New-Item -ItemType Directory -Force $dir | Out-Null
[IO.File]::WriteAllText($file, (($lines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding $false))
$key = $null

Write-Host ''
Write-Host "Saved to %USERPROFILE%\.tauri\gachamod.env. The next npm run installer or release sends to PostHog." -ForegroundColor Green
