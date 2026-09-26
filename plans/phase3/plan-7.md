# Plan 7 — CSV Import

**Status:** Done
**Depends on:** — (completes the phase-2 export/import loop)
**Estimated effort:** 2 days

---

## Goal

Sellers bulk-import products from CSV: upload → automatic column mapping → **dry-run validation report** → commit. Bad rows never half-import. The import understands the phase-2 export shape out of the box.

## Design

**Two-phase import with a staged file.** The parsed CSV is stored server-side (Redis, key `import:{userId}`, TTL 24h) between the dry-run and the commit — no re-upload, no temp files on disk.

- `parseImportCsv(file)`: accepts `;` or `,` delimiters, quoted fields, BOM. Normalizes headers (lowercase, trim). Recognizes the export columns (`row_kind,title,slug,brand,condition,price_cents,stock,status,variant_title,variant_sku`) plus optional `description,category,summary` for hand-authored files.
- `dryRunImport({ importId, options })`: validates every row without writing; returns a row-by-row report (`valid | error: reason`) + summary counts. Options: `defaultStatus` (draft|active), `updateExisting` (match by slug — updates price/stock only).
- `commitImport({ importId })`: re-validates (data may have changed), inserts/updates in one transaction per 100 rows; returns created/updated counts. New slugs get suffixes on collision (never silently overwrite a different product).
- Variant rows (`row_kind=variant`) attach to the preceding product row by title; a variant row for an unknown product is an error.

## Server functions (`server/import.ts`)

| Function | Auth | Behavior |
| --- | --- | --- |
| `uploadImportCsv(file)` | seller/admin | ≤ 2MB, ≤ 1000 rows; parse + store in Redis; returns `{ importId, headers, mappedFields, rowCount }` |
| `dryRunImport({ importId })` | seller/admin | Full validation; per-row errors with row numbers |
| `commitImport({ importId, defaultStatus, updateExisting })` | seller/admin | Transactional create/update; slug collision → suffix (new) or skip (update-existing mismatch) |
| `getImportReport({ importId })` | seller/admin | Re-fetch the dry-run report |

Ownership: imported products belong to the importing seller's shop (admin imports go to a `shopId` param they choose).

## UI — `/seller/import` (nav entry "Import")

1. **Upload** step: file picker + detected-column preview (first 5 rows).
2. **Mapping** step: dropdown per import field bound to detected columns (auto-matched, editable).
3. **Dry run** step: summary (N valid, M errors) + error table (row #, reason); errors are downloadable as CSV.
4. **Commit** step: options (default status, update existing) + confirm → results.

## Acceptance criteria

- [ ] The phase-2 export file imports 1:1 with zero errors on an empty shop (fresh seller).
- [ ] Row with invalid price / negative stock / oversized title → row-level error in the dry run; commit skips exactly those rows.
- [ ] updateExisting=false: slug collision creates a suffixed new product (original untouched). true: matching slug updates price/stock only.
- [ ] Variant rows attach to their product; unknown-product variant rows are rejected.
- [ ] Commit is atomic per 100-row chunk; a mid-commit failure leaves no partial chunk.
- [ ] ImportId expires after 24h; another user's importId is not accessible (Redis key scoped by user id).
- [ ] >500 rows import in < 5s.

## Explicitly not in this plan

Image import (URLs column), category creation from CSV (must pre-exist), scheduled/recurring imports, undo.

---

## As-built note (2026-09-26)

Two-phase import staged in Redis (24h TTL, per-user key); dry-run report; commit creates draft products with slug suffixes. updateExisting reserved.
