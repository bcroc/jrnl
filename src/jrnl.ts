#!/usr/bin/env node
import { mkdirSync, appendFileSync, readFileSync, readSync, existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const JOURNAL_DIR = process.env.JOURNAL_DIR ?? join(homedir(), ".journal");

function isoNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dayFile(date = isoNow()): string {
  const [y, m] = date.split("-");
  return join(JOURNAL_DIR, y, m, `${date}.md`);
}

interface Entry {
  date: string;
  time: string;
  tags: string[];
  body: string;
  file: string;
}

function parseEntries(): Entry[] {
  if (!existsSync(JOURNAL_DIR)) return [];
  const entries: Entry[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, name.name);
      if (name.isDirectory()) walk(full);
      else if (name.name.endsWith(".md")) {
        const content = readFileSync(full, "utf8");
        const blocks = content.split(/^## /m).filter((b) => b.trim());
        for (const block of blocks) {
          const lines = block.split("\n");
          const header = lines[0]; // YYYY-MM-DD HH:MM
          const m = header.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/);
          if (!m) continue;
          const bodyLines = lines.slice(1);
          const tags: string[] = [];
          const bodyText: string[] = [];
          for (const l of bodyLines) {
            const tagMatch = l.matchAll(/#([a-zA-Z0-9_-]+)/g);
            for (const t of tagMatch) tags.push(t[1].toLowerCase());
            bodyText.push(l);
          }
          entries.push({
            date: m[1],
            time: m[2],
            tags: [...new Set(tags)],
            body: bodyText.join("\n").trimEnd(),
            file: full,
          });
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
  mkdirSync(join(file, ".."), { recursive: true });
  const tagLine = [...text.matchAll(/#([a-zA-Z0-9_-]+)/g)].map((t) => t[1]);
  let block = `\n## ${isoNow()} ${timeNow()}\n\n${text}\n`;
  if (tagLine.length) block += `\nTags: ${[...new Set(tagLine.map((t) => t.toLowerCase()))].map((t) => `#${t}`).join(" ")}\n`;
  appendFileSync(file, block);
  console.log(`Saved to ${file} at ${timeNow()}`);
}

const TEMPLATE = [
  "#: jrnl — write your entry below, save and quit to record it.",
  "#: Lines starting with '#:' are removed; use #tags anywhere in your entry.",
  "#:",
  "#:",
];

function cmdEditor() {
  const editor = process.env.EDITOR || process.env.VISUAL || "vi";
  const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
  const draft = join(dir, "draft.md");
  writeFileSync(draft, TEMPLATE.join("\n") + "\n");
  const result = spawnSync(editor, [draft], { stdio: "inherit" });
  if (result.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    process.exit(result.status ?? 1);
  }
  const content = readFileSync(draft, "utf8");
  rmSync(dir, { recursive: true });
  const text = content
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#:"))
    .join("\n")
    .trim();
  if (!text) {
    console.log("Empty entry, nothing saved.");
    return;
  }
  saveEntry(text);
}

function matches(entry: Entry, term: string): boolean {
  const t = term.toLowerCase();
  if (t.startsWith("#")) return entry.tags.includes(t.slice(1));
  return (entry.body + " " + entry.tags.join(" ")).toLowerCase().includes(t);
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
  const date = args[0] ?? isoNow();
  const hits = parseEntries().filter((e) => e.date === date);
  if (!hits.length) {
    console.log(`No entries on ${date}.`);
    return;
  }
  for (const e of hits) printEntry(e);
}

const [, , cmd, ...rest] = process.argv;
const usage = `jrnl — terminal journal

  jrnl                 open your editor to write an entry
  jrnl write <text>     add an entry (auto-dated; #tags supported)
  echo <text> | jrnl    add an entry via stdin
  jrnl list [n]         show last n entries (default 5)
  jrnl show [date]      show all entries for a date (default today)
  jrnl search <terms>   full-text search; "#tag" searches tags
  jrnl tags             list all tags with counts`;

switch (cmd) {
  case undefined:
    cmdEditor();
    break;
  case "editor":
    cmdEditor();
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
  case "search":
    cmdSearch(rest);
    break;
  case "tags":
    cmdTags();
    break;
  default:
    if (!process.stdin.isTTY) cmdWrite(process.argv.slice(2));
    else console.log(usage);
}