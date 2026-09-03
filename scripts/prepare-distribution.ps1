param([string]$WorkRoot = (Join-Path $env:TEMP 'harness-desktop-distribution'))
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$WorkRoot = [IO.Path]::GetFullPath($WorkRoot)
$runtime = Join-Path $WorkRoot 'runtime'
$cache = Join-Path $WorkRoot 'cache'
New-Item -ItemType Directory -Force -Path $runtime,$cache,"$runtime/node","$runtime/harness" | Out-Null

# Only public release assets enter this staging tree; never copy a developer Harness install.
$nodeVersion = '24.20.0'
$nodeHash = '6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba'
$archivePath = Join-Path $cache "node-v$nodeVersion-win-x64.zip"
if (!(Test-Path -LiteralPath $archivePath)) {
  Invoke-WebRequest "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-win-x64.zip" -OutFile $archivePath
}
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $nodeHash) { throw 'Node archive checksum mismatch; remove the invalid cached archive and retry.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  $prefix = "node-v$nodeVersion-win-x64/"
  foreach ($entry in $archive.Entries) {
    if (!$entry.FullName.StartsWith($prefix)) { continue }
    $name = $entry.FullName.Substring($prefix.Length)
    if ($name.EndsWith('/') -or ($name -notin @('node.exe','LICENSE','npm','npm.cmd','npx','npx.cmd') -and !$name.StartsWith('node_modules/npm/'))) { continue }
    $target = [IO.Path]::GetFullPath((Join-Path "$runtime/node" $name))
    if (!$target.StartsWith([IO.Path]::GetFullPath("$runtime/node") + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe Node archive path' }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
  }
} finally { $archive.Dispose() }
Copy-Item -LiteralPath "$repo/distribution/package.json","$repo/distribution/package-lock.json" -Destination "$runtime/harness"
# Native binaries are shipped in these pinned packages. No lifecycle scripts or local compilation.
$lockHash = (Get-FileHash -LiteralPath "$repo/distribution/package-lock.json" -Algorithm SHA256).Hash
$marker = Join-Path $WorkRoot 'runtime-install.sha256'
$cached = (Test-Path -LiteralPath $marker) -and ((Get-Content -LiteralPath $marker -Raw).Trim() -eq $lockHash) -and (Test-Path -LiteralPath "$runtime/harness/node_modules/@deepseek-ai/dsh/lib/bin.js")
if (!$cached) {
  & "$runtime/node/npm.cmd" ci --prefix "$runtime/harness" --cache $cache --ignore-scripts --omit=dev --no-audit --no-fund --registry=https://registry.npmjs.org
  if ($LASTEXITCODE -ne 0) { throw 'Runtime npm ci failed' }
} else { Write-Host 'Reusing verified runtime packages with unchanged lockfile.' }
# Windows x64 always uses the verified native sharp build; omit the unused static WASM fallback.
$wasm = [IO.Path]::GetFullPath("$runtime/harness/node_modules/@img/sharp-wasm32")
if (!$wasm.StartsWith([IO.Path]::GetFullPath("$runtime/harness/node_modules") + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe optional package path' }
if (Test-Path -LiteralPath $wasm) { Remove-Item -LiteralPath $wasm -Recurse -Force }
& "$runtime/node/node.exe" "$PSScriptRoot/verify-distribution.mjs" $runtime
if ($LASTEXITCODE -ne 0) { throw 'Bundled runtime verification failed' }
$lockHash | Set-Content -LiteralPath $marker -Encoding ascii

& "$runtime/node/node.exe" "$PSScriptRoot/prepare-native-sources.mjs" "$WorkRoot/source-archives"
if ($LASTEXITCODE -ne 0) { throw 'Corresponding source archive generation failed' }
& "$runtime/node/node.exe" "$PSScriptRoot/collect-notices.mjs" $runtime
if ($LASTEXITCODE -ne 0) { throw 'License notice generation failed' }
$resources = @{}
# Tauri 2.9 normalizes resource paths by discarding the Windows drive prefix.
# A local junction gives the bundler relative paths without duplicating runtime files.
$link = Join-Path $repo 'src-tauri/.build-runtime'
if (Test-Path -LiteralPath $link) {
  $item = Get-Item -LiteralPath $link -Force
  if ($item.LinkType -ne 'Junction' -or [IO.Path]::GetFullPath($item.Target) -ne [IO.Path]::GetFullPath($runtime)) { throw 'Existing .build-runtime must be a junction to this staging runtime.' }
} else { New-Item -ItemType Junction -Path $link -Target $runtime | Out-Null }
$resources['.build-runtime/node/'] = 'runtime/node/'
$resources['.build-runtime/harness/'] = 'runtime/harness/'
$resources['.build-runtime/licenses/'] = 'runtime/licenses/'
@{ bundle = @{ resources = $resources } } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$WorkRoot/tauri.runtime.json" -Encoding utf8
Write-Host "Runtime prepared: $runtime"
Write-Host "Tauri override: $WorkRoot/tauri.runtime.json"
