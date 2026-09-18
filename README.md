# jrnl — Terminal Journaling Tool

A zero-dependency (runtime) CLI for personal journaling. Entries are automatically dated and timestamped, stored as human-readable Markdown files, and fully searchable with tag support.

## Requirements

- Node.js >= 18 (uses only `node:*` builtins; no runtime dependencies)
- TypeScript is required only for building (`npm install`)

## Setup

```sh
npm install     # installs typescript + @types/node (dev only)
npm run build   # compiles src/jrnl.ts -> dist/jrnl.js
npm link        # optional: installs 'jrnl' as a global command
```

## Usage

```
jrnl                   open $EDITOR to write an entry interactively
jrnl write <text>      add an entry inline (auto-dated; #tags supported)
echo <text> | jrnl     add an entry via stdin (also: jrnl <text> when piped)
jrnl list [n]          show last n entries (default 5)
jrnl show [date]       show all entries for a date (default today; YYYY-MM-DD)
jrnl search <terms>    full-text search; "#tag" searches by tag
jrnl tags              list all tags with counts
jrnl (no args/unknown) print usage
```

### Examples

```sh
jrnl                                   # opens your editor (EDITOR / VISUAL / vi)
jrnl write "Standup went well #work"   # inline entry with tag
echo "Quick thought #ideas" | jrnl     # stdin entry
jrnl search coffee                     # body + tag search
jrnl search "#work"                    # tag-only search
jrnl search coffee "#work"             # multiple terms = AND
jrnl show 2026-09-18                   # view a specific day
jrnl list 10                           # 10 most recent entries
```

## Behavior

- **Auto-dating**: every entry is stamped with `YYYY-MM-DD HH:MM` at write time (local time).
- **Tags**: any `#token` (alphanumeric, `-`, `_`) inside the text is recognized; tags are lowercased and deduplicated. `jrnl search "#tag"` matches entries by tag.
- **Editor mode** (`jrnl` with no args): spawns `$EDITOR`/`$VISUAL` (default `vi`) on a temp draft file. Lines beginning with `#:` are instruction lines and are stripped on save. Saving an empty draft writes nothing.
- **Stdin mode**: if stdin is not a TTY (e.g. piped) and the subcommand is unrecognized, remaining args are treated as an entry.

## Storage Layout

```
~/.journal/                  # override with JOURNAL_DIR env var
└── 2026/
    └── 09/
        └── 2026-09-18.md    # one file per day
```

Entries are appended to the day's file as blocks:

```markdown
## 2026-09-18 05:01

Entry text here, with #tags inline.

Tags: #tags #drinks        # generated summary line (when tags present)
```

Because files are plain Markdown, they work with `grep`, editors, and any backup/sync tooling. Note that lines starting with `## ` followed by a timestamp in the body of an entry would be parsed as a new entry header.

## Environment Variables

| Variable      | Purpose                                        | Default            |
| ------------- | ---------------------------------------------- | ------------------ |
| `JOURNAL_DIR` | Root directory for journal files               | `~/.journal`       |
| `EDITOR`      | Editor used by bare `jrnl`                     | `VISUAL` then `vi` |
| `VISUAL`      | Fallback for `EDITOR`                          | `vi`               |

## Code Overview (`src/jrnl.ts`)

Single-file TypeScript CLI (no external runtime deps).

| Function       | Purpose                                                                    |
| -------------- | -------------------------------------------------------------------------- |
| `isoNow` / `timeNow` | Current local date (`YYYY-MM-DD`) and time (`HH:MM`) strings          |
| `dayFile`      | Path of a day's file: `JOURNAL_DIR/YYYY/MM/YYYY-MM-DD.md`                  |
| `parseEntries` | Walks `JOURNAL_DIR`, reads `.md` files, splits on `^## ` blocks, parses headers/tags into `Entry[]` sorted chronologically |
| `readStdin`    | Blocking read of piped stdin                                               |
| `cmdWrite`     | `write` command: inline args or stdin → `saveEntry`                        |
| `saveEntry`    | Appends a timestamped block (plus `Tags:` line) to the day file            |
| `cmdEditor`    | Bare invocation: temp draft seeded with `TEMPLATE`, spawned `$EDITOR`, strips `#:` lines, saves non-empty drafts |
| `matches`      | Predicate: `#tag` → tag match; otherwise case-insensitive substring match  |
| `cmdSearch`    | Multi-term AND search over all entries                                     |
| `cmdList`      | One-line summaries of the n most recent entries                            |
| `cmdTags`      | Aggregate tag counts, sorted by frequency                                  |
| `cmdShow`      | Full entries for one date                                                  |
| Command router | `switch` on `process.argv[2]` at the bottom of the file; piped non-TTY input without a known subcommand is treated as an entry |

## Development

- **Build**: `npm run build` (TypeScript, `tsc`)
- **Run without build**: `npx tsx src/jrnl.ts` (if tsx is available) or rebuild first
- **Verify**: e.g. `JOURNAL_DIR=$(mktemp -d) node dist/jrnl.js write "test #tag" && JOURNAL_DIR=$JOURNAL_DIR node dist/jrnl.js search "#tag"`

## Limitations / Future Ideas

- Search is case-insensitive substring matching, not fuzzy or regex
- No editing or deleting of existing entries
- `show` requires exact `YYYY-MM-DD` (no "yesterday" alias)
- All entries are loaded into memory for each query (fine for personal scale)