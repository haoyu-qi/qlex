# Personal identity and long-term memory

Mini Hermes owns the personal digital-twin role, task coordination and durable memory. MacBook is the local work entry point, collector and execution node. Keep each node's model, credentials, native memory and original session files independent. Windows execution remains optional.

## Human-readable memory in Obsidian

Obsidian personal notes and daily work reports form the user-editable plaintext memory layer. Agent logs retain source evidence; Obsidian retains readable knowledge, decisions and reports; Mini stores recall-oriented summaries with references to the original notes. User corrections to an original note are grounds to revise its Mini summary, rather than overwrite the original with a stale summary.

Use the existing vault, directory conventions and locally installed Obsidian CLI workflow. Verify a write by reading it back before claiming archival success, then save a concise summary and the vault-relative reference on Mini. A completed vault write and a completed Mini update are separate acknowledgements. Daily work reports contain evidence-backed business work; personal learning and tool maintenance belong in their appropriate notes.

The user's existing Obsidian plugin handles vault-file synchronization between devices. WorkContext does not provide or change that sync layer. Hermes on each device uses its locally synchronized vault through its actual local path and CLI. Updating Mini's recall summaries is a separate operation; automatic whole-vault indexing of every note edit and recurring report jobs are not implied by file synchronization.

This is a separate service from the historical synthetic-only P1/P2 pipeline:

1. MacBook Relay reads approved work directories from dsh, Codex, Claude Code and Hermes logs. It excludes system/developer messages, reasoning, raw tool arguments and tool outputs. Tool names and user/assistant work text remain eligible. Oversized records leave an explicit omission marker.
2. A private SQLite outbox retains records across disconnections. The Mini API checks the ingest credential's device, agent and directory scope, commits records, and returns an idempotent durable acknowledgement. Pending records remain pending until that acknowledgement arrives.
3. Mini stores immutable source records and separate, versioned notes. Stable facts, decisions, preferences and task summaries can cite source record IDs. Corrections preserve earlier note versions. Archiving a record does not validate its assertions or mean a task is complete.
4. The native Hermes provider automatically recalls bounded relevant context before a turn and archives completed primary turns. Its search/get/remember tools read and update the same Mini database. Recall uses lexical ranking with Chinese bigrams; this implementation does not automatically synthesize every historical log into verified facts.
5. MacBook Hermes uses the memory MCP client for explicit search, get and remember against Mini. It keeps its built-in memory and reports unavailable central memory honestly.

## Components

```sh
workcontext serve memory --config /private/path/service.json
workcontext relay --config /private/path/relay.json
workcontext mcp memory --config /private/path/client.json
```

The memory service binds to `127.0.0.1`. Put remote access behind authenticated tailnet HTTPS. Issue separate owner, read-only and ingest credentials; store only token hashes in server policy and plaintext token values in private client files. Each policy requires an explicit expiry. There is no remote shell or execution endpoint in this service.

Install `integrations/hermes/workcontext-memory` into the intended Hermes profile's `plugins` directory. Its private `config.json` contains `app_root` (the installed WorkContext source directory) and `database` (the Mini SQLite path). Select `memory.provider: workcontext-memory`, enable that plugin and keep the Hermes `memory` toolset enabled. Preserve the original model and existing MCP entries. Back up configuration and SOUL before applying the role templates, then activate the new configuration through a supported Hermes restart or fresh session.

MacBook Relay configuration includes `url`, `token_file`, `device`, `outbox`, `allowed_roots` and explicit `sources` with `agent`, `path` and optional `format`. Use canonical absolute work-directory roots; Hermes SQLite sources use `format: hermes-sqlite`. Configure a private LaunchAgent or equivalent supervisor for continuous collection. Health records distinguish queued, delivered and retrying states.

Clients may specify up to two `fallback_urls` for network failures. An authenticated SSH local forward bound to `127.0.0.1` can provide an alternate encrypted path to Mini's loopback API. Verify Mini's host key, retain bearer authentication and supervise the tunnel. HTTP is accepted only on IPv4 loopback; authentication and policy failures are returned without trying another endpoint.

Before claiming success, check a fresh Mini Hermes session can retrieve a fact saved in an earlier session, verify a MacBook source record is committed on Mini, and confirm retries do not duplicate it. Preserve the evidence locally. Keep personalized SOUL, native memory snapshots, database files, credentials and deployment reports out of public source bundles.

## Reusing work experience

Borrowing the distinction between facts and reusable experience from
[Hy Memory's Working and Coding scenes](https://github.com/Tencent-Hunyuan/Hy-Memory/blob/23cb604ec4e27b69905a361cb38553e1c350480d/docs/scene_coding_usage.md),
WorkContext uses the existing versioned notes store for `experience` notes.
Use this kind for a method worth repeating. Include when it applies, the steps
that worked, and how the result was checked. Mini Hermes and the MacBook MCP
both accept archived record IDs in `evidence`. Correct an existing note using
its `note_id`. A revision keeps the existing title, project and kind unless
the caller supplies new values. Include the source IDs that support the revised
content in `evidence`. Existing notes and source records can be searched
immediately without a database migration or a backfill.

For example, call `workcontext_memory.search` from the MCP client with:

```json
{"query":"relay retry","project":"workcontext","kind":"experience"}
```

The native Hermes search accepts the same fields. On the HTTP API, use
`GET /memory/search?q=relay+retry&project=workcontext&kind=experience`.
`project` matches the exact stored project label (the relay uses the working
directory basename). Use `kind=record` for archived source records or omit
`kind` to search both notes and records. The browser console exposes both
filters when searching Mini. The optional `project` filter also applies to
`GET /memory/context`.

Automatic Hermes recall starts with the highest-ranked matching note when
available, then fills the character budget with ranked matches. The context
includes each note's kind and version and up to three source IDs. Use `get`
for the full note and the remaining source IDs. Archiving a turn and writing
a reusable experience remain separate, explicit workflow steps.

## Calendar-day coverage

Keyword search returns ranked excerpts; it does not enumerate a day's work. Use
`workcontext_memory_activity(day="YYYY-MM-DD")` on Mini, or the MCP
`workcontext_memory.activity` tool, and follow `next_offset` until null. The
authenticated read API is `GET /memory/activity?day=YYYY-MM-DD&offset=0&limit=100`.
Days use Asia/Shanghai boundaries. `undated_records` counts the entire archive's
records without valid occurrence timestamps, not that day's missing records.
Import time and session-file creation dates are never substitutes for occurrence.

For a frozen, complete local export on Mini:

```sh
python -m workcontext.memory_activity --database /private/memory.sqlite --day YYYY-MM-DD --output /private/day.json
```

The relay reads ISO timestamps, Unix seconds and Unix milliseconds, including
DSH's `time` field. Native Hermes turn capture records completion time and keeps
it unchanged on retries. Historical timestamp repairs require matching original
records or exact native messages and a database backup; unproven dates stay
unknown.

`python -m workcontext.work_evidence --config /private/evidence.json` can collect
local workspace file metadata and paginated Lark user edited-time search results.
An optional configured SSH command publishes only the JSON snapshot to Mini;
credentials and source files stay local. Use a dedicated forced-command upload
key. Check generation time and each source status; permission failures must not
be interpreted as an empty workday. A `last_successful` file listing is explicitly
dated historical evidence, not current coverage. Background processes may lack
macOS Documents access even when an interactive client can read that directory.
