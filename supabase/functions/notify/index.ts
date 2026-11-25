// The hub's two emails, both sent through Resend from here, the only place the Resend key lives.
//
// The task assignment email. After the app saves a task with a new assignee, it calls this
// function; the function decides whether an email is due, claims the send in one statement so it
// can never go twice for one assignment, and sends one plain email. The browser can never write
// notified_assignee_id itself.
//
// The invitation email. After an admin creates an invitation on the People page, or presses Email
// again on one still waiting, the app calls this function; it sends the invited address one plain
// email with a link to the sign-in screen, pre-filled with that address. It goes only to one plain
// address, never for an invitation already accepted or for a person who is inactive, and at most
// once in 10 minutes per invitation: the send is claimed on invitations.last_emailed_at (0048),
// which no signed-in writer can touch, and the claim is put back if the send fails.
//
// Routes, each deployed with the gateway's JWT check on, and each answering { error } with a
// non-2xx status when something stops it:
//   POST /functions/v1/notify { task_id } -> { sent: boolean, reason?: string }. The caller is the
//     signed-in person who saved the task, and must be able to see it under row level security.
//     Only the person who created the task, an owner or admin of its company, or a Rococo admin
//     (as the database defines one, _shared/rococoAdmin.ts) can have its email sent; anyone else who can see the task gets { sent: false, reason }.
//   POST /functions/v1/notify { invitation_id } -> { sent: boolean, reason?: string }. The caller
//     must be able to see the invitation under row level security (an admin over the person it is
//     for), and only an owner or admin of its company, or a Rococo admin, can have it sent; anyone
//     else gets { sent: false, reason }.
// A body carrying both, or neither, is refused with a 400.
//
// Environment (Supabase secrets): RESEND_API_KEY, TASKS_FROM_EMAIL (the sending address), and
// APP_URL (the app's own address, which every link in either email starts from; an https or http
// URL). SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { NO_STORE } from "../_shared/headers.ts";
import { isRococoAdmin } from "../_shared/rococoAdmin.ts";

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const TASKS_FROM_EMAIL = (Deno.env.get("TASKS_FROM_EMAIL") ?? "").trim();
const APP_URL = (Deno.env.get("APP_URL") ?? "").trim();

const NOT_SET_UP = "Task emails are not set up yet.";
const EMAILS_NOT_SET_UP = "Emails are not set up yet.";
const RESEND_PAUSE_MS = 10 * 60 * 1000;
// One plain address, the same pattern 0048 holds invitations.email to: no display name, no angle
// brackets, no second address, and a domain of letters, digits and hyphens.
const PLAIN_ADDRESS = /^[^\s@<>,;:"()[\]\\]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Every answer says not to keep it: each one is about a person, a task or an invitation.
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, ...NO_STORE, "Content-Type": "application/json" } });

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const service = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, noSession);

