# SOP Library Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import, a rich editor, version control with attribution, company-owned organization and search, find in page, and assign plus sign-off that closes the linked task.

**Architecture:** One append-only migration (`0053_sop_library.sql`) carries the schema, stamps, guards and RLS; the browser converts files (mammoth, pdf.js) into the TipTap schema, which is also the read-only renderer; services stay plain async functions with mirrored mocks.

**Tech Stack:** React 19, TypeScript, Tailwind v4 tokens, Supabase (Postgres 16, PostgREST), TipTap 3.35.0, mammoth 1.13.0, pdfjs-dist 5.x, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-sop-library-design.md`

## Global Constraints

- Migration number `0053`; never edit `0001` to `0052`. README "What is applied live" lists `0053` as written, not applied; next free number `0054`.
- Theme tokens only; no hex in components. Copy: calm, plain, no em dashes, industry neutral.
- Every new file opens with a comment saying why it exists. Components PascalCase, default export.
- Each service function gets a mock with the same export in `src/test/mocks/` (parity test).
- Gates before each commit: `npm run lint`, `npx vitest run`, `npm run build`; for SQL, `npm run test:sql`.
- Links: http, https, mailto, tel only.
- Import limits: 50 files a batch, 20 MB a file; types .docx, .pdf, .txt, .md.

## Review Focus

1. A PDF with no text (a scan) must be reported as "No text found", never created as an empty SOP. (Task 7 test.)
2. A sign-off made before a task was assigned must not close that task. (Task 1 SQL test.)
3. A person deleted from the hub: their name clears from versions and from "updated by" without refusing the delete. (Task 1 SQL test.)
4. A legacy Markdown SOP opens in the editor with its headings and lists, and saving appends a JSON version. (Task 4 test.)
5. Search text with punctuation or quotes (`O'Brien's "ladder"`) never errors the query. (Task 3 test of `toPrefixQuery`.)

---

### Task 1: Migration 0053 and its SQL tests

**Files:** Create `supabase/migrations/0053_sop_library.sql`, `supabase/tests/0053_sop_library.test.sql`. Modify `src/types/database.ts`.

**Produces:** tables `sop_categories`, `sop_signoffs`; columns listed in the spec; `tasks.sop_id`; functions `public.set_sop_version()` (redefined), `public.stamp_sop_updated_by()` (redefined), `public.recur_task()` (redefined from 0037 plus `sop_id`), `public.guard_sop_version()`, `public.normalize_sop()`, `public.guard_task_sop()`, `public.close_tasks_on_signoff()`, `public.stamp_sop_signoff()`.

- [ ] Write the SQL tests: an admin creates a JSON version and `body_text`/`sops.search` fill; a member cannot insert a version; a signed-in update of a version is refused; deleting a person clears `author_name` and `updated_by_name`; tags normalize (`' Crane ', 'crane'` becomes `{Crane}`); a member signs off a published SOP and not a draft; a sign-off cannot be inserted for someone else; the sign-off closes the person's open task on the SOP created before it and not one created after; an assignee cannot tick an SOP task done without a sign-off; ticking every step leaves it open; an admin closes it by hand; a recurring SOP task's next copy keeps `sop_id`; categories backfill.
- [ ] Run `npm run test:sql`; expect the new file to fail.
- [ ] Write the migration. Run `npm run test:sql`; expect all pass, including the idempotent re-apply.
- [ ] Update `src/types/database.ts` (Sop, SopVersion, SopCategoryRow, SopSignoff, Task.sop_id). Commit.

### Task 2: Editor schema and document helpers

**Files:** Create `src/lib/sops/schema.ts`, `src/lib/sops/doc.ts`, `src/lib/sops/doc.test.ts`. Add deps `@tiptap/react @tiptap/starter-kit @tiptap/extension-table @tiptap/core @tiptap/pm` pinned `3.35.0`.

**Produces:** `sopExtensions(): Extensions`; `isSafeHref(href: string): boolean`; `htmlToDoc(html: string): JSONContent`; `markdownToHtml(md: string): string`; `docToLines(doc: JSONContent): string[]`; `emptyDoc(): JSONContent`; type `SopDoc = JSONContent`.

- [ ] Tests: `isSafeHref` accepts `https://a.b`, `mailto:x@y.z`, rejects `javascript:alert(1)`; `htmlToDoc('<h2>Purpose</h2><ul><li>One</li></ul><script>x</script>')` has a heading and a bulletList and no script text; `docToLines` returns `["Purpose", "One"]`; `markdownToHtml("## A\n\n1. B")` contains `<h2>` and `<ol>`.
- [ ] Implement; run tests; commit.

### Task 3: Services and mocks

