// Holds the connections and notify functions to their hygiene rules by reading their source, since
// vitest cannot load a Deno entry point: every response says no-store, every import names an exact
// version, no log line carries an error object, an error's message or a body, every connect error
// the callback sends is a key the app can show, a pending connection's id is minted fresh and never
// taken from the state's nonce, and notify trusts a Rococo flag only through the shared Rococo rule.
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

// A console call from its opening parenthesis to the one that closes it, on the same line. Quoted
// text is skipped so a parenthesis inside a message does not end the call early.
function consoleCalls(line: string): string[] {
  const calls: string[] = [];
  for (const match of line.matchAll(/console\.(log|error|warn)\(/g)) {
    const start = match.index!;
    let depth = 0;
    let quote: string | null = null;
    let end = line.length;
    for (let i = start + match[0].length - 1; i < line.length; i++) {
      const ch = line[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "(") depth++;
      else if (ch === ")" && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    calls.push(line.slice(start, end));
  }
  return calls;
}

const carriesError = (call: string) => /\.message\b/.test(call) || /[(,]\s*(err|error|e|body|text)\s*[,)]/.test(call);

const SPECIFIER = /["'`]((?:npm|jsr):[^"'`]+)["'`]/g;
const EXACT = /^(npm|jsr):(@[\w-]+\/)?[\w.-]+@\d+\.\d+\.\d+(\/|$)/;

describe("function hygiene", () => {
  it("every response the connections and notify functions build says no-store", async () => {
    const files = await readFunctions();
    for (const path of ["connections/http.ts", "connections/index.ts", "notify/index.ts"]) {
      expect(lines(byPath(files, path)).some((l) => l.includes("new Response(")), path).toBe(true);
    }
    const missing = files.flatMap((file) =>
      lines(file)
        .map((line, i) => ({ line, at: `${file.path}:${i + 1}` }))
        .filter(({ line }) => line.includes("new Response(") && !line.includes("NO_STORE"))
        .map(({ at }) => at),
    );
    expect(missing).toEqual([]);
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
    // Nothing is imported straight from a web address, which would carry no version rule at all.
    const fromUrl = files.flatMap((file) =>
      [...file.text.matchAll(/(?:from|import)\s+["'](https?:[^"']+)["']/g)].map((m) => `${file.path}: ${m[1]}`),
    );
    expect(fromUrl).toEqual([]);
  });

  it("no log line carries an error object, an error message or a body", async () => {
    const files = await readFunctions();
    const calls = files.flatMap((file) => lines(file).flatMap((line, i) => consoleCalls(line).map((call) => ({ at: `${file.path}:${i + 1}`, call }))));
    expect(calls.length).toBeGreaterThan(10);
    expect(calls.filter(({ call }) => carriesError(call))).toEqual([]);
    // The scan itself: it sees the shapes it is looking for, and lets ids and codes through.
    expect(carriesError('console.error("x", err.message)')).toBe(true);
    expect(carriesError('console.error("x", id, err)')).toBe(true);
    expect(carriesError("console.log(body)")).toBe(true);
    expect(carriesError('console.error("x", id, error.code ?? "unknown")')).toBe(false);
    expect(carriesError('console.error("x", err instanceof Error ? err.name : "unknown")')).toBe(false);
    expect(consoleCalls('if (a) console.error("a (b)", id); else f(err.message);')).toEqual(['console.error("a (b)", id)']);
  });

  it("every connect error the function sends is one the app can show", async () => {
    const files = (await readFunctions()).filter((f) => f.path.startsWith("connections/"));
    const constructed = files.flatMap((file) => [...file.text.matchAll(/new ConnectError\(([^)]*)\)/g)].map((m) => m[1].trim()));
    const keys = constructed.map((arg) => /^"([a-z_]+)"$/.exec(arg)?.[1] ?? `not a literal key: ${arg}`);
    expect(keys.filter((key) => !Object.hasOwn(CONNECT_ERROR_TEXT, key))).toEqual([]);
    expect(new Set(keys).size).toBeGreaterThanOrEqual(5);
  });

  it("a pending connection's id is minted fresh, never taken from the state's nonce", async () => {
    const files = await readFunctions();
    const pending = byPath(files, "connections/pending.ts").text;
    const park = /export async function parkPending\([\s\S]*?\n}\n/.exec(pending)?.[0] ?? "";
    expect(park).toMatch(/const id = crypto\.randomUUID\(\);/);
    expect(park).not.toMatch(/\binput\.(id|nonce|n)\b/);
    const parksOrQueries = /parkPending\(|connection_pending|\bpending:/;
    const offending = files
      .filter((f) => f.path.startsWith("connections/"))
      .flatMap((file) => lines(file).map((line, i) => ({ line, at: `${file.path}:${i + 1}` })))
      .filter(({ line }) => parksOrQueries.test(line) && /\.n\b/.test(line))
      .map(({ at }) => at);
    expect(offending).toEqual([]);
  });

  it("notify honours a Rococo flag only through the shared Rococo rule", async () => {
    const notify = byPath(await readFunctions(), "notify/index.ts").text;
    const usesRule = /import \{[^}]*\bisRococoAdmin\b[^}]*\} from "\.\.\/_shared\/rococoAdmin\.ts";/.test(notify);
    expect(usesRule, "notify imports isRococoAdmin from _shared/rococoAdmin.ts").toBe(true);
    // The flag is selected for the rule to read, never compared by the function itself.
    const readsFlag = lines({ path: "notify/index.ts", text: notify }).filter((line) => !/^\s*\/\//.test(line) && /\.is_rococo_admin\b/.test(line));
    expect(readsFlag).toEqual([]);
  });
});
