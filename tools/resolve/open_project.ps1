<#
Usage:
  ./tools/resolve/open_project.ps1 --project_root C:/renders/workspace --project_id demo --otio_path C:/tmp/timeline.otio
Example:
  $env:RESOLVE_EXE='C:\Program Files\Blackmagic Design\DaVinci Resolve\Resolve.exe'; ./tools/resolve/open_project.ps1 --project_root B:/Video/.../workspace --project_id intro --manifest_path B:/Video/.../manifest.json
#>
param(
  [Parameter(ValueFromRemainingArguments=$true)]
  [string[]]$ArgsForward
)

if ($env:RESOLVE_EXE -and (Test-Path $env:RESOLVE_EXE)) {
  Start-Process -FilePath $env:RESOLVE_EXE | Out-Null
  Start-Sleep -Seconds 3
} else {
  Write-Host "Resolve binary not launched (set RESOLVE_EXE to enable auto-launch)."
}

python tools/resolve/import_otio.py @ArgsForward
exit $LASTEXITCODE
