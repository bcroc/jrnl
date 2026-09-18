#!/usr/bin/env node
import { mkdirSync, openSync, writeSync, fsyncSync, closeSync, readFileSync, readSync, existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import { extractTags, formatLocalDate, matches, parseDayFile, resolveDate, type Entry } from "./parse.js";

const JOURNAL_DIR = process.env.JOURNAL_DIR ?? join(homedir(), ".journal");

const isoNow = () => formatLocalDate(new Date());

function timeNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dayFile(date = isoNow()): string {
  const [y, m] = date.split("-");
  return join(JOURNAL_DIR, y, m, `${date}.md`);
}

function parseEntries(): Entry[] {
  if (!existsSync(JOURNAL_DIR)) return [];
  const entries: Entry[] = [];
  const warned = new Set<string>();
  const warnOnce = (file: string, msg: string) => {
    const key = `${file}\n${msg}`;
    if (!warned.has(key)) {
      warned.add(key);
      console.error(`jrnl: warning: ${msg}`);
    }
  };
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, name.name);
      if (name.isDirectory()) walk(full);
      else if (name.name.endsWith(".md")) {
        const content = readFileSync(full, "utf8");
        const before = entries.length;
        entries.push(
          ...parseDayFile(full, content, (header) =>
            warnOnce(full, `skipping unparsed block in ${full}: "## ${header.slice(0, 60)}" (expected "## YYYY-MM-DD HH:MM")`)
          )
        );
        if (content.trim() && entries.length === before) {
          warnOnce(full, `${full} contains no journal entries`);
        }
      }
    }
  };
  walk(JOURNAL_DIR);
  return entries.sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
}