**Files:** Modify `src/services/sops.ts`, `src/test/mocks/sops.ts`, `src/test/fixtures.ts`. Create `src/services/sopCategories.ts`, `src/services/sopSignoffs.ts`, their mocks, `src/lib/sops/search.ts` (+ test).

**Produces:**
- `listSops(companyId, opts?: { query?: string; withText?: boolean }): Promise<Sop[]>`
- `createSop({ company_id, title, category_id, summary?, status?, tags?, body_json, change_note? }): Promise<Sop>`
- `updateSop(id, patch: Partial<Pick<Sop, "title"|"category_id"|"summary"|"status"|"tags">>)`
- `addSopVersion(sopId, companyId, body: { json: SopDoc } | { md: string }, changeNote)`
- `restoreSopVersion(sop: Sop, version: SopVersion): Promise<SopVersion>`
- `listSopCategories`, `createSopCategory`, `updateSopCategory`, `deleteSopCategory`
- `listMySignoffs(companyId, profileId)`, `listSopSignoffs(sopId)`, `signOffSop(sopId, companyId, profileId)`
- `toPrefixQuery(text): string | null`, `snippetFor(text, query, radius = 80): string | null`
- tasks: `TaskInput.sop_id`, `listTasksForSop(companyId, sopId)`.

- [ ] Tests for `toPrefixQuery` (`O'Brien's "ladder"` gives `o:* & brien:* & s:* & ladder:*` or similar with only `[\p{L}\p{N}]` terms; empty gives null) and `snippetFor`. Implement; mocks mirror; parity test passes; commit.

### Task 4: Editor and edit page

**Files:** Create `src/components/sops/SopEditor.tsx`, `src/components/sops/EditorToolbar.tsx`, `src/components/sops/SopDocument.tsx` (read-only render), `src/components/sops/CategoryPicker.tsx`, `src/components/sops/TagInput.tsx`. Rewrite `src/pages/sops/SopEditPage.tsx`. Add `.sop-doc` styles to `src/index.css` with tokens.

- [ ] Test: a legacy Markdown SOP opens with its heading text in the editor; saving calls `addSopVersion` with `{ json }`. Implement; commit.

### Task 5: SOP page

**Files:** Rewrite `src/pages/sops/SopPage.tsx`; create `src/components/sops/FindBar.tsx`, `src/lib/sops/findPlugin.ts`, `src/components/sops/VersionHistory.tsx`, `src/lib/sops/diff.ts` (+ test).

- [ ] Tests: `diffLines(["a","b"],["a","c"])` gives same a, removed b, added c; the page shows "Last updated by"; restore appends a version with note "Restored from v1". Implement; commit.

### Task 6: Library and setup

**Files:** Rewrite `src/components/resources/SopsPanel.tsx`; create `src/components/resources/SopCategoriesPanel.tsx`; modify `resourcesTabs.ts`, `ResourcesPage.tsx`, `App.tsx` (route `/resources/setup`, admins).

- [ ] Tests: filter by category and tag; search shows a snippet; employee sees no status filter. Implement; commit.

### Task 7: Import

**Files:** Create `src/lib/sops/importers.ts` (dispatch, docx, txt, md), `src/lib/sops/pdfImport.ts` (pdf.js wrapper), `src/lib/sops/pdfBlocks.ts` (+ test, pure), `src/pages/sops/SopImportPage.tsx`; route `/sops/import` (admins).

**Produces:** `readSopFile(file: File): Promise<ImportedSop>` with `{ title, doc, notes: string[], error?: string }`; `pdfLinesToHtml(lines: PdfLine[]): string`.

- [ ] Tests: `pdfLinesToHtml` makes a larger line a heading, "• x" a bullet, "1. x" an ordered item, drops a line repeated on every page and bare page numbers; a PDF with no lines returns error "No text found. It may be a scanned image."; a `.doc` file returns "Save it as .docx or PDF first."; import page creates drafts and attaches originals (mocked). Implement; commit.

### Task 8: Sign-off and tasks

**Files:** Create `src/components/sops/SignoffCard.tsx`, `src/components/sops/SopAssignments.tsx`; modify `TaskForm.tsx`, `TaskRow.tsx`, `TaskPage.tsx`.

- [ ] Tests: a member signs off and sees "You signed off v1"; an SOP task row shows "Sign off the SOP" for the assignee instead of a done control; the admin's Assign creates one task per person with `sop_id`. Implement; commit.

### Task 9: Docs and final gates

- [ ] README SOP section, migration list (0053 written, not applied, its redefinitions and re-paste rule), next free `0054`, live function versions (connections v11, notify v10). CLAUDE.md read-order note. Run lint, vitest, build, test:sql; demo screenshot check; commit and push.