// "2026-11-17" -> "November 17, 2026", read from the parts so no time zone can shift the day.
function formatDue(value: string | null): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${Number(match[3])}, ${match[1]}` : null;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// A display name that cannot break the From header: no quotes, angle brackets, backslashes or
// line breaks.
const displayName = (name: string) => name.replace(/["<>\\\r\n]/g, " ").replace(/\s+/g, " ").trim() || "Company Hub";

const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

// The origin every link starts from, the task link and the invitation link alike: the APP_URL
// secret only, never anything the caller sends, so a company-branded email can only ever link to
// the app.
function appUrl(): string | null {
  if (!APP_URL) return null;
  try {
    const url = new URL(APP_URL);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

// 2. The caller, under their own JWT and the same row level security the app lives under. Both
// emails start here. Whether they are a Rococo admin is asked only when it matters, and answered
// exactly as the database defines one (private.is_rococo_admin, 0051), the same rule the
// connections function holds: an active, flagged profile whose address is the account's own,
// confirmed, and on the list, read as the caller. The profile's flag alone is never enough.
async function signedInCaller(req: Request) {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw new HttpError(401, "Sign in first.");
  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } }, ...noSession });
  const { data: userData, error: userError } = await asUser.auth.getUser(jwt);
  if (userError || !userData.user) throw new HttpError(401, "Sign in first.");
  const user = userData.user;
  const { data: caller } = await asUser.from("profiles").select("id, full_name, is_active, role, company_id, is_rococo_admin, email").eq("user_id", user.id).maybeSingle();
  if (!caller || caller.is_active !== true) throw new HttpError(403, "Your profile is not active.");
  const account = { email: user.email ?? null, emailConfirmed: Boolean(user.email_confirmed_at) };
  const isRococo = () =>
    isRococoAdmin(caller, account, async (email) => {
      const { data, error } = await asUser.from("rococo_admins").select("id").eq("email", email).maybeSingle();
      return !error && Boolean(data);
    });
  return { asUser, caller, isRococo };
}

async function handleTask(req: Request, body: { task_id?: unknown } | null): Promise<Response> {
  const taskId = typeof body?.task_id === "string" ? body.task_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw new HttpError(400, "Send the task to notify about.");

  const { asUser, caller, isRococo } = await signedInCaller(req);

  // 3. The task, read as the caller: if they cannot see it, nothing is sent.
  const { data: task } = await asUser.from("tasks").select("id, company_id, title, due_date, assignee_id, completed_at, created_by").eq("id", taskId).maybeSingle();
  if (!task) throw new HttpError(404, "That task was not found.");

  // Seeing a task is not the same as assigning it: a teammate who can read it, or the assignee
  // themselves, must not be able to send its email. The person who created it, an owner or admin
  // of its company, or a Rococo admin can.
  const companyAdmin = caller.company_id === task.company_id && (caller.role === "owner" || caller.role === "admin");
  if (task.created_by !== caller.id && !companyAdmin && !(await isRococo())) {
    return json(200, { sent: false, reason: "Only the person who assigned this task or an admin can send its email." });
  }

  // A completed task needs nobody's attention, so it is never announced.
  if (task.completed_at) return json(200, { sent: false });

  // 4. Nobody to tell, or the caller assigned it to themselves.
  const assigneeId = task.assignee_id as string | null;
  if (!assigneeId || assigneeId === caller.id) return json(200, { sent: false });

  // 5. The assignee and the company, read with the service client.
  const admin = service();
  const [{ data: assignee }, { data: company }] = await Promise.all([
    admin.from("profiles").select("email, user_id, is_active").eq("id", assigneeId).maybeSingle(),
    admin.from("companies").select("name").eq("id", task.company_id).maybeSingle(),
  ]);
  if (!assignee || !assignee.user_id || assignee.is_active !== true || !assignee.email) return json(200, { sent: false });

  // 9. Nothing is claimed unless the email can actually go.
  const base = appUrl();
  if (!RESEND_API_KEY || !TASKS_FROM_EMAIL || !base) throw new HttpError(503, NOT_SET_UP);

  // 6. The claim, in one statement: only one call can move notified_assignee_id to this assignee.
  const { data: claimed, error: claimError } = await admin
    .from("tasks")
    .update({ notified_assignee_id: assigneeId })
    .eq("id", task.id)
    .eq("assignee_id", assigneeId)
    .or(`notified_assignee_id.is.null,notified_assignee_id.neq.${assigneeId}`)
    .select("id");
  if (claimError) {
    console.error("notify claim failed", claimError.code);
    throw new HttpError(500, "Something went wrong on our side.");
  }
  if (!claimed || claimed.length === 0) return json(200, { sent: false });

  // 7. The email: who assigned it, the title, the due date when set, and the link.
  const assigner = oneLine((caller.full_name as string | null) ?? "") || "A teammate";
  const title = oneLine(task.title as string);
  const due = formatDue(task.due_date as string | null);
  const link = `${base}/tasks/${task.id}`;
  const text = [`${assigner} assigned you a task.`, "", title, ...(due ? [`Due ${due}`] : []), "", `Open it: ${link}`].join("\n");
  const html = [
    `<p>${escapeHtml(assigner)} assigned you a task.</p>`,
    `<p>${escapeHtml(title)}${due ? `<br>Due ${escapeHtml(due)}` : ""}</p>`,
    `<p>Open it: <a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
  ].join("\n");

  let accepted = false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `"${displayName((company?.name as string | undefined) ?? "")}" <${TASKS_FROM_EMAIL}>`,
        to: [assignee.email],
        subject: `New task: ${title}`,
        text,
        html,
      }),
      // A send that hangs is a failed send: the claim is released below like any other failure.
      signal: AbortSignal.timeout(10000),
    });
    accepted = response.ok;
    if (!accepted) console.error(`notify send refused with ${response.status}`);
  } catch {
    console.error("notify send did not reach the email service");
  }

  // 8. Not sent: release the claim, but only if it is still ours, so a later save can try again.
  if (!accepted) {
    const { error: releaseError } = await admin.from("tasks").update({ notified_assignee_id: null }).eq("id", task.id).eq("notified_assignee_id", assigneeId);
    if (releaseError) console.error("notify release failed", releaseError.code);
    throw new HttpError(502, "The email service did not accept the message.");
  }
  return json(200, { sent: true });
}