function readStdin(): string {
  const chunks: Buffer[] = [];
  try {
    while (true) {
      const buf = Buffer.alloc(4096);
      const n = readSync(0, buf, 0, 4096, null);
      if (n === 0) break;
      chunks.push(buf.subarray(0, n));
    }
  } catch {
    /* no stdin */
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

function cmdWrite(args: string[]) {
  let text = args.join(" ");
  if (!text) text = readStdin();
  if (!text) {
    console.error("Nothing to write. Pass text as arguments or pipe via stdin.");
    process.exit(1);
  }
  saveEntry(text);
}

function saveEntry(text: string) {
  const file = dayFile();
  mkdirSync(dirname(file), { recursive: true });
  const tags = extractTags(text);
  let block = `\n## ${isoNow()} ${timeNow()}\n\n${text}\n`;
  if (tags.length) block += `\nTags: ${tags.map((t) => `#${t}`).join(" ")}\n`;
  try {
    const fd = openSync(file, "a");
    try {
      writeSync(fd, block);
      fsyncSync(fd); // entry is on disk before we report success
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    console.error(`Failed to save entry: ${err instanceof Error ? err.message : String(err)}`);
    console.error("--- entry text (NOT saved — copy it somewhere safe) ---");
    console.error(text);
    process.exit(1);
  }
  console.log(`Saved to ${file} at ${timeNow()}`);
}

const TEMPLATE = [
  "#: jrnl — write your entry below, save and quit to record it.",
  "#: Lines starting with '#:' are removed; use #tags anywhere in your entry.",
  "#:",
  "#:",
];

function spawnEditor(editor: string, draft: string): number {
  // EDITOR may contain arguments (e.g. "code -w"); run it through the user's
  // shell with the draft path as "$@" so spaces and quoting are handled.
  const shell = process.env.SHELL?.trim() || "/bin/sh";
  const result = spawnSync(shell, ["-c", `${editor} "$@"`, "jrnl", draft], { stdio: "inherit" });
  if (result.error) {
    console.error(`Failed to launch editor "${editor}": ${result.error.message}`);
    return 127;
  }
  return result.status ?? 1;
}

function cmdEditor(): number {
  const editor = process.env.EDITOR || process.env.VISUAL || "vi";
  const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
  const draft = join(dir, "draft.md");
  try {
    writeFileSync(draft, TEMPLATE.join("\n") + "\n");
    const status = spawnEditor(editor, draft);
    if (status !== 0) {
      console.error(status === 127 ? `Editor not found: ${editor}` : `Editor exited with status ${status}; entry not saved.`);
      return status;
    }
    const content = readFileSync(draft, "utf8");
    const text = content
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#:"))
      .join("\n")
      .trim();
    if (!text) {
      console.log("Empty entry, nothing saved.");
      return 0;
    }
    saveEntry(text);
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function printEntry(e: Entry) {
  console.log(`\n${e.date} ${e.time}${e.tags.length ? `  [${e.tags.map((t) => "#" + t).join(" ")}]` : ""}`);
  console.log(e.body);
}

function cmdSearch(args: string[]) {
  const terms = args.map((a) => a.toLowerCase());
  if (!terms.length) {
    console.error("Usage: jrnl search <term> [more terms...]");
    process.exit(1);
  }
  const hits = parseEntries().filter((e) => terms.every((t) => matches(e, t)));
  if (!hits.length) {
    console.log("No matches.");
    return;
  }
  for (const e of hits) printEntry(e);
  console.log(`\n--- ${hits.length} match${hits.length === 1 ? "" : "es"} ---`);
}

function cmdList(args: string[]) {
  const all = parseEntries();
  const n = Number(args[0]) || 5;
  const recent = all.slice(-n).reverse();
  for (const e of recent) {
    const first = e.body.split("\n").find((l) => l.trim()) ?? "(empty)";
    console.log(`${e.date} ${e.time}${e.tags.length ? `  [${e.tags.map((t) => "#" + t).join(" ")}]` : ""}  ${first.slice(0, 80)}`);
  }
}

function cmdTags() {
  const counts = new Map<string, number>();
  for (const e of parseEntries()) for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  if (!counts.size) {
    console.log("No tags yet.");
    return;
  }
  for (const [t, c] of [...counts.entries()].sort((a, b) => b[1] - a[1])) console.log(`#${t} (${c})`);
}

function cmdShow(args: string[]) {
  const date = args[0] ? resolveDate(args[0], new Date()) : isoNow();
  if (!date) {
    console.error(`Invalid date: ${args[0]} (use YYYY-MM-DD, "today", "yesterday", "tomorrow", or "-N")`);
    process.exit(1);
  }
  const hits = parseEntries().filter((e) => e.date === date);
  if (!hits.length) {
    console.log(`No entries on ${date}.`);
    return;
  }
  for (const e of hits) printEntry(e);
}

function cmdEdit(args: string[]): number {
  const date = args[0] ? resolveDate(args[0], new Date()) : isoNow();
  if (!date) {
    console.error(`Invalid date: ${args[0]} (use YYYY-MM-DD, "today", "yesterday", "tomorrow", or "-N")`);
    return 1;
  }
  const file = dayFile(date);
  if (!existsSync(file)) {
    console.log(`No entries on ${date} (${file} does not exist).`);
    return 1;
  }
  const editor = process.env.EDITOR || process.env.VISUAL || "vi";
  const before = parseDayFile(file, readFileSync(file, "utf8")).length;
  const status = spawnEditor(editor, file);
  if (status !== 0) {
    console.error(`Editor exited with status ${status}; any unsaved changes were not written.`);
    return status;
  }
  const after = parseDayFile(file, readFileSync(file, "utf8"), (header) =>
    console.error(`jrnl: warning: edited file now has an unparsed block: "## ${header.slice(0, 60)}"`)
  ).length;
  if (after !== before) console.log(`${date}: ${before} -> ${after} parseable entr${after === 1 ? "y" : "ies"}`);
  return 0;
}

const [, , cmd, ...rest] = process.argv;
const usage = `jrnl — terminal journal

  jrnl                 open your editor to write an entry
  jrnl write <text>     add an entry (auto-dated; #tags supported)
  echo <text> | jrnl    add an entry via stdin
  jrnl list [n]         show last n entries (default 5)
  jrnl show [date]      show entries for a date (default today; also "yesterday", "-N")
  jrnl edit [date]      edit a day's file in $EDITOR (default today)
  jrnl search <terms>   full-text search; "#tag" searches tags
  jrnl tags             list all tags with counts
  jrnl --help           show this help`;

switch (cmd) {
  case undefined:
    if (process.stdin.isTTY) process.exit(cmdEditor());
    else cmdWrite([]); // piped stdin is the entry text
    break;
  case "editor":
    {
      const code = cmdEditor();
      if (code) process.exit(code);
    }
    break;
  case "-h":
  case "--help":
    console.log(usage);
    break;
  case "write":
    cmdWrite(rest);
    break;
  case "list":
    cmdList(rest);
    break;
  case "show":
    cmdShow(rest);
    break;
  case "edit":
    {
      const code = cmdEdit(rest);
      if (code) process.exit(code);
    }
    break;
  case "search":
    cmdSearch(rest);
    break;
  case "tags":
    cmdTags();
    break;
  default:
    // Never treat "-options" as entry text (e.g. piped `jrnl --future-flag`).
    if (cmd.startsWith("-")) {
      console.error(`Unknown option: ${cmd} (try jrnl --help)`);
      process.exit(1);
    }
    if (!process.stdin.isTTY) cmdWrite([cmd, ...rest]);
    else console.log(usage);
}