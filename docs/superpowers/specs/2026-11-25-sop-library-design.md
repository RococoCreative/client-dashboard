# SOP library upgrade: design

Date: 2026-11-25. Approved to build overnight by Austin ("work with approval from me to do
whatever you need to build this", approach A for import). Calls made without him are marked
**(my call)** so he can check them.

## Intent

Most companies arrive with a stack of SOPs already written. The library has to take those in
fast, keep them organized as it grows past a hundred documents, let people find a line inside
one, and let an admin assign an SOP to a person and know when they have completed it. It is a
global change: every company gets it, no module switch.

## Goals

1. **Import (the centerpiece).** Upload one or many Word (.docx), PDF, text or Markdown files;
   each becomes a draft SOP with its headings, lists, tables and emphasis kept. Approach A:
   straight conversion in the browser, no outside service, nothing leaves the company's systems.
2. **Editor.** A word-processor style editor with a toolbar replaces the Markdown box.
3. **Version control.** Every save is a permanent version with who saved it, when and why. Any
   version can be read, compared with the current one, and restored (restoring appends a new
   version; history is never rewritten).
4. **Who and when.** Created by, last updated by, and each version's author, shown by name.
5. **Organization.** Categories each company owns (with starters), tags, full-text search,
   filters (category, tag, status, assigned to me, not signed off), and sort.
6. **Search inside an SOP.** A find bar on the SOP page that highlights every match and steps
   through them.
7. **Assign and sign off.** An admin assigns an SOP to people as tasks. The person signs off
   ("I have read this SOP and completed it"), and the database closes their open task for it.

## Non-goals

- Pictures and video stored in the hub. Austin's call (2026-11-25): keep them as links, so nothing
  bloats the database. Links work in the editor; a picture in an older Markdown version becomes a
  link to it. An import still attaches the original file to storage so nothing in it is lost.
- An AI pass on imports (approach B). Not built; the import is shaped so it could be added later.
- Text recognition for scanned PDFs. A PDF with no text is reported, not imported.
- Old binary Word (.doc), Pages, or Google Docs links. The import says to save as .docx or PDF.

## Anti-goals

- Never a second implementation of permissions in the UI: who edits, who signs and what closes a
  task are enforced by the database.
- Never a person's sign-off forged by someone else, or a task closed by a sign-off from before it
  was assigned.
- Never rewrite a version.

## Constraints (from CLAUDE.md)

Theme tokens only; renders with no backend; services throw, callers message; the company wall is
RLS; profiles are people, not accounts; migrations append-only (this is `0053`); a company's shape
is data, never a branch on its name; copy is calm and plain with no em dashes; every file opens
with a comment saying why it exists; mocks mirror services.

## Approaches considered

- **Import, A: convert in the browser (chosen by Austin).** mammoth turns .docx into HTML;
  pdf.js reads PDF text with positions and sizes, from which headings, lists and paragraphs are
  rebuilt; the HTML goes through the editor's own schema. Free, private, works offline of any
  provider. PDFs come in flatter than Word files.
- **Import, B: conversion plus an AI pass.** Faster through a backlog, but a new secret, a cost
  per document, and documents sent to a provider. Not chosen.
- **Editor: TipTap (ProseMirror) (my call).** The standard rich editor for React, schema based
  (so pasted or imported HTML can only become known nodes), stores a JSON document, and the same
  schema renders read-only views. Alternatives (Lexical, Quill, a contentEditable of our own) were
  weaker on tables or on schema-safe import.
- **Search: Postgres full text through PostgREST (my call).** A `search` tsvector on `sops`,
  maintained by trigger, queried with prefix terms. No new public function (rule 4 keeps the only
  public functions the two login lookups). Snippets are cut in the browser from the matched rows.

## Design

### Data (migration `0053_sop_library.sql`)

- `sop_versions` gains `body_json jsonb` (the editor document) and `body_text text` (plain text,
  derived by the database from `body_json` or `body_md`, never sent by the app). `body_md`
  becomes nullable; one of the two bodies is required. Each version gains `author_profile_id`
  and `author_name`, stamped by the database from the signed-in person. A guard refuses any
  change to a version by a signed-in writer (rule 9 held in the database), letting through only
  a deleted person's or account's foreign keys clearing (their name clears with them, as 0049
  does elsewhere).
- `sops` gains `category_id` (company-owned category, null is Uncategorized), `tags text[]`
  (trimmed, deduplicated case-insensitively, at most 20, each up to 40 characters, by trigger),
  `body_text` (the current version's text, kept by `set_sop_version`), `search tsvector` (title
  A, tags and summary B, body C, english), `created_by_profile_id`, `created_by_name`,
  `updated_by_profile_id`, `updated_by_name`, all stamped by the database. The legacy `category`
  column stays, unused by the new app.
- `sop_categories` (company_id, name, sort_order, retired_at): members read, admins write, unique
  name per company case-insensitively. Backfill: each company gets a row for each legacy category
  its SOPs use, and those SOPs point at it.
- `sop_signoffs` (company_id, sop_id, profile_id, version, signer_name, signed_at): the person
  inserts their own, only on a published SOP; the database stamps version, name and time. The
  person and the company's admins read. No update or delete by anyone signed in; it goes with
  the person (cascade) or the SOP.
- `tasks.sop_id` (on delete set null). A separate guard on tasks: the SOP must be the company's
  and published when linked; a task on an SOP is completed by the assignee only through a
  sign-off made after the task was created (an admin who manages the company may still close it
  by hand); a step ticked on such a task never closes it early. `recur_task` copies `sop_id`.
- After a sign-off insert, the database closes that person's open tasks on that SOP created at or
  before the sign-off, stamping them as completed by the person.

### Who may do what

| Action | Who |
| --- | --- |
| Read a published SOP, search, find in page | Every member |
| Read drafts and archived, edit, import, publish, restore a version, categories, tags | Owners, admins, Rococo (`can_manage_company`), as today |
| Sign off | The person themselves, on a published SOP |
| Read sign-offs | The person (own), admins (all) |
| Assign an SOP (create tasks) | As tasks allow today; offered from the SOP page to admins when the company has the `tasks` module |

### Screens

- **Resources > SOPs (library).** Search (full text, prefix), filters for category, tag, status
  (admins), assigned to me and not signed off (when the person has a profile), sort by recently
  updated or A to Z. Filters live in the URL. Rows show title, summary or a search snippet,
  category, tags, version, updated date and by whom, status (admins), and the person's own
  sign-off state. Admins get New SOP and Import.
- **Resources > Setup (admins).** SOP categories: add, rename, reorder, retire, delete (its SOPs
  become Uncategorized). Follows Reviews > Setup's deliverable categories.
- **SOP page.** Rendered document, created and updated by, category and tags, find bar, version
  history (view any, compare with current, restore), attachments, sign-off card for members,
  and for admins the sign-offs and open assignments with Assign (tasks module).
- **Edit page.** Title, category (with starters offered), tags, summary, status, the editor with
  a toolbar (paragraph style, bold, italic, underline, strike, lists, quote, divider, link,
  table, undo, redo, clear formatting), change note.
- **Import page (`/sops/import`).** Drop or pick files (up to 50, 20 MB each). Each is read and
  shown with its title, the category and tags to file it under (one choice for the batch,
  changeable per file), and anything worth knowing (images left out, the original attached). Create
  drafts makes each SOP, its first version, and attaches the original file. Results per file.
- **Tasks.** A task linked to an SOP links to it; the assignee's done control becomes "Sign off
  the SOP"; the task form offers an SOP to link (published only).

### Decisions made without Austin **(my call)**

- Sign-off is a checkbox ("I have read this SOP and completed it") and a button, stamped with the
  person's name. No typed signature. Confirmed by Austin on 2026-11-25, who added: it saves to the
  person's profile so managers and above see it. Built as a record on the person, on their
  Overview, read by the 0038 rule (the person, their managers up the chain, the admins over them).
- A sign-off is for the version signed. When the SOP changes, the person's earlier sign-off reads
  "Signed v2, now v4" and they may sign again; nothing is forced. Assigning again is how an admin
  asks for a fresh sign-off: a task only closes on a sign-off made after it was assigned.
- Starter categories are the five that exist today (Safety, Process, Client, Admin, Field).
- Links allow http, https, mailto and tel only.

## Left to the builder

Component layout inside these screens, the PDF heuristics' thresholds, toolbar icon choice, and
test coverage beyond the rules above.
