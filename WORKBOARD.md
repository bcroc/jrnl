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

- [x] WB-7 Warn on unparsed blocks — done 2026-09-18: `parseDayFile` takes an `onSkipped` callback; `parseEntries` warns (deduped) on stderr for skipped blocks and for `.md` files with no entries. Header now also rejects impossible clock times (`25:99`).
- [x] WB-8 Durable writes — done 2026-09-18: `saveEntry` writes via `open(O_APPEND)` + `write` + `fsync` before reporting success; on failure it exits 1 after echoing the entry text to stderr so nothing is silently lost.

### Features

- [x] WB-9 Relative dates — done 2026-09-18: `resolveDate` in src/parse.ts supports `YYYY-MM-DD`, `today`, `yesterday`, `tomorrow`, `-N[ d]`; wired into `show` (and `edit`).
- [x] WB-10 `edit` command — done 2026-09-18: `jrnl edit [date]` opens the day file in `$EDITOR` via the shared `spawnEditor` shell wrapper, reports parseable-entry count changes, warns on newly unparsable blocks, propagates editor exit codes.
- [x] WB-11 Tags in `list` output — closed as not-a-bug on re-review: `cmdList` already prints the `[#tag ...]` segment (was wrong in the original review).

### Performance (low priority)

- [x] WB-12 Full reparse per query — done 2026-09-18: `parseEntries` (src/jrnl.ts) keeps an mtime+size-keyed parse cache at `JOURNAL_DIR/.jrnl-cache.json`; cache hits skip `readFileSync` + `parseDayFile` entirely (proven by a chmod-000 test), cached warnings are replayed so output is identical, every cache failure degrades to a full reparse, and empty journals get no cache file. Keyed by path with nanosecond mtime + size inside each entry, so same-tick rewrites still invalidate.

### Hygiene (minor)

- [x] WB-13 `jrnl write --flag` treats `--flag` as entry text — closed as by-design: explicit `write <text>` takes free text; only the *router* (unknown subcommands) rejects dash-args, so future flags can't be swallowed silently.

## Notes for implementers

- Keep `saveEntry` (src/jrnl.ts) and `parseDayFile` (src/parse.ts) block formats in sync — the tests pin the write→parse round-trip.
- Run `npm test` after each item; end-to-end tests spawn `dist/jrnl.js` against throwaway `JOURNAL_DIR`s. Editor-mocking tests must reference the draft as `$1`.
- Update README.md whenever behavior or usage changes.