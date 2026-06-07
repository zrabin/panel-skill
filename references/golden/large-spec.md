# Feature Spec: Workspace Data Export

**Owner:** Platform team
**Status:** Draft → seeking approval to build
**Sizing:** M

## 1. Summary

Workspace admins need to export their workspace's activity data (members,
projects, comments, file metadata, and audit events) as a CSV bundle so they can
run their own analysis, satisfy internal reporting requirements, and migrate to
other tools. Today there is no self-serve export; admins file support tickets and
an engineer runs a manual query, which takes 2–3 business days per request.

This feature adds a one-click "Export workspace data" action in workspace
settings that generates the bundle and emails the admin a download link.

## 2. User Job

As a workspace admin, I want to export my workspace's data on demand so that I
can analyze it and meet my company's reporting obligations without waiting on
support.

## 3. High-Level Requirements

- An admin can trigger a full-workspace export from Settings → Data.
- The export includes: members, projects, comments, file metadata, and the
  workspace audit-event history.
- The export is delivered as a single ZIP of CSV files.
- The admin receives an email with a link to download the bundle.
- Only workspace admins (not regular members) can trigger or download an export.

## 4. Functional Requirements

### 4.1 Triggering an export
- Settings → Data shows an "Export workspace data" button.
- Clicking it creates an export job and shows a "We'll email you when it's ready"
  toast.
- The button is visible to admins only; regular members do not see it.

### 4.2 Generating the bundle
- A backend worker queries each data type for the workspace, writes one CSV per
  type, and zips them together.
- The worker generates the full bundle in a single pass and uploads the resulting
  ZIP to the `workspace-exports` S3 bucket.
- The download link points directly at the S3 object via a signed URL.

### 4.3 Data included per CSV
- `members.csv`: name, email, role, joined_at, last_active_at.
- `projects.csv`: id, name, owner, created_at, status.
- `comments.csv`: id, author email, project_id, body, created_at.
- `files.csv`: id, filename, uploader email, size_bytes, created_at.
- `audit_events.csv`: id, actor email, action, target, occurred_at.

### 4.4 Delivery
- When the bundle is ready, send the admin an email containing the signed
  download link.
- The signed link is valid for 24 hours.
- The exported bundle is retained in S3 for 30 days, after which it is deleted.

### 4.5 API
- `POST /api/v1/workspaces/{id}/exports` — creates an export job, returns
  `{ job_id }`. Admin-only.
- `GET /api/v1/workspaces/{id}/exports/{job_id}` — returns job status
  (`pending` | `running` | `ready` | `error`).
- The export endpoint kicks off the worker immediately on request.

## 5. UX / UI

- Settings → Data gets a new "Export workspace data" section with a short
  description and the export button.
- After triggering, the section shows the most recent export's status and, when
  ready, an in-app download link in addition to the email.
- Empty state (no prior exports): just the button and description.

## 6. Data Handling & Retention

- Export bundles contain member and commenter email addresses and comment bodies.
- Bundles are stored in the `workspace-exports` bucket and kept for 90 days so
  admins who lose the email can still retrieve a recent export.
- Signed URLs expire after 24 hours; generating a new link requires re-running
  the export.

## 7. Acceptance Criteria

- AC1: An admin can trigger an export and receives an email with a working
  download link.
- AC2: A regular (non-admin) member cannot trigger or download an export.
- AC3: The exported ZIP contains one CSV per data type with the columns listed
  in 4.3.
- AC4: Exports should be fast and the system should handle large workspaces
  gracefully.
- AC5: The download link stops working after it expires.

## 8. Out of Scope

- Scheduled / recurring exports (future).
- Per-data-type or filtered exports (future) — v1 is full-workspace only.
- Re-importing an exported bundle into another workspace.

## 9. Open Questions

- Should we support CSV and JSON, or CSV only for v1? (Leaning CSV only.)
