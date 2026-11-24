// Holds the connections and notify functions to their hygiene rules by reading their source, since
// vitest cannot load a Deno entry point: every response says no-store, every import names an exact
// version, every log line carries only fixed text, ids, codes, names, counts and statuses, every
// connect error the callback sends is a key the app can show, a sync shows only its own fixed lines,
// a pending connection's id is minted fresh and never taken from the state's nonce, and notify
// trusts a Rococo flag only through the shared Rococo rule. The scans read the code's own shapes;
// they are not a parser, so a new shape they do not know fails loudly rather than passing.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CONNECT_ERROR_TEXT } from "../../../supabase/functions/_shared/connectFlow.ts";

interface SourceFile {
  path: string;
  text: string;
}

const DIRECTORIES = ["connections", "notify", "_shared"];

// Every .ts file under the scanned function folders, by its path from supabase/functions.
async function readFunctions(): Promise<SourceFile[]> {
  // A non-literal specifier keeps node:fs out of the app's type check, which has no Node types.
  const fsModule = "node:fs";
  const fs = (await import(/* @vite-ignore */ fsModule)) as {
    readFileSync(path: URL, encoding: "utf8"): string;
    readdirSync(path: URL, options: { recursive: true }): string[];
  };
  // Through a variable: Vite rewrites a literal new URL(path, import.meta.url) into an asset URL.
  const here = import.meta.url;
  const root = new URL("../../../supabase/functions/", here);
  const files: SourceFile[] = [];
  for (const directory of DIRECTORIES) {
    const base = new URL(`${directory}/`, root);
    for (const entry of fs.readdirSync(base, { recursive: true })) {
      const name = String(entry).replace(/\\/g, "/");
      if (!name.endsWith(".ts")) continue;
      files.push({ path: `${directory}/${name}`, text: fs.readFileSync(new URL(name, base), "utf8") });
    }
  }
  return files;
}

const lines = (file: SourceFile) => file.text.split("\n");
const byPath = (files: SourceFile[], path: string) => {
  const file = files.find((f) => f.path === path);
  if (!file) throw new Error(`${path} is missing`);
  return file;
};
// The code without its whole-line comments, so a rule is never met or broken by a comment.
const codeOf = (text: string) =>
  text
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;

// The top-level arguments of the call whose "(" is at open, up to its matching ")", across lines.
// Quoted strings are skipped whole, and a template literal is skipped with its ${} parts, so a
// parenthesis or comma inside either never splits or ends the call.
function callArguments(text: string, open: number): string[] {
  const args: string[] = [];
  let start = open + 1;
  let depth = 0;
  // "tpl" inside a template's text; a number is the brace depth inside one of its ${}.
  const stack: Array<"tpl" | number> = [];
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    const top = stack[stack.length - 1];
    if (top === "tpl") {
      if (ch === "\\") i++;
      else if (ch === "`") stack.pop();
      else if (ch === "$" && text[i + 1] === "{") {
        stack.push(0);
        i++;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === "\\") i++;
      continue;
    }
    if (ch === "`") {
      stack.push("tpl");
      continue;
    }
    if (typeof top === "number") {
      if (ch === "{") stack[stack.length - 1] = top + 1;
      else if (ch === "}") {
        if (top === 0) stack.pop();
        else stack[stack.length - 1] = top - 1;
      }
      continue;
    }
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) {
      if (depth === 0) {
        args.push(text.slice(start, i));
        return args.map((a) => a.trim()).filter(Boolean);
      }
      depth--;
    } else if (ch === "," && depth === 0) {
      args.push(text.slice(start, i));
      start = i + 1;
    }
  }
  throw new Error(`a call at line ${lineAt(text, open)} never closes`);
}

