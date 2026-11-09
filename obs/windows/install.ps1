# Installs the Linux scenes into Windows OBS as a separate profile and scene collection "nglzzz-dvor".
# Run install.cmd with OBS closed. Old profile and collection stay untouched; a backup goes to
# %APPDATA%\obs-studio\backup-<date>.
$ErrorActionPreference = 'Stop'
$name = 'nglzzz-dvor'
$baseProfile = 'nglzzz'          # Windows profile to copy stream key, encoder and output settings from
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $here 'out'
$obs = Join-Path $env:APPDATA 'obs-studio'
$utf8 = New-Object System.Text.UTF8Encoding $false
# OBS on Windows writes its ini files with a BOM: keep whatever the file had.
function Get-Encoding($path) {
    $head = [IO.File]::ReadAllBytes($path) | Select-Object -First 3
    return New-Object System.Text.UTF8Encoding ($head.Count -eq 3 -and $head[0] -eq 0xEF -and $head[1] -eq 0xBB -and $head[2] -eq 0xBF)
}

function Fail($msg) { Write-Host $msg -ForegroundColor Red; Read-Host 'Press Enter'; exit 1 }

if (Get-Process obs64 -ErrorAction SilentlyContinue) { Fail 'Close OBS first, then run again.' }
if (-not (Test-Path (Join-Path $out "$name.json"))) { Fail "No $out\$name.json - run obs/windows/build.py on Linux first." }

# 1. Backup
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $obs "backup-$stamp"
New-Item -ItemType Directory -Path $backup | Out-Null
Copy-Item (Join-Path $obs 'user.ini') $backup
Copy-Item (Join-Path $obs 'basic') (Join-Path $backup 'basic') -Recurse
Write-Host "Backup: $backup"

# 2. Scene collection (a rerun replaces it with the fresh build; the previous one is in the backup)
if (Test-Path (Join-Path $obs "basic\scenes\$name.json")) { Write-Host "Replacing existing $name.json (old copy is in the backup)" -ForegroundColor Yellow }
Copy-Item (Join-Path $out "$name.json") (Join-Path $obs "basic\scenes\$name.json") -Force
Write-Host "Scene collection: $name"

# 3. Profile: copy of the current Windows profile (stream key, NVENC, 1080p60 output stay as they were)
$profileDir = Join-Path $obs "basic\profiles\$name"
if (-not (Test-Path $profileDir)) {
    Copy-Item (Join-Path $obs "basic\profiles\$baseProfile") $profileDir -Recurse
    $ini = Join-Path $profileDir 'basic.ini'
    $enc = Get-Encoding $ini
    $text = [IO.File]::ReadAllText($ini, $enc) -replace '(?m)^Name=.*$', "Name=$name"
    [IO.File]::WriteAllText($ini, $text, $enc)
    Write-Host "Profile: $name (copy of $baseProfile)"
} else {
    Write-Host "Profile $name already exists - kept as is"
}

# 4. user.ini: switch to the new profile and collection, add docks
$userIni = Join-Path $obs 'user.ini'
$userEnc = Get-Encoding $userIni
$lines = [System.Collections.Generic.List[string]]([IO.File]::ReadAllLines($userIni, $userEnc))
function Set-IniValue($section, $key, $value) {
    $start = $lines.IndexOf("[$section]")
    if ($start -lt 0) { $lines.Add("[$section]"); $lines.Add("$key=$value"); return }
    $i = $start + 1
    while ($i -lt $lines.Count -and -not $lines[$i].StartsWith('[')) {
        if ($lines[$i].StartsWith("$key=")) { $lines[$i] = "$key=$value"; return }
        $i++
    }
    $lines.Insert($i, "$key=$value")
}
function Get-IniValue($section, $key) {
    $start = $lines.IndexOf("[$section]")
    if ($start -lt 0) { return $null }
    for ($i = $start + 1; $i -lt $lines.Count -and -not $lines[$i].StartsWith('['); $i++) {
        if ($lines[$i].StartsWith("$key=")) { return $lines[$i].Substring($key.Length + 1) }
    }
    return $null
}
Set-IniValue 'Basic' 'Profile' $name
Set-IniValue 'Basic' 'ProfileDir' $name
Set-IniValue 'Basic' 'SceneCollection' $name
Set-IniValue 'Basic' 'SceneCollectionFile' "$name.json"

# Docks are appended as ready JSON text: the existing value is not re-serialized, because
# PowerShell 5.1 ConvertTo-Json escapes '&' as \u0026 and OBS applies its own ini escaping to backslashes.
$docksValue = Get-IniValue 'BasicWindow' 'ExtraBrowserDocks'
if (-not $docksValue) { $docksValue = '[]' }
$added = @()
foreach ($dock in [IO.File]::ReadAllLines((Join-Path $out 'docks.txt'), $utf8)) {
    if (-not $dock.Trim()) { continue }
    $title = [regex]::Match($dock, '"title":\s*"([^"]*)"').Groups[1].Value
    if ($docksValue -match ('"title":\s*"' + [regex]::Escape($title) + '"')) { continue }
    $inner = $docksValue.Trim().TrimStart('[').TrimEnd(']').Trim()
    $docksValue = if ($inner) { "[$inner, $dock]" } else { "[$dock]" }
    $added += $title
}
Set-IniValue 'BasicWindow' 'ExtraBrowserDocks' $docksValue
[IO.File]::WriteAllLines($userIni, $lines, $userEnc)
Write-Host ("Docks added: " + ($(if ($added.Count) { $added -join ', ' } else { 'none' })))

Write-Host ''
Write-Host "Done. Start OBS: profile and scene collection '$name' are selected." -ForegroundColor Green
Write-Host "Go back to the old setup: Profile -> $baseProfile, Scene Collection -> nglzzz."
Read-Host 'Press Enter'
