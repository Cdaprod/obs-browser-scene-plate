<#
Usage:
  ./tools/blender/open_scene.ps1 --project_root C:/renders/workspace --project_id demo --otio_path C:/tmp/timeline.otio
Example:
  $env:BLENDER_EXE='C:\Program Files\Blender Foundation\Blender 4.2\blender.exe'; ./tools/blender/open_scene.ps1 --project_root B:/Video/.../workspace --project_id intro --manifest_path B:/.../manifest.json
#>
param(
  [Parameter(ValueFromRemainingArguments=$true)]
  [string[]]$ArgsForward
)

if (-not $env:BLENDER_EXE -or -not (Test-Path $env:BLENDER_EXE)) {
  Write-Host "Set BLENDER_EXE to your Blender executable path."
  exit 2
}

& $env:BLENDER_EXE --python tools/blender/import_sequence.py -- @ArgsForward
exit $LASTEXITCODE
