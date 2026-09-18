import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractTags, matches, parseDayFile } from "./parse.js";

const jrnl = join(dirname(fileURLToPath(import.meta.url)), "jrnl.js");

function run(args: string[], opts: { input?: string; editor?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "jrnl-test-"));
  const env: NodeJS.ProcessEnv = { ...process.env, JOURNAL_DIR: dir };
  if (opts.editor) env.EDITOR = opts.editor;
  const r = spawnSync(process.execPath, [jrnl, ...args], {
    input: opts.input ?? "",
    env,
    encoding: "utf8",
  });
  return { dir, status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// The child creates temp dirs named "jrnl-<random>"; our own are "jrnl-test-...".
function leakedTmpDirs(): number {
  return readdirSync(tmpdir()).filter((n) => n.startsWith("jrnl-") && !n.startsWith("jrnl-test-")).length;
}

function findMd(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) out.push(...findMd(full));
    else if (name.name.endsWith(".md")) out.push(full);
  }
  return out;
}

test("extractTags lowercases, dedupes, keeps - and _", () => {
  assert.deepEqual(extractTags("#Work #work #foo-bar #baz_1 done."), ["work", "foo-bar", "baz_1"]);
  assert.deepEqual(extractTags("no tags here"), []);
});

test("parseDayFile splits timestamped blocks and skips other headings", () => {
  const content = [
    "## 2026-09-18 09:30",
    "",
    "Morning entry #work",
    "",
    "Tags: #work",
    "",
    "## Shopping list",
    "",
    "milk",
    "",
    "## 2026-09-18 22:15",
    "",
    "Evening notes",
    "",
  ].join("\n");
  const entries = parseDayFile("/x/2026-09-18.md", content);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    date: "2026-09-18",
    time: "09:30",
    tags: ["work"],
    body: "\nMorning entry #work\n\nTags: #work",
    file: "/x/2026-09-18.md",
  });
  assert.deepEqual(entries[1].tags, []);
  assert.equal(entries[1].body, "\nEvening notes");
});

test("matches: #tag terms hit tags only; other terms hit body + tags, case-insensitively", () => {
  const e = parseDayFile("/x.md", "## 2026-09-18 08:00\n\nCoffee thoughts #drinks\n")[0];
  assert.equal(matches(e, "#drinks"), true);
  assert.equal(matches(e, "#DRINKS"), true);
  assert.equal(matches(e, "#work"), false);
  assert.equal(matches(e, "coffee"), true);
  assert.equal(matches(e, "COFFEE"), true);
  assert.equal(matches(e, "drinks"), true);
});

test("piped --help prints usage and saves nothing", (t) => {
  const before = leakedTmpDirs();
  const { dir, status, stdout } = run(["--help"], { input: "hello" });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(status, 0);
  assert.match(stdout, /terminal journal/i);
  assert.deepEqual(readdirSync(dir), []);
  assert.equal(leakedTmpDirs(), before);
});

test("unknown dash-option with piped stdin exits 1 without saving", (t) => {
  const { dir, status, stderr } = run(["-x"], { input: "hello" });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(status, 1);
  assert.match(stderr, /unknown option/i);
  assert.deepEqual(readdirSync(dir), []);
});

test("piped stdin with no subcommand is saved as an entry", (t) => {
  const { dir, status } = run([], { input: "piped thought #ideas" });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(status, 0);
  const files = findMd(dir);
  assert.equal(files.length, 1);
  const [entry] = parseDayFile(files[0], readFileSync(files[0], "utf8"));
  assert.equal(entry.body, "\npiped thought #ideas\n\nTags: #ideas");
  assert.deepEqual(entry.tags, ["ideas"]);
});

test("EDITOR containing arguments works, strips #: lines, leaves no temp dirs", (t) => {
  const before = leakedTmpDirs();
  // $1 is the draft path as seen by the wrapper shell that runs $EDITOR.
  const { dir, status } = run(["editor"], { editor: '/bin/sh -c "echo real content >> $1"' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(status, 0);
  const files = findMd(dir);
  assert.equal(files.length, 1);
  const [entry] = parseDayFile(files[0], readFileSync(files[0], "utf8"));
  assert.equal(entry.body, "\nreal content");
  assert.equal(leakedTmpDirs(), before);
});

test("empty editor draft saves nothing and leaves no temp dirs", (t) => {
  const before = leakedTmpDirs();
  const { dir, status } = run(["editor"], { editor: "/bin/echo -n" });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(status, 0);
  assert.deepEqual(findMd(dir), []);
  assert.equal(leakedTmpDirs(), before);
});

test("nonzero editor exit propagates and leaves no temp dirs", (t) => {
  const before = leakedTmpDirs();
  const { dir, status } = run(["editor"], { editor: "sh -c 'exit 7'" });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(status, 7);
  assert.equal(leakedTmpDirs(), before);
});

test("jrnl write round-trips through parseDayFile", (t) => {
  const { dir, status } = run(["write", "hello #World #work"], {});
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(status, 0);
  const files = findMd(dir);
  assert.equal(files.length, 1);
  const [entry] = parseDayFile(files[0], readFileSync(files[0], "utf8"));
  assert.equal(entry.body, "\nhello #World #work\n\nTags: #world #work");
  assert.deepEqual(entry.tags, ["world", "work"]);
});