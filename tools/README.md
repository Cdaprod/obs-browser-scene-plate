# Tools: Resolve + Blender Artifact Import

Helpers in this directory consume artifact files only (`.otio`, `manifest.json`) and map media into structured Resolve bins / Blender collections.

## Export OTIO into project `_exports`

```sh
curl -X POST http://localhost:8791/api/exports/otio \
  -H "Content-Type: application/json" \
  -d '{"project_id":"intro-a7914d7c","name":"timeline","render_plan":{"fps":60,"nodes":[{"id":"n1","duration":4,"layers":[{"role":"base","url":"http://nginx/plate-default.html"}]}]}}'
```

Default output path when `output_path` is omitted:
`workspace/projects/<project_id>/_exports/<name>.otio`

## Resolve importer

```sh
python tools/resolve/import_otio.py \
  --project_root B:/Video/Projects/P7-SHARED-Procedurally-Generated/ingest/originals/workspace \
  --project_id intro-a7914d7c \
  --otio_path B:/Video/Projects/P7-SHARED-Procedurally-Generated/ingest/originals/workspace/projects/intro-a7914d7c/_exports/timeline.otio
```

Bin structure created (idempotent):
- `Projects/<project_id>/Ingest/Originals`
- `Projects/<project_id>/Plates`
- `Projects/<project_id>/Exports`

Wrapper:
```sh
tools/resolve/open_project.sh --project_root <workspace_root> --project_id <project_id> --otio_path <path/to/timeline.otio>
```

Windows wrapper:
```powershell
./tools/resolve/open_project.ps1 --project_root <workspace_root> --project_id <project_id> --otio_path <path/to/timeline.otio>
```

## Blender importer

```sh
blender --python tools/blender/import_sequence.py -- \
  --project_root B:/Video/Projects/P7-SHARED-Procedurally-Generated/ingest/originals/workspace \
  --project_id intro-a7914d7c \
  --manifest_path B:/Video/Projects/P7-SHARED-Procedurally-Generated/ingest/originals/workspace/projects/intro-a7914d7c/exports/<job_id>/manifest.json
```

Collections created (idempotent):
- `Projects/<project_id>/Plates`
- `Projects/<project_id>/Originals`
- `Projects/<project_id>/Exports`

Wrapper:
```sh
tools/blender/open_scene.sh --project_root <workspace_root> --project_id <project_id> --manifest_path <path/to/manifest.json>
```

Windows wrapper:
```powershell
./tools/blender/open_scene.ps1 --project_root <workspace_root> --project_id <project_id> --manifest_path <path/to/manifest.json>
```

## Tests

```sh
python -m unittest tools.tests.test_artifact_import
```