// Every console call of any method, with its arguments, wherever it starts and however many lines
// it spans.
function consoleCalls(text: string): Array<{ line: number; method: string; args: string[] }> {
  return [...text.matchAll(/\bconsole\s*\.\s*(\w+)\s*\(/g)].map((m) => ({
    line: lineAt(text, m.index!),
    method: m[1],
    args: callArguments(text, m.index! + m[0].length - 1),
  }));
}

const STRING = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/;
const PATH = /^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*$/;
// A name that may hold a credential, an account or a person's address is never logged, whatever
// it ends in: realmId and accountId are ids, and still never go to a log.
const SENSITIVE = /token|secret|realm|account|nonce|password|key|auth|email|body|state/i;
// Values that are safe and match no suffix rule, each for a stated reason:
//   provider, def.key, claimed.provider, row.provider: a provider key from the fixed registry.
//   reason: the error name tick.ts hands its callbacks (tick.test.ts proves it is never the message).
const ALLOWED_VALUES = new Set(["provider", "def.key", "claimed.provider", "row.provider", "reason"]);

// One logged value: an id, a count, a length or a status by name, or a .code or .name read off
// something (a bare `code` is an OAuth code, a bare `name` could be anyone's), or an allowed value.
function safeValue(expr: string): boolean {
  if (ALLOWED_VALUES.has(expr)) return true;
  if (!PATH.test(expr)) return false;
  const segments = expr.split(/\??\./);
  if (segments.some((s) => SENSITIVE.test(s))) return false;
  const last = segments[segments.length - 1];
  if (/^(id|count|length|status)$/.test(last) || /[a-z](Id|Count|Status)$/.test(last)) return true;
  return segments.length > 1 && /^(code|name)$/.test(last);
}

// One argument: fixed text, a template whose every ${} is a safe value, a safe value, or a safe
// value with a fixed fallback (`x ?? "unknown"`, `err instanceof Error ? err.name : "unknown"`).
function safeArgument(arg: string): boolean {
  if (STRING.test(arg)) return true;
  if (/^`[^`]*`$/.test(arg)) return [...arg.matchAll(/\$\{([^}]*)\}/g)].every((m) => safeValue(m[1].trim()));
  const orFixed = /^(.+?)\s*\?\?\s*("[^"]*"|'[^']*')$/.exec(arg);
  if (orFixed) return safeValue(orFixed[1].trim());
  const nameOf = /^[\w$]+ instanceof Error \? (.+?) : ("[^"]*"|'[^']*')$/.exec(arg);
  if (nameOf) return safeValue(nameOf[1].trim());
  return safeValue(arg);
}

const unsafeLogs = (text: string) =>
  consoleCalls(text).flatMap(({ line, method, args }) => args.filter((arg) => !safeArgument(arg)).map((arg) => `${line} console.${method}: ${arg}`));

// The constants a file declares as fixed text: a string, or a template built only from such constants.
function fixedConstants(text: string): Set<string> {
  const fixed = new Set<string>();
  const declared = [...text.matchAll(/\bconst ([A-Z][A-Z0-9_]*)\s*(?::\s*[^=]+)?=\s*("(?:[^"\\]|\\.)*"|`[^`]*`|\{[^}]*\})\s*;/g)];
  // Templates may lean on constants declared above them, so settle in a few passes.
  for (let pass = 0; pass < 3; pass++) {
    for (const [, name, value] of declared) {
      if (value.startsWith('"')) fixed.add(name);
      else if (value.startsWith("`") && [...value.matchAll(/\$\{([^}]*)\}/g)].every((m) => fixed.has(m[1].trim()))) fixed.add(name);
      // A record of lines: every value in it is a plain string.
      else if (value.startsWith("{") && value.slice(1, -1).split(",").filter((e) => e.trim()).every((e) => /^\s*\w+\s*:\s*"(?:[^"\\]|\\.)*"\s*$/.test(e))) fixed.add(name);
    }
  }
  return fixed;
}

