_From security audit `sample-run-2026-11-01` at `0123456789abcdef0123456789abcdef01234567`. Fingerprint `web-needs-sample-upload-limit`._

The upload route might accept very large files.

**Needs validation.** There is no severity until the blockers below are resolved.

### Claimed root cause

The body parser limit is not set in src/web/upload.ts.

### Trace

- **entrypoint** `src/web/upload.ts:9` (upload): The route streams the body to disk.

### Evidence

- `src/web/upload.ts:12`: No limit option is passed to the parser.

### Blockers

- The reverse proxy in front of the service may already cap the body size.

### How to resolve

- Local check: Post a 2 GB file to a local run.
- Check on the deployment: Ask the owner what the proxy allows.
