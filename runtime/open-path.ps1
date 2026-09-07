$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$target = [string]$request.path
if (!(Test-Path -LiteralPath $target)) { throw '文件或目录不存在' }
if ($request.directory) {
  Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $target + '"') -WindowStyle Normal
} elseif ([IO.Path]::GetExtension($target).ToLowerInvariant() -in @('.txt','.md','.json','.js','.mjs','.ts','.tsx','.jsx','.py','.ps1','.sh','.bat','.cmd','.html','.css','.xml','.yaml','.yml','.toml','.rs','.c','.cpp','.h','.log','.sql','.csv')) {
  Start-Process -FilePath 'notepad.exe' -ArgumentList ('"' + $target + '"') -WindowStyle Normal
} elseif ([IO.Path]::GetExtension($target).ToLowerInvariant() -in @('.pdf','.png','.jpg','.jpeg','.gif','.webp','.bmp','.docx','.xlsx','.pptx','.mp4','.mp3','.wav')) {
  Start-Process -FilePath $target -WindowStyle Normal
} else {
  Start-Process -FilePath 'explorer.exe' -ArgumentList ('/select,"' + $target + '"') -WindowStyle Normal
}