// A SyncError's argument: fixed text, a fixed constant, a fixed record read by key, or a template of
// fixed constants. Nothing from the sheet, the provider or the database.
function fixedLine(arg: string, fixed: Set<string>): boolean {
  if (STRING.test(arg)) return true;
  if (fixed.has(arg)) return true;
  const lookup = /^([A-Z][A-Z0-9_]*)\[[\w.]+\]$/.exec(arg);
  if (lookup) return fixed.has(lookup[1]);
  if (/^`[^`]*`$/.test(arg)) return [...arg.matchAll(/\$\{([^}]*)\}/g)].every((m) => fixed.has(m[1].trim()));
  return false;
}

const SPECIFIER = /["'`]((?:npm|jsr):[^"'`]+)["'`]/g;
const EXACT = /^(npm|jsr):(@[\w-]+\/)?[\w.-]+@\d+\.\d+\.\d+(\/|$)/;

describe("function hygiene", () => {
  it("every response the connections and notify functions build says no-store", async () => {
    const files = await readFunctions();
    for (const path of ["connections/http.ts", "connections/index.ts", "notify/index.ts"]) {
      expect(lines(byPath(files, path)).some((l) => l.includes("new Response(")), path).toBe(true);
    }
    const missing = files.flatMap((file) =>
      codeOf(file.text)
        .split("\n")
        .map((line, i) => ({ line, at: `${file.path}:${i + 1}` }))
        .filter(({ line }) => line.includes("new Response(") && !line.includes("...NO_STORE"))
        .map(({ at }) => at),
    );
    expect(missing).toEqual([]);
    // No answer is built a way the scan above cannot see, and the header still says what it means.
    const otherBuilders = files.filter((f) => /\bResponse\s*\.\s*(json|redirect|error)\s*\(/.test(f.text)).map((f) => f.path);
    expect(otherBuilders).toEqual([]);
    expect(byPath(files, "_shared/headers.ts").text).toMatch(/NO_STORE = \{ "Cache-Control": "no-store" \} as const;/);
  });

  it("every import names an exact version", async () => {
    const files = await readFunctions();
    const specifiers = files.flatMap((file) => [...file.text.matchAll(SPECIFIER)].map((m) => ({ at: file.path, specifier: m[1] })));
    expect(specifiers.length).toBeGreaterThanOrEqual(3);
    expect(specifiers.filter(({ specifier }) => !EXACT.test(specifier))).toEqual([]);
    // The fallback the edge-runtime types may need at deploy is held to the same rule.
    expect(EXACT.test("jsr:@supabase/functions-js@2.116.0/edge-runtime.d.ts")).toBe(true);
    expect(EXACT.test("npm:@supabase/supabase-js@2")).toBe(false);
    expect(EXACT.test("jsr:@supabase/functions-js/edge-runtime.d.ts")).toBe(false);
    // Nothing is imported straight from a web address, statically or dynamically.
    const fromUrl = files.flatMap((file) =>
      [...file.text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'`](https?:[^"'`]+)["'`]/g)].map((m) => `${file.path}: ${m[1]}`),
    );
    expect(fromUrl).toEqual([]);
  });

  it("every log line carries only fixed text, ids, codes, names, counts and statuses", async () => {
    const files = await readFunctions();
    const calls = files.flatMap((file) => consoleCalls(file.text));
    expect(calls.length).toBeGreaterThan(10);
    expect(files.flatMap((file) => unsafeLogs(file.text).map((problem) => `${file.path}:${problem}`))).toEqual([]);
  });

  it("the log scan itself sees what it must refuse and lets ids and codes through", () => {
    const refused = [
      'console.error("x", err.message)',
      'console.error(\n  "x",\n  err.message,\n)',
      'console.error("x", id, err)',
      "console.log(body)",
      'console.error("x", accessToken)',
      "console.log(code)",
      'console.error("x", realmId)',
      'console.error("x", exchanged.externalAccountId)',
      "console.log(exchanged)",
      "console.error(`failed: ${err}`)",
      'console.error("x", String(response))',
      "console.info(body)",
      "console.debug(text)",
      'console.warn("x", JSON.stringify(row))',
      'console.error("x", format(err.message))',
      'console.error("x", err instanceof Error ? err.message : "unknown")',
    ];
    for (const call of refused) expect(unsafeLogs(call), call).not.toEqual([]);
    const allowed = [
      'console.error("x", id, error.code ?? "unknown")',
      'console.error("x", err instanceof Error ? err.name : "unknown")',
      "console.error(`refused with ${response.status}`)",
      'console.error("x", connection.id, sourceId, due.length, sweptCount)',
      'console.error("x (y)", def.key, "not set up")',
      'console.log("x", ranStatus)',
    ];
    for (const call of allowed) expect(unsafeLogs(call), call).toEqual([]);
    expect(consoleCalls('if (a) console.error("a (b)", id); else f(err.message);')[0].args).toEqual(['"a (b)"', "id"]);
  });

  it("every connect error the function sends is one the app can show", async () => {
    const files = (await readFunctions()).filter((f) => f.path.startsWith("connections/"));
    const constructed = files.flatMap((file) => [...file.text.matchAll(/new ConnectError\(([^)]*)\)/g)].map((m) => m[1].trim()));
    const keys = constructed.map((arg) => /^"([a-z_]+)"$/.exec(arg)?.[1] ?? `not a literal key: ${arg}`);
    expect(keys.filter((key) => !Object.hasOwn(CONNECT_ERROR_TEXT, key))).toEqual([]);
    expect(new Set(keys).size).toBeGreaterThanOrEqual(5);
  });

  it("a sync shows only its own fixed lines, never another error's text", async () => {
    const files = await readFunctions();
    const syncFiles = files.filter((f) => f.path.startsWith("_shared/sync/") || f.path === "connections/sync.ts");
    // Every SyncError carries a line fixed in the code.
    const loose = syncFiles.flatMap((file) => {
      const code = codeOf(file.text);
      const fixed = fixedConstants(code);
      return [...code.matchAll(/new SyncError\(/g)]
        .map((m) => ({ at: `${file.path}:${lineAt(code, m.index!)}`, args: callArguments(code, m.index! + m[0].length - 1) }))
        .filter(({ args }) => args.length !== 1 || !fixedLine(args[0], fixed))
        .map(({ at, args }) => `${at} ${args.join(", ")}`);
    });
    expect(loose).toEqual([]);
    // The adapters, the token store and the runner throw nothing a run could show but a SyncError.
    for (const path of ["_shared/sync/googleSheets.ts", "_shared/sync/quickbooks.ts", "_shared/sync/tokenStore.ts", "_shared/sync/runner.ts"]) {
      expect(codeOf(byPath(files, path).text), path).not.toMatch(/new Error\(/);
    }
    // No HttpError is built from an error's message: a route answers fixed text or a SyncError's line.
    const fromMessage = files
      .filter((f) => f.path.startsWith("connections/"))
      .flatMap((file) => {
        const code = codeOf(file.text);
        return [...code.matchAll(/new HttpError\(/g)]
          .filter((m) => callArguments(code, m.index! + m[0].length - 1).some((arg) => /\.message\b/.test(arg)))
          .map((m) => `${file.path}:${lineAt(code, m.index!)}`);
      });
    expect(fromMessage).toEqual([]);
  });

  it("a pending connection's id is minted fresh, never taken from the state's nonce", async () => {
    const files = await readFunctions();
    const connections = files.filter((f) => f.path.startsWith("connections/"));
    // The state's nonce is read once, in the statement that redeems it on connection_states.
    const reads = connections.flatMap((file) => {
      const code = codeOf(file.text);
      return [...code.matchAll(/\bclaims\s*(?:\??\.\s*n\b|\[\s*["'`]n["'`]\s*\])/g)].map((m) => {
        const statementStart = code.lastIndexOf("await ", m.index!);
        const statement = code.slice(statementStart, code.indexOf(";", m.index!));
        return { at: `${file.path}:${lineAt(code, m.index!)}`, redeems: /\.from\("connection_states"\)\s*\.delete\(\)/.test(statement) };
      });
    });
    expect(reads).toHaveLength(1);
    expect(reads[0].redeems, reads[0].at).toBe(true);
    // Nor is it taken out of the claims by destructuring or kept under another name.
    const destructured = connections.filter((f) => /\{[^}]*\bn\b[^}]*\}\s*=\s*[\w.]*claims\b/.test(codeOf(f.text))).map((f) => f.path);
    expect(destructured).toEqual([]);

    const pending = codeOf(byPath(files, "connections/pending.ts").text);
    const park = /export async function parkPending\(([\s\S]*?)\): Promise<string> \{([\s\S]*?)\n}\n/.exec(pending);
    expect(park).not.toBeNull();
    const [, signature, body] = park!;
    // Nothing the caller passes can name the id.
    expect(signature).not.toMatch(/\b(id|n|nonce|state|claims)\b/);
    // The id is the fresh UUID, assigned once, sealed under, inserted as the row's key and answered.
    expect(body).toMatch(/^\s*const id = crypto\.randomUUID\(\);/);
    expect([...body.matchAll(/\bid\s*=(?!=)/g)]).toHaveLength(1);
    expect(body).toMatch(/sealTokens\(\s*\{ pendingId: id \}/);
    expect(body).toMatch(/\.from\("connection_pending"\)\.insert\(\{\s*id,/);
    expect(body).toMatch(/\n\s*return id;\s*$/);
  });

  it("notify honours a Rococo flag only through the shared Rococo rule", async () => {
    const notify = codeOf(byPath(await readFunctions(), "notify/index.ts").text);
    expect(/import \{[^}]*\bisRococoAdmin\b[^}]*\} from "\.\.\/_shared\/rococoAdmin\.ts";/.test(notify), "imports isRococoAdmin").toBe(true);
    // The flag is only selected for the rule to read. No member read, destructuring or string key.
    const withoutSelect = notify.replace(/\.from\("profiles"\)\.select\("[^"]*"\)/g, "");
    expect(withoutSelect.match(/is_rococo_admin/g) ?? []).toEqual([]);
    // isRococo is the shared rule over the caller's profile and the signed-in account.
    expect(notify).toMatch(/const isRococo = \(\) =>\s*isRococoAdmin\(caller, account, async \(email\) => \{/);
    // Each privileged branch: a company admin, or else the awaited rule. Nothing else opens one.
    const decisions = [...notify.matchAll(/const companyAdmin = /g)];
    const gates = notify.split("\n").filter((line) => /\bif\s*\(.*\bcompanyAdmin\b/.test(line));
    expect(decisions).toHaveLength(2);
    expect(gates).toHaveLength(2);
    for (const gate of gates) expect(gate).toMatch(/!companyAdmin && !\(await isRococo\(\)\)\) \{$/);
    expect([...notify.matchAll(/\bisRococo\b(?!Admin)/g)].length).toBe(1 + 1 + 2 + 2);
  });
});
