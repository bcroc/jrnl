// Pure entry parsing, tag extraction, and date resolution — no filesystem access, no global state.
// The block format written by saveEntry (src/jrnl.ts) must stay in sync with
// parseDayFile: an entry starts at "## YYYY-MM-DD HH:MM".

export interface Entry {
  date: string;
  time: string;
  tags: string[];
  body: string;
  file: string;
}

export function extractTags(text: string): string[] {
  const tags = new Set<string>();
  for (const m of text.matchAll(/#([a-zA-Z0-9_-]+)/g)) tags.add(m[1].toLowerCase());
  return [...tags];
}

export function parseDayFile(path: string, content: string, onSkipped?: (header: string) => void): Entry[] {
  const entries: Entry[] = [];
  for (const block of content.split(/^## /m)) {
    if (!block.trim()) continue;
    const lines = block.split("\n");
    // Header shape: real clock times only, so corrupt/impossible blocks are skipped (and warned about).
    const m = lines[0].match(/^(\d{4}-\d{2}-\d{2}) ([01]\d|2[0-3]):([0-5]\d)$/);
    if (!m) {
      onSkipped?.(lines[0]);
      continue;
    }
    const body = lines.slice(1).join("\n").trimEnd();
    entries.push({ date: m[1], time: `${m[2]}:${m[3]}`, tags: extractTags(body), body, file: path });
  }
  return entries;
}

export function matches(entry: Entry, term: string): boolean {
  const t = term.toLowerCase();
  if (t.startsWith("#")) return entry.tags.includes(t.slice(1));
  return (entry.body + " " + entry.tags.join(" ")).toLowerCase().includes(t);
}

export function formatLocalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Accepts YYYY-MM-DD, "today", "yesterday", "tomorrow", or "-N"/"-Nd" (N days ago).
// Returns null for anything else. Pure: caller supplies "now".
export function resolveDate(value: string, now: Date): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const v = value.toLowerCase();
  const rel = v.match(/^-(\d+)d?$/);
  const offset = v === "today" ? 0 : v === "yesterday" ? 1 : v === "tomorrow" ? -1 : rel ? Number(rel[1]) : null;
  if (offset === null) return null;
  return formatLocalDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset));
}