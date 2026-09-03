param([ValidateSet('dev','build','check','bundle')][string]$Mode = 'dev', [string]$DistributionRoot = '', [string]$BuildRoot = $env:HARNESS_DESKTOP_BUILD_ROOT)
$ErrorActionPreference = 'Stop'
if ($BuildRoot -and (Test-Path -LiteralPath "$BuildRoot/cargo/bin/cargo.exe")) {
  $env:CARGO_HOME = "$buildRoot/cargo"
  $env:RUSTUP_HOME = "$buildRoot/rustup"
  $env:CARGO_TARGET_DIR = "$buildRoot/target"
  $env:PATH = "$buildRoot/cargo/bin;$env:PATH"
  $env:TEMP = "$buildRoot/temp"
  $env:TMP = "$buildRoot/temp"
}
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if ($Mode -in @('build','bundle')) {
  # Release diagnostics use portable source labels, never the builder's personal directories.
  [string[]]$rustFlags = if ($env:CARGO_ENCODED_RUSTFLAGS) { @($env:CARGO_ENCODED_RUSTFLAGS -split [char]31) } elseif ($env:RUSTFLAGS) { @($env:RUSTFLAGS.Trim() -split '\s+') } else { @() }
  $profileRoot = [Environment]::GetFolderPath('UserProfile')
  $pathMappings = @(
    @($profileRoot, '/user'),
    @($(if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $profileRoot '.cargo' }), '/cargo'),
    @($(if ($env:RUSTUP_HOME) { $env:RUSTUP_HOME } else { Join-Path $profileRoot '.rustup' }), '/rustup'),
    @((Get-Location).Path, '/app'),
    @($env:CARGO_TARGET_DIR, '/build')
  )
  foreach ($mapping in $pathMappings) {
    if (!$mapping[0]) { continue }
    $path = [IO.Path]::GetFullPath($mapping[0])
    foreach ($form in @($path, $path.Replace('\','/')) | Select-Object -Unique) { $rustFlags += "--remap-path-prefix=$form=$($mapping[1])" }
  }
  $env:CARGO_ENCODED_RUSTFLAGS = $rustFlags -join [char]31
}
if ($Mode -eq 'check') { cargo check --manifest-path src-tauri/Cargo.toml }
elseif ($Mode -eq 'bundle') {
  if (!$DistributionRoot) { $DistributionRoot = if ($BuildRoot) { Join-Path $BuildRoot 'distribution' } else { Join-Path $env:TEMP 'harness-desktop-distribution' } }
  & "$PSScriptRoot/prepare-distribution.ps1" -WorkRoot $DistributionRoot
  npm.cmd run tauri -- build --config "$DistributionRoot/tauri.runtime.json"
  if ($LASTEXITCODE -ne 0) { throw 'Tauri installer build failed' }
}
elseif ($Mode -eq 'build') { npm.cmd run tauri -- build --no-bundle }
else { npm.cmd run tauri -- dev }
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($Mode -in @('build','bundle')) {
  $target = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path (Get-Location).Path 'src-tauri/target' }
  node "$PSScriptRoot/verify-release.mjs" (Join-Path $target 'release/harness-desktop.exe')
}
exit $LASTEXITCODE
