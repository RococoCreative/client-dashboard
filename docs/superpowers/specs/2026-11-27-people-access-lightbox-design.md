# People roster: one Access button and a lightbox

Short design, approved 2026-11-27.

## Intent

The People roster's last column held loose invitation buttons (Send invite, or Copy link, Email again
and Cancel invitation) whose number changed row to row, while pausing and ending someone's access lived
only on the person's Setup tab. The owner wants one deliberate control per row that opens everything
about that person's hub access in one place, so the table reads clean and every action feels intended.
Global: the three companies share the page, so it is one change for all of them.

## Goals

- One "Access" button per row the viewer may change, the same width on every row.
- A lightbox titled "Access for {name}" holding: a status line (Active, Invited, Not invited yet,
  Inactive); the invitation controls (Send invite, or Copy link, Email again, Cancel invitation);
  Deactivate or Reactivate; Remove (never signed in) or Delete person; an "Open profile" link.
- The roster updates in place after any action, including a delete (the row goes, the page stays).

## Non-goals

- Role, divisions and reports-to stay on the Setup tab (option B was declined).
- No database, service or permission change. Who may do what is exactly what it is today.

## Anti-goals

- A second copy of the account controls that drifts from Setup's.
- A label that changes per row ("Invite", "Invited"), which brings back the uneven column.
- An Access button that opens to nothing: no button on your own row, on anyone ranked above you, or on
  a Rococo admin unless you are Rococo. Managers still see no row actions.

## Approaches

- **Reuse the Account controls in the lightbox (picked).** The Setup tab's Account block and the
  lightbox render the same controls, so the rules and confirm copy (Delete's typed name) live once.
- **Account plus quick edits (declined).** Repeats most of Setup and gives two places to change a role.
- **Name "Manage" or "Account" (declined).** "Manage" reads too broad; "Account" is wrong for the half of
  a new roster with no account yet (a profile is a person, not an account).

## Builder's calls

- The Setup tab's Account section keeps working through the same component, with an `onDeleted` hook
  so the roster can drop a row where the person page navigates away.
- The roster's footer copy points at Access instead of "open them and go to Setup".
- Tests that pressed the row's invitation buttons open Access first; the destructive buttons keep
  their words.
