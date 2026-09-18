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
jrnl                   open $EDITOR to write an entry interactively (TTY only)
jrnl write <text>      add an entry inline (auto-dated; #tags supported)
echo <text> | jrnl     add an entry via stdin (also: jrnl <text> when piped)
jrnl list [n]          show last n entries (default 5)
jrnl show [date]       show entries for a date (default today; YYYY-MM-DD,
                       "today", "yesterday", "tomorrow", or "-N" = N days ago)
jrnl edit [date]       open a day's file in $EDITOR (default today)
jrnl search <terms>    full-text search; "#tag" searches by tag
jrnl tags              list all tags with counts
jrnl --help            print usage
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
jrnl show yesterday                     # relative dates work
jrnl show -7                            # a week ago
jrnl edit yesterday                     # fix or extend a day's file
jrnl list 10                           # 10 most recent entries
```

## Behavior

- **Auto-dating**: every entry is stamped with `YYYY-MM-DD HH:MM` at write time (local time).
- **Tags**: any `#token` (alphanumeric, `-`, `_`) inside the text is recognized; tags are lowercased and deduplicated. `jrnl search "#tag"` matches entries by tag.
- **Editor mode** (`jrnl` with no args on a TTY): spawns `$EDITOR`/`$VISUAL` (default `vi`) on a temp draft file via the user's shell, so `EDITOR="code -w"` style values work. Lines beginning with `#:` are instruction lines and are stripped on save. Saving an empty draft writes nothing; a nonzero editor exit saves nothing and propagates the exit code.
- **Stdin mode**: with piped stdin and no recognized subcommand, the piped text (plus any remaining args) is the entry. Unknown `-options` are rejected instead of saved (e.g. a future `jrnl --flag` can't silently become an entry).
- **Durability**: entries are written with a single append + `fsync`, so "Saved" means on disk. On write failure the entry text is echoed to stderr so nothing is silently lost.
- **Warnings**: `.md` files in the journal that contain no parseable entries, and `## ` blocks whose header isn't `## YYYY-MM-DD HH:MM` (with a valid clock time), produce a warning on stderr — corrupt or hand-edited files can't silently vanish from search results.
- **Editing**: `jrnl edit [date]` opens the day's file in `$EDITOR`/`$VISUAL` (same shell-wrapper behavior as editor mode). After the editor exits, jrnl reports if the number of parseable entries changed and warns about newly unparsable blocks.

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

TypeScript CLI (no external runtime deps). Pure parsing/tag logic lives in `src/parse.ts` (`extractTags`, `parseDayFile`, `matches`); `src/jrnl.ts` holds the commands.

| Function       | Purpose                                                                    |
| -------------- | -------------------------------------------------------------------------- |
| `isoNow` / `timeNow` | Current local date (`YYYY-MM-DD`) and time (`HH:MM`) strings          |
| `dayFile`      | Path of a day's file: `JOURNAL_DIR/YYYY/MM/YYYY-MM-DD.md`                  |
| `parseEntries` | Walks `JOURNAL_DIR`, reads `.md` files, delegates to `parseDayFile` (src/parse.ts); returns `Entry[]` sorted chronologically |
| `readStdin`    | Blocking read of piped stdin                                               |
| `cmdWrite`     | `write` command: inline args or stdin → `saveEntry`                        |
| `saveEntry`    | Appends a timestamped block (plus `Tags:` line) to the day file            |
| `cmdEditor`    | Bare invocation: temp draft seeded with `TEMPLATE`, editor run through `$SHELL -c '<editor> "$@"'` (draft is `$1`), strips `#:` lines, saves non-empty drafts; always cleans up the temp dir |
| `matches`      | Predicate: `#tag` → tag match; otherwise case-insensitive substring match  |
| `cmdSearch`    | Multi-term AND search over all entries                                     |
| `cmdList`      | One-line summaries of the n most recent entries                            |
| `cmdTags`      | Aggregate tag counts, sorted by frequency                                  |
| `cmdShow`      | Full entries for one date                                                  |
| `cmdEdit`      | Opens the day file in `$EDITOR`, reports entry-count changes on save       |
| Command router | `switch` on `process.argv[2]` at the bottom of the file; piped non-TTY input without a known subcommand is treated as an entry |

Pure helpers live in `src/parse.ts`: `resolveDate` maps `YYYY-MM-DD` / `today` / `yesterday` / `tomorrow` / `-N` to a date string (used by `show` and `edit`).

## Development

- **Build**: `npm run build` (TypeScript, `tsc`)
- **Test**: `npm test` (builds, then runs the `node:test` suite in `src/parse.test.ts` — unit tests for parsing/tags plus end-to-end CLI runs against throwaway `JOURNAL_DIR`s)
- **Run without build**: `npx tsx src/jrnl.ts` (if tsx is available) or rebuild first
- **Verify**: e.g. `JOURNAL_DIR=$(mktemp -d) node dist/jrnl.js write "test #tag" && JOURNAL_DIR=$JOURNAL_DIR node dist/jrnl.js search "#tag"`

## Limitations / Future Ideas

- Search is case-insensitive substring matching, not fuzzy or regex
- No deleting of existing entries (editing exists via `jrnl edit`)
- All entries are loaded into memory for each query (fine for personal scale)