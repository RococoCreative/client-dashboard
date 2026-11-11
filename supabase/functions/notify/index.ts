// The task assignment email. After the app saves a task with a new assignee, it calls this
// function; the function decides whether an email is due, claims the send in one statement so it
// can never go twice for one assignment, and sends one plain email through Resend. It is the only
// place the Resend key lives, and the browser can never write notified_assignee_id itself.
//
// Route: POST /functions/v1/notify { task_id } -> { sent: boolean }, or { error } with a non-2xx
// status. Deployed with the gateway's JWT check on: the caller is the signed-in person who saved
// the task, and must be able to see it under row level security.
//
// Environment (Supabase secrets): RESEND_API_KEY, TASKS_FROM_EMAIL (the sending address), and
// APP_ORIGINS (comma separated, shared with the connections function; the first entry builds the
// task link). SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by the
// platform.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
const APP_ORIGINS = (Deno.env.get("APP_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const NOT_SET_UP = "Task emails are not set up yet.";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

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

// The origin the task link starts from: the first APP_ORIGINS entry only, never anything the
// caller sends, so a company-branded email can only ever link to the app.
function appUrl(): string | null {
  if (!APP_ORIGINS[0]) return null;
  try {
    const url = new URL(APP_ORIGINS[0]);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

async function handleNotify(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { task_id?: unknown } | null;
  const taskId = typeof body?.task_id === "string" ? body.task_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw new HttpError(400, "Send the task to notify about.");

  // 2. The caller, under their own JWT and the same row level security the app lives under.
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw new HttpError(401, "Sign in first.");
  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } }, ...noSession });
  const { data: userData, error: userError } = await asUser.auth.getUser(jwt);
  if (userError || !userData.user) throw new HttpError(401, "Sign in first.");
  const { data: caller } = await asUser.from("profiles").select("id, full_name, is_active").eq("user_id", userData.user.id).maybeSingle();
  if (!caller || caller.is_active !== true) throw new HttpError(403, "Your profile is not active.");

  // 3. The task, read as the caller: if they cannot see it, nothing is sent.
  const { data: task } = await asUser.from("tasks").select("id, company_id, title, due_date, assignee_id").eq("id", taskId).maybeSingle();
  if (!task) throw new HttpError(404, "That task was not found.");

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

Deno.serve(async (req: Request) => {
  // 1. The browser's preflight.
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  try {
    return await handleNotify(req);
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.message });
    console.error("notify failed", err instanceof Error ? err.name : "unknown");
    return json(500, { error: "Something went wrong on our side." });
  }
});
