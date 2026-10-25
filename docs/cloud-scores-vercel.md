# Public cloud scores on Vercel

The cloud service is optional. NoteRain remains fully usable when these variables
are absent or the API is unavailable.

## Services

- Vercel Blob stores the original score and `metadata.json` sidecar.
- Neon/Vercel Postgres is a rebuildable fuzzy-search index.
- Vercel Functions under `api/cloud/` expose capability, upload, search, download,
  and index rebuild endpoints.

  The public download URL `/api/cloud/scores/:id/download` is explicitly rewritten
  to the static Function `/api/cloud/download?id=:id`. This avoids relying on
  framework-specific dynamic route filenames in a Vite project.

  The supplied Blob store may be private. The score catalogue remains public through
the API, while downloads are streamed by the public download Function.

## Environment

```env
VERCEL_READ_WRITE_TOKEN=...
# Optional alias used by the Blob SDK:
BLOB_READ_WRITE_TOKEN=...
POSTGRES_URL=...
CLOUD_ADMIN_SECRET=...
CLOUD_MAX_FILE_SIZE=52428800
VITE_CLOUD_API_URL=
```

Do not commit `.env.local`; it is ignored by Git.

## Behaviour

- Every successful local import is queued for a silent background upload.
- Failed uploads never block local import or playback and retry with backoff.
- Original `midi`, `musicxml`, `mxl`, and `noterain` files are preserved unchanged.
- Immutable `scores/{sha256}/versions/{uploadId}/metadata.json` sidecars contain
  enough metadata to rebuild Postgres without relying on overwrite consistency.
- The cloud import menu is shown only when `/api/cloud/capabilities` reports search
  as available.

## Rebuild the index

```sh
curl -X POST \
  -H "x-cloud-admin-secret: $CLOUD_ADMIN_SECRET" \
  https://your-domain.example/api/cloud/admin/rebuild-index
```

The endpoint scans every private `metadata.json` sidecar and upserts the public
search index.