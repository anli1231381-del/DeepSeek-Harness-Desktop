$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  if ($request.operation -eq 'protect') {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($request.value)
    [Console]::Out.Write([Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)))
  } elseif ($request.operation -eq 'unprotect') {
    $bytes = [Convert]::FromBase64String($request.value)
    [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString([System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)))
  } else { exit 1 }
} catch { exit 1 }