// The invitation email. The invitation is read as the caller, so row level security decides
// whether they may see it at all; the company's name and slug are read with the service client.
async function handleInvitation(req: Request, invitationIdValue: unknown): Promise<Response> {
  const invitationId = typeof invitationIdValue === "string" ? invitationIdValue : "";
  if (!/^[0-9a-f-]{36}$/i.test(invitationId)) throw new HttpError(400, "Send the invitation to email.");

  const { asUser, caller, isRococo } = await signedInCaller(req);

  // The invitation, read as the caller: if they cannot see it, nothing is sent.
  const { data: invitation } = await asUser.from("invitations").select("id, company_id, email, profile_id, accepted_at, last_emailed_at").eq("id", invitationId).maybeSingle();
  if (!invitation) throw new HttpError(404, "That invitation was not found.");

  // Inviting is an admin's: an owner or admin of the invitation's company, or a Rococo admin.
  const companyAdmin = caller.company_id === invitation.company_id && (caller.role === "owner" || caller.role === "admin");
  if (!companyAdmin && !(await isRococo())) {
    return json(200, { sent: false, reason: "Only an owner or admin of this company can send its invitations." });
  }

  // Someone who has signed in has nothing left to accept.
  if (invitation.accepted_at) return json(200, { sent: false, reason: "They have already signed in." });

  // Stored lowercased already (0001); lowercased again so the link always matches the login screen.
  // Only ever one plain address: anything else in the column is never handed to the mail service.
  const email = String(invitation.email).trim().toLowerCase();
  if (!PLAIN_ADDRESS.test(email)) return json(200, { sent: false, reason: "That address cannot be emailed." });

  // A person switched off is not invited in. The roster row is the invitation's own, or the
  // unclaimed one at its address in its company, the same row signing in would claim.
  const admin = service();
  const personQuery = admin.from("profiles").select("is_active").eq("company_id", invitation.company_id);
  const { data: person, error: personError } = await (invitation.profile_id
    ? personQuery.eq("id", invitation.profile_id)
    : personQuery.is("user_id", null).eq("email", email)
  ).limit(1).maybeSingle();
  if (personError) {
    console.error("notify person read failed", personError.code);
    throw new HttpError(500, "Something went wrong on our side.");
  }
  if (person && person.is_active !== true) return json(200, { sent: false, reason: "They are inactive." });

  const base = appUrl();
  if (!RESEND_API_KEY || !TASKS_FROM_EMAIL || !base) throw new HttpError(503, EMAILS_NOT_SET_UP);

  const { data: company, error: companyError } = await admin.from("companies").select("name, slug").eq("id", invitation.company_id).maybeSingle();
  if (companyError || !company) {
    if (companyError) console.error("notify company read failed", companyError.code);
    throw new HttpError(500, "Something went wrong on our side.");
  }

  // The claim, in one statement: only one call in 10 minutes can move last_emailed_at, and only
  // while the invitation is still waiting.
  const previous = (invitation.last_emailed_at as string | null) ?? null;
  const cutoff = new Date(Date.now() - RESEND_PAUSE_MS).toISOString();
  const { data: claimed, error: claimError } = await admin
    .from("invitations")
    .update({ last_emailed_at: new Date().toISOString() })
    .eq("id", invitation.id)
    .is("accepted_at", null)
    .or(`last_emailed_at.is.null,last_emailed_at.lt."${cutoff}"`)
    .select("last_emailed_at");
  if (claimError) {
    console.error("notify invitation claim failed", claimError.code);
    throw new HttpError(500, "Something went wrong on our side.");
  }
  if (!claimed || claimed.length === 0) {
    return json(200, { sent: false, reason: "An invitation email went to them in the last 10 minutes. Try again later." });
  }
  const ours = claimed[0].last_emailed_at as string;

  // The email: who invited them, the company, the address to sign in with, and the link. The link
  // is built from APP_URL and the invitation row only.
  const companyName = oneLine((company.name as string | null) ?? "") || "your company";
  const inviter = oneLine((caller.full_name as string | null) ?? "") || "Your team";
  const link = `${base}/?email=${encodeURIComponent(email)}&company=${encodeURIComponent(company.slug as string)}`;
  const closing = "You will get a sign-in link by email. No password needed.";
  const text = [`${inviter} invited you to ${companyName}'s Company Hub.`, "", `Sign in with this address: ${email}`, `Open it: ${link}`, "", closing].join("\n");
  const html = [
    `<p>${escapeHtml(inviter)} invited you to ${escapeHtml(companyName)}'s Company Hub.</p>`,
    `<p>Sign in with this address: ${escapeHtml(email)}<br>Open it: <a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
    `<p>${escapeHtml(closing)}</p>`,
  ].join("\n");

  let accepted = false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `"${displayName((company.name as string | null) ?? "")}" <${TASKS_FROM_EMAIL}>`,
        to: [email],
        subject: `You're invited to ${companyName} on Company Hub`,
        text,
        html,
      }),
      // A send that hangs is a failed send.
      signal: AbortSignal.timeout(10000),
    });
    accepted = response.ok;
    if (!accepted) console.error(`notify invitation send refused with ${response.status}`);
  } catch {
    console.error("notify invitation send did not reach the email service");
  }
  // Not sent: put the old value back, but only if the claim is still ours, so the next press can try.
  if (!accepted) {
    const { error: releaseError } = await admin.from("invitations").update({ last_emailed_at: previous }).eq("id", invitation.id).eq("last_emailed_at", ours);
    if (releaseError) console.error("notify invitation release failed", releaseError.code);
    throw new HttpError(502, "The email service did not accept the message.");
  }
  return json(200, { sent: true });
}

// Exactly one of task_id and invitation_id. A body without invitation_id goes to the task path
// unchanged, which refuses one with no task_id the way it always has.
async function handleNotify(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { task_id?: unknown; invitation_id?: unknown } | null;
  if (body?.invitation_id !== undefined) {
    if (body.task_id !== undefined) throw new HttpError(400, "Send one task or one invitation, not both.");
    return await handleInvitation(req, body.invitation_id);
  }
  return await handleTask(req, body);
}

Deno.serve(async (req: Request) => {
  // 1. The browser's preflight.
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...CORS, ...NO_STORE } });
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  try {
    return await handleNotify(req);
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.message });
    console.error("notify failed", err instanceof Error ? err.name : "unknown");
    return json(500, { error: "Something went wrong on our side." });
  }
});
