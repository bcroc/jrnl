# AGENTS.md — jrnl

Terminal journaling CLI (`jrnl`): zero runtime dependencies, single-file TypeScript in `src/jrnl.ts`, compiled to `dist/jrnl.js`. Entries are appended as Markdown blocks to `JOURNAL_DIR/YYYY/MM/YYYY-MM-DD.md` (default `~/.journal`) and parsed back by splitting on `^## ` headers of the form `YYYY-MM-DD HH:MM`.

## Commands

```sh
npm install      # dev deps only (typescript, @types/node)
npm run build    # tsc -> dist/jrnl.js; the ONLY check configured
npm test         # build + node:test suite (src/parse.test.ts)
npm link         # optional global 'jrnl' command
node dist/jrnl.js <cmd>   # run without linking
```

There is no linter or formatter. `npm test` covers the parser and the CLI end-to-end (spawned against throwaway `JOURNAL_DIR`s); for manual verification use a smoke test against a throwaway journal:

```sh
npm run build
d=$(mktemp -d)
JOURNAL_DIR="$d" node dist/jrnl.js write "test #tag"
JOURNAL_DIR="$d" node dist/jrnl.js search "#tag"
JOURNAL_DIR="$d" node dist/jrnl.js list
rm -rf "$d"
```

Also exercise editor mode (`node dist/jrnl.js` with EDITOR set) and piped stdin (`echo hi | node dist/jrnl.js`) when touching those paths.

## Conventions (observed in src/jrnl.ts)

- ESM (`"type": "module"`, module Node16); import builtins with the `node:` prefix; no external runtime deps.
- Strict TypeScript, target ES2022.
- Layout: `src/parse.ts` is pure parsing/tag logic (no fs, no process) — `extractTags`, `parseDayFile`, `matches`; `src/jrnl.ts` holds commands; tests in `src/parse.test.ts` use `node:test` (zero deps) and spawn `dist/jrnl.js`.
- One command = one `cmdX` function; the router is the `switch` on `process.argv[2]` at the bottom of the file. Add new commands there and to the `usage` string.
- Date args go through `resolveDate` (src/parse.ts): `YYYY-MM-DD`, `today`, `yesterday`, `tomorrow`, `-N`; it returns `null` for anything else and callers must exit 1 on that.
- Tags: `#token` (alnum, `-`, `_`), lowercased and deduplicated; `saveEntry` appends a `Tags:` summary line.
- Update README.md when CLI behavior or usage changes — it mirrors the in-code `usage` text.

## Pitfalls

- `dist/` is gitignored — run `npm run build` after cloning or before running anything.
- Never write tests/experiments to the real `~/.journal`; always set `JOURNAL_DIR` to a temp dir.
- Parser contract: an entry starts at a line matching `^## YYYY-MM-DD HH:MM$` with a valid clock time (impossible times like `25:99` are skipped + warned). Non-entry `## ` blocks and entry-less `.md` files warn on stderr. Keep `saveEntry` (src/jrnl.ts) and `parseDayFile` (src/parse.ts) block formats in sync.
- Editor mode strips lines starting with `#:` (the `TEMPLATE` hint lines) before saving. `$EDITOR` is run via `$SHELL -c '<editor> "$@"'` — the draft path is `$1` inside EDITOR strings (relevant when writing editor-mocking tests).
- Piped stdin with no/unknown subcommand is saved as an entry, but args starting with `-` are always rejected as unknown options — never route flags into `cmdWrite`.
- `readStdin` blocks on fd 0; piped non-TTY input with an unrecognized subcommand is treated as an entry, not a usage error.
- macOS `mktemp -d` returns `/var/folders/...` paths, not `/tmp` — capture the dir in a variable, don't glob `/tmp/tmp.*`.