# jrnl Development Workboard

Improvement backlog from the 2026-09-18 code review, ordered by impact. Done items are kept for context.

Status: `[ ]` open · `[~]` in progress · `[x]` done

## Done — 2026-09-18 (commit 14ff6d1)

- [x] WB-1 — Dash-args never saved as entries; `--help`/`-h` print usage; unknown `-options` exit 1 (previously piped `jrnl --flag` wrote the flag as an entry)
- [x] WB-2 — `$EDITOR` runs via `$SHELL -c '<editor> "$@"'`, so values with arguments (e.g. `EDITOR="code -w"`) work; launch failure reports and exits 127
- [x] WB-3 — Editor temp dirs cleaned up on all paths (`try/finally`; previously leaked one dir per bare run)
- [x] WB-4 — Piped stdin with no subcommand is saved as an entry (previously the documented `echo "text" | jrnl` opened the editor and discarded the piped text)
- [x] WB-5 — Test harness: parser extracted to `src/parse.ts`, `node:test` suite in `src/parse.test.ts`, `npm test`, `engines >=18`
- [x] WB-6 — `dirname(file)` instead of `join(file, "..")` for the entry directory

## Open

### Correctness / robustness

- [ ] WB-7 Warn on unparsed blocks — `parseDayFile` silently drops any `## ` block whose header doesn't match `YYYY-MM-DD HH:MM` (torn writes, hand-edited headings), so entries vanish from search/list without a trace. Warn on stderr when a non-empty block is skipped; consider surfacing non-entry `.md` files found in `JOURNAL_DIR`.
- [ ] WB-8 Durable writes — `appendFileSync` can leave a torn entry on Ctrl-C or disk-full; that entry then fails the header parse (pairs with WB-7). Consider write-temp-then-append, or at least verify a trailing newline before exit.

### Features

- [ ] WB-9 Relative dates for `show`/`list` — e.g. `jrnl show yesterday`, `show -3d`. Biggest usability win; README lists exact-`YYYY-MM-DD` as a known limitation.
- [ ] WB-10 `edit` command — currently there is no way to fix a typo in a saved entry. Smallest useful version: `jrnl edit [date]` opens that day's file in `$EDITOR` (reuse the spawnEditor shell-wrapper path).
- [ ] WB-11 Tags in `list` output — tags appear in `search`/`show` but not `list`; add the `[#tag ...]` segment to list lines.

### Performance (low priority)

- [ ] WB-12 Full reparse per query — every command reads and parses every `.md` file. Fine at personal scale (documented); if it bites, add an mtime-based cache or per-year index first.

### Hygiene (minor)

- [ ] WB-13 `jrnl write --flag` treats `--flag` as entry text; decide whether the explicit `write` subcommand should reject dash-args the way the router now does for unknown subcommands.

## Notes for implementers

- Keep `saveEntry` (src/jrnl.ts) and `parseDayFile` (src/parse.ts) block formats in sync — the tests pin the write→parse round-trip.
- Run `npm test` after each item; end-to-end tests spawn `dist/jrnl.js` against throwaway `JOURNAL_DIR`s. Editor-mocking tests must reference the draft as `$1`.
- Update README.md whenever behavior or usage changes.