# People Access Lightbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the People roster's loose invitation buttons with one "Access" button per row that opens a lightbox holding the person's invitation, pause and end-access controls.

**Architecture:** The Setup tab's Account block is split into a section-free `AccountControls` that both the Setup tab and a new `PersonAccessDialog` render. The invitation actions (send, copy link, email again, cancel) move from `PeoplePage` into the dialog, which reports changes back to the roster through callbacks so the roster updates in place.

**Tech Stack:** React 19, TypeScript, Tailwind v4, Vitest + Testing Library, the `Modal`, `Button`, `ConfirmDialog`, `Notice` primitives.

**Spec:** `docs/superpowers/specs/2026-11-27-people-access-lightbox-design.md`

## Global Constraints

- The button reads "Access"; the dialog title reads "Access for {displayName}".
- No database, service or permission change. Who may do what is exactly today's rule.
- Theme tokens only, shared primitives only, every file opens with a why-comment, no em dashes in copy.
- Destructive buttons keep their words ("Cancel invitation", "Remove", "Delete person"); `final-fix.test.tsx` pins it.
- Managers (`teamView`) see no Access button.
- Gates before every commit: `npm run lint`, `npx vitest run`, `npm run build`.

## Review Focus

- A row whose invitation was just cancelled in the dialog: Remove becomes available in the same open dialog without reopening it (Task 2 test).
- An email that fails inside the dialog: the warning line shows in the dialog and the invitation stays (Task 2 test, moved from `invite-emails.test.tsx`).
- Deleting from the dialog: the dialog closes, the row goes, "{name} was deleted." shows, and the URL stays `/people` (Task 3 test).
- Deactivating from the dialog: the row's badge turns Inactive and the row hides unless Show inactive is on (Task 3 test).
- The cancel-invitation confirm stacks over the Access dialog: Escape closes only the confirm (Task 2 test).

---

### Task 1: Split `AccountControls` out of the Setup tab's Account block

**Files:**
- Modify: `src/components/people/person/PersonAccountActions.tsx`
- Test: `src/components/people/person/PersonAccountActions.test.tsx` (create)

**Interfaces:**
- Produces:
  ```ts
  export type AccessGone = { kind: "removed" | "deleted"; name: string };
  export function AccountControls(props: {
    companyId: string;
    person: Profile;
    counts?: ProfileCounts;
    onPatch: (patch: ProfilePatch) => Promise<boolean>;
    // Omitted: navigate to /people as today (Setup tab). Given: called instead of navigating.
    onGone?: (gone: AccessGone) => void;
    // undefined: read invitations itself as today. Given (null or one): use it, read nothing.
    pendingInvitation?: Invitation | null;
  }): JSX.Element;
  ```
  The default export `AccountActions` keeps its props and renders `<Section eyebrow="Hub access" title="Account"><AccountControls … /></Section>`.

- [ ] **Step 1: Write failing tests** in the new test file, using `renderWithHub` and the services mocks like `qa-b4.test.tsx`:
  - `"calls onGone instead of leaving the page after a delete"`: render `AccountControls` for a signed-in employee as an admin with `onGone={spy}`; click "Delete person", type the full name, confirm; expect `spy` called with `{ kind: "deleted", name: <full name> }`.
  - `"uses the invitation it is given and reads none"`: render with `pendingInvitation={someInvitation}` for a never-signed-in person; expect the text "Cancel their invitation above first, then remove them." and `listInvitations` mock not called.
  - `"offers Remove when it is given no pending invitation"`: `pendingInvitation={null}`; expect button "Remove {name}".
- [ ] **Step 2: Run** `npx vitest run src/components/people/person/PersonAccountActions.test.tsx`; expect FAIL (no named export `AccountControls`).
- [ ] **Step 3: Implement.** Move the body (everything inside today's `<Section>`) into `AccountControls`. `remove()` and `deleteForGood()` call `onGone({ kind, name: fullName })` when given, else navigate as today. When `pendingInvitation !== undefined`, skip `listInvitations` (pass `mayRemove && pendingInvitation === undefined` into the useAsync guard) and use it as `invitation`; its pending line reads "{first} has a pending invitation. Cancel their invitation above first, then remove them." Setup's line stays as today.
- [ ] **Step 4: Run** the new test file and `npx vitest run src/pages/qa-b4.test.tsx`; expect PASS.
- [ ] **Step 5: Commit** "Split the Account controls out of the Setup section".

### Task 2: `PersonAccessDialog`

**Files:**
- Create: `src/components/people/PersonAccessDialog.tsx`
- Test: `src/components/people/PersonAccessDialog.test.tsx`

**Interfaces:**
- Consumes: `AccountControls`, `AccessGone` (Task 1); `createInvitation`, `deleteInvitation`, `emailInvitation` from `services/invitations.ts`; `updateProfile` from `services/profiles.ts`; `inviteLink` (where PeoplePage imports it today).
- Produces:
  ```ts
  export default function PersonAccessDialog(props: {
    companyId: string;
    companySlug: string;
    person: Profile;
    invitation: Invitation | null;      // the roster's pending invitation for this person
    canInvite: boolean;                 // today's Send invite rule: canChange && is_active
    onInvitationCreated: (invitation: Invitation) => void;
    onInvitationCancelled: (invitationId: string) => void;
    onPatched: (next: Profile) => void;
    onGone: (gone: AccessGone) => void;
    onClose: () => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Write failing tests:**
  - `"titles itself for the person and links to their profile"`: heading "Access for Kai Bennett", link "Open profile" to `/people/{id}`.
  - Status line, one assertion each: account and active, "Active. They sign in as {email}."; no account, invitation, "Invited. Waiting for them to sign in."; no account, no invitation, "Not invited yet."; inactive, "Inactive. They cannot sign in, and their record is kept."
  - Move the `describe("Send invite")` and `describe("Email again")` cases from `invite-emails.test.tsx` here, rendering the dialog directly; same expected lines ("Invitation emailed to …", the warning text, the 10 minute pacing).
  - `"cancels an invitation and then offers Remove in the same dialog"`: click "Cancel invitation for {name}", confirm; expect `onInvitationCancelled` called with the id, and button "Remove {name}" now present (the parent re-renders with `invitation={null}`; use a small stateful wrapper in the test).
  - `"Escape on the cancel confirm closes only the confirm"`.
- [ ] **Step 2: Run** `npx vitest run src/components/people/PersonAccessDialog.test.tsx`; expect FAIL (module missing).
- [ ] **Step 3: Implement.** `Modal` (size "md", `labelledBy="access-title"`), padded `p-6`. Order: title; status line (`secondaryClass`); invitation block (Send invite, or Copy link + Email again + Cancel invitation, as on the roster today, with today's aria-labels, busy flags, copied state and email line rendered as a `Notice` inside the dialog); `border-t` divider; `AccountControls` with `pendingInvitation={invitation}`, `onGone`, and `onPatch` = `updateProfile(person.id, patch)` then `onPatched(next)`, error shown as a `Notice`, returning true or false; footer row with "Open profile" (`Link`) left and a secondary "Done" button right. The cancel `ConfirmDialog` copy and error handling move here unchanged. Copy the handlers `linkFor`, `copyLink`, `emailIt`, `sendInvite`, `handleCancelInvite` from PeoplePage, replacing `state.setData` with the callbacks.
- [ ] **Step 4: Run** the dialog tests; expect PASS.
- [ ] **Step 5: Commit** "Add the Access dialog for a person's hub access".

### Task 3: One Access button on the roster

**Files:**
- Modify: `src/pages/people/PeoplePage.tsx`
- Modify tests: `src/pages/pages.test.tsx`, `qa-b4.test.tsx`, `invite-emails.test.tsx`, `phone-pass.test.tsx`, `final-fix.test.tsx`, `hub-clarity-people.test.tsx`
- Modify: `src/pages/table-fit.test.tsx` only if its guard trips (it should not).

**Interfaces:**
- Consumes: `PersonAccessDialog` (Task 2).

- [ ] **Step 1: Update tests first.** Add a helper in each affected file (or `src/test/` if one exists for the roster) `openAccess(user, name)` that clicks button `Access for {name}` and returns the dialog. Rewrite each row-button lookup to go through it. New cases in `pages.test.tsx`:
  - `"gives every row the viewer may change one Access button"`: rows for an employee with an account, an invited person and a not-invited person each have exactly one button, named `Access for {name}`, text "Access"; the viewer's own row has none.
  - `"deletes from the Access dialog and stays on the roster"`: open Access on a signed-in employee, Delete person, type name, confirm; the dialog closes, the row is gone, "{name} was deleted." shows, path still `/people`.
  - `"deactivates from the Access dialog"`: Deactivate; row hidden; Show inactive on shows it with Inactive.
  - Keep `"leaves the actions for someone ranked above an admin to an owner or Rococo"` asserting no Access button on the owner row for an admin, and one for Rococo.
- [ ] **Step 2: Run** `npx vitest run src/pages`; expect FAIL on the new lookups.
- [ ] **Step 3: Implement.** Row action cell: one `Button variant="secondary" size="sm"` with text "Access", `aria-label={\`Access for ${displayName(person)}\`}`, shown when `!teamView && !self && (canChange || invitation !== null) && (!person.is_rococo_admin || profile.is_rococo_admin)`; drop the inline invitation buttons and the 2-up grid from #16 (keep `lg:w-px` and the pinned column). Remove the invitation handlers and state now in the dialog (`cancelling`, `copied`, `inviting`, `emailing`, `emailLine`, `busy`, `dialogError`, the cancel `ConfirmDialog`). Add `const [accessFor, setAccessFor] = useState<string | null>(null)` (a person id, so the dialog reads the live row) and render `PersonAccessDialog` with callbacks that `state.setData` invitations and people; `onGone` closes it, drops the person and sets the deleted or removed line (make `deletedLine` state settable: "{name} was deleted." or "{name} was removed."). Footer copy: replace "To deactivate or remove someone, open them and go to Setup." with "Access on each row sends or cancels an invitation, pauses someone, or removes them." and "Copy link and Email again stay on their row until they sign in" with "Copy link and Email again stay under Access until they sign in".
- [ ] **Step 4: Run** `npm run lint && npx vitest run && npm run build`; expect all pass.
- [ ] **Step 5: Visual check** on `npm run demo` (port 4173), `/people?persona=admin&company=rba&load=dense` at 1440, 1024 and 390: one Access button per eligible row, nothing cut off, no sideways page scroll; open the dialog on an invited, a not-invited and an active person and screenshot each.
- [ ] **Step 6: Commit** "Give each roster row one Access button".
