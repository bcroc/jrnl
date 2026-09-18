import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractTags, formatLocalDate, matches, parseDayFile, resolveDate } from "./parse.js";

const jrnl = join(dirname(fileURLToPath(import.meta.url)), "jrnl.js");

function run(args: string[], opts: { input?: string; editor?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "jrnl-test-"));
  return { ...runIn(dir, args, opts), dir };
}

// Like run(), but against an existing journal dir (for pre-seeding files).
function runIn(dir: string, args: string[], opts: { input?: string; editor?: string } = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, JOURNAL_DIR: dir };
  if (opts.editor) env.EDITOR = opts.editor;
  const r = spawnSync(process.execPath, [jrnl, ...args], {
    input: opts.input ?? "",
    env,
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
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

test("resolveDate: explicit, keywords, -N offsets, and invalid input", () => {
  const now = new Date(2026, 8, 18, 15, 0); // local 2026-09-18 15:00
  assert.equal(resolveDate("2026-01-02", now), "2026-01-02");
  assert.equal(resolveDate("today", now), "2026-09-18");
  assert.equal(resolveDate("TODAY", now), "2026-09-18");
  assert.equal(resolveDate("yesterday", now), "2026-09-17");
  assert.equal(resolveDate("tomorrow", now), "2026-09-19");
  assert.equal(resolveDate("-1", now), "2026-09-17");
  assert.equal(resolveDate("-3d", now), "2026-09-15");
  assert.equal(resolveDate("-30", now), "2026-08-19"); // crosses month boundary
  assert.equal(resolveDate("nope", now), null);
  assert.equal(resolveDate("2026-13-01", now), "2026-13-01"); // shape-valid passes through
  assert.equal(formatLocalDate(new Date(2026, 0, 5)), "2026-01-05"); // zero-padding
});

test("parseDayFile reports skipped blocks via onSkipped callback", () => {
  const content = [
    "## 2026-09-18 09:30",
    "",
    "real entry",
    "",
    "## Shopping list",
    "",
    "milk",
    "",
    "## 2026-09-18 25:99",
    "",
    "impossible time",
    "",
  ].join("\n");
  const skipped: string[] = [];
  const entries = parseDayFile("/x.md", content, (h) => skipped.push(h));
  assert.equal(entries.length, 1);
  assert.deepEqual(skipped, ["Shopping list", "2026-09-18 25:99"]);
});

test("jrnl show yesterday / -1 resolve to the prior day", (t) => {
  const { dir, status } = run(["write", "today entry"], {});
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(status, 0);
  const yesterday = resolveDate("yesterday", new Date())!;
  const yDir = join(dir, yesterday.slice(0, 4), yesterday.slice(5, 7));
  mkdirSync(yDir, { recursive: true });
  writeFileSync(join(yDir, `${yesterday}.md`), `\n## ${yesterday} 08:00\n\nyesterday entry #old\n`);
  const show = runIn(dir, ["show", "yesterday"]);
  assert.equal(show.status, 0);
  assert.match(show.stdout, /yesterday entry #old/);
  assert.doesNotMatch(show.stdout, /today entry/);
  const rel = runIn(dir, ["show", "-1"]);
  assert.equal(rel.status, 0);
  assert.match(rel.stdout, /yesterday entry #old/);
  const bad = runIn(dir, ["show", "nope"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /invalid date/i);
});

test("jrnl edit opens the day file in EDITOR; count change is reported", (t) => {
  const { dir, status } = run(["write", "first entry #a"], {});
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(status, 0);
  // Editor appends a second parseable entry to today's file.
  const edited = runIn(dir, ["edit"], { editor: '/bin/sh -c "printf \'\\n## 2020-01-01 07:00\\n\\nadded by editor\\n\' >> $1"' });
  assert.equal(edited.status, 0);
  assert.match(edited.stdout, /-> 2 parseable entries/);
  const list = runIn(dir, ["list", "10"]);
  assert.match(list.stdout, /added by editor/);

  // Missing day file -> exit 1, no editor launch.
  const missing = runIn(dir, ["edit", "2001-01-01"]);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /no entries on 2001-01-01/i);

  // Editor failure propagates.
  const failed = runIn(dir, ["edit"], { editor: "sh -c 'exit 3'" });
  assert.equal(failed.status, 3);

  // Invalid date -> exit 1.
  const bad = runIn(dir, ["edit", "bogus"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /invalid date/i);
});

test("jrnl edit warns if editing introduces an unparsed block", (t) => {
  const { dir, status } = run(["write", "entry one"], {});
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(status, 0);
  const edited = runIn(dir, ["edit"], { editor: '/bin/sh -c "printf \'\\n## Shopping list\\n\' >> $1"' });
  assert.equal(edited.status, 0);
  assert.match(edited.stderr, /unparsed block/);
});