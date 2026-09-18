// Pure entry parsing and tag extraction — no filesystem access, no global state.
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

export function parseDayFile(path: string, content: string): Entry[] {
  const entries: Entry[] = [];
  for (const block of content.split(/^## /m)) {
    if (!block.trim()) continue;
    const lines = block.split("\n");
    const m = lines[0].match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/);
    if (!m) continue;
    const body = lines.slice(1).join("\n").trimEnd();
    entries.push({ date: m[1], time: m[2], tags: extractTags(body), body, file: path });
  }
  return entries;
}

export function matches(entry: Entry, term: string): boolean {
  const t = term.toLowerCase();
  if (t.startsWith("#")) return entry.tags.includes(t.slice(1));
  return (entry.body + " " + entry.tags.join(" ")).toLowerCase().includes(t);
}