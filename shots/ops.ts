// Draws this look's New Tab page the way cmux runs it, for screenshots: loads customize/main.js
// into cmux's own app runtime (cmux-tui/crates/cmux-app-host/js, its reference fake host), answers
// the reads from the fixtures below, mounts the cmux.newtab/1 export and writes every scene batch
// it sent. shots/NewTabLook.gallery.tsx replays them through cmux's web New Tab page.
//
//   bun LOOK/shots/ops.ts LOOK OUT_DIR     (run from the root of a cmux checkout)
//
// The fixtures are the same chats cmux's gallery shows today's templates with
// (webviews/src/gallery/fixtures/acpmux.ts), so before and after compare one for one.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"

const [lookArg, outArg] = process.argv.slice(2)
// cmux's reference app host, from the cmux checkout this runs in.
const { FakeHost } = await import(path.resolve("cmux-tui/crates/cmux-app-host/js/test/fake-host.ts"))
const look = path.resolve(lookArg ?? ".")
const out = path.resolve(outArg ?? "ops")
mkdirSync(out, { recursive: true })

const MIN = 60 * 1000
const NOW = Date.now()
const CWD = "/Users/you/src/atlas-web"
const TITLES = [
  "Add retries to the fetch helper",
  "Fix the flaky sidebar drag test",
  "Localize the changes view",
  "Why does the build cache miss on CI?",
  "Draft the release notes for 0.42",
  "Port the settings page to React Aria",
  "Profile the transcript scroll jank",
  "Review PR 17516 route tiers",
  "Make the composer location row smaller",
  "Clean up the old maclease scripts",
  "Explain the pane protocol handshake",
  "Add a dark theme screenshot test",
]
const project = (cwd: string) => cwd.split("/").pop()

// The gallery's manySessions(count), as agent_chat.list rows.
function many(count: number, quiet = false) {
  return Array.from({ length: count }, (_, i) => {
    const cwd = i % 4 === 3 ? "/Users/you/src/cmux" : CWD
    const state = quiet ? "idle" : i === 0 ? "working" : i === 2 ? "input" : "idle"
    return {
      id: `chat-${i}`,
      title: TITLES[i % TITLES.length],
      harness: i % 3 === 1 ? "codex" : "claude",
      state,
      unread: !quiet && i === 1,
      project: project(cwd),
      cwd,
      workspace: null,
      machine: null,
      step: state === "working" ? "Running the tests" : null,
      error: null,
      since_ms: NOW - (3 + i * 47) * MIN,
      updated_ms: NOW - (3 + i * 47) * MIN,
      created_ms: NOW - (60 + i * 47) * MIN,
      pull_requests: [],
      preview: "Updated the tests and the docs; all checks pass.",
    }
  })
}

// Chats that need the person (the Default page's suggestions), then quiet ones.
function attention() {
  const chat = (id: string, title: string, state: string, cwd: string, minutes: number, error: string | null = null) => ({
    id,
    title,
    harness: "claude",
    state,
    unread: false,
    project: project(cwd),
    cwd,
    workspace: null,
    machine: null,
    step: null,
    error,
    since_ms: NOW - minutes * MIN,
    updated_ms: NOW - minutes * MIN,
    created_ms: NOW - (minutes + 30) * MIN,
    pull_requests: [],
    preview: null,
  })
  return [
    chat("look-failed", "Composer + picker polish", "failed", "/Users/you/src/cmux", 2, "Hit an error while running the gallery checks."),
    chat("look-input", "Ship the release notes for 0.64", "input", "/Users/you/src/manaflow", 12),
    ...many(6, true).map((c, i) => ({ ...c, id: `quiet-${i}` })),
  ]
}

const PROJECTS = ["/Users/you/src/atlas-web", "/Users/you/src/cmux", "/Users/you/src/manaflow", "/Users/you/src/notes"]
const VARIANTS: Record<string, () => any[]> = {
  empty: () => [],
  few: () => many(6),
  attention,
  "10k": () => many(10000).map((c, i) => ({ ...c, id: `big-${i}` })),
}

const manifest = JSON.parse(readFileSync(path.join(look, "customize/cmux-app.json"), "utf8"))
const exportName = manifest.implements["cmux.newtab/1"].export
const source = readFileSync(path.join(look, "customize", manifest.runtime.main), "utf8")

for (const [variant, chats] of Object.entries(VARIANTS)) {
  const rows = chats()
  const host = new FakeHost(source, { app: { id: manifest.id, version: manifest.version }, apiVersion: "1.0.0" })
  const reads: unknown[] = []
  host.handlers["agent_chat.list"] = (params: any) => {
    reads.push(params)
    // The shape of a host with recent reads (GAPS.md G1): newest first, cut to `limit`.
    const sorted = [...rows].sort((a, b) => b.updated_ms - a.updated_ms)
    return { ok: true, body: { value: { chats: typeof params?.limit === "number" ? sorted.slice(0, params.limit) : sorted } } }
  }
  host.handlers["agent_cli.list"] = () => ({ ok: true, body: { value: { agents: [{ id: "claude", name: "Claude Code" }, { id: "codex", name: "Codex" }] } } })
  host.handlers["project.list"] = (params: any) => ({
    ok: true,
    // cmux.call resolves with the reply's `value` (ABI.md: ok replies are {"value", ...}).
    body: {
      value: {
        projects: PROJECTS.slice(0, params?.limit ?? PROJECTS.length).map((p, i) => ({
          path: p,
          name: project(p),
          last_used_ms: String(NOW - i * 3600 * 1000),
          sources: {},
          overlay: {},
          state: "present",
        })),
        sources: [],
      },
    },
  })
  host.fallback = () => ({ ok: true, body: { value: {} } })
  host.mount("m1", exportName, { surface: "newTab", cwd: CWD })
  await host.settle(20)
  const batches = host.batches("m1")
  const errors = host.logs.filter(([level]) => level === "error")
  writeFileSync(path.join(out, `${variant}.json`), JSON.stringify({ variant, cwd: CWD, reads, batches }))
  console.log(JSON.stringify({ variant, chats: rows.length, batches: batches.length, ops: batches.flat().length, reads, errors }))
  // A read the look could not use draws its error state, not a log: a shot of that is no shot.
  const failedRead = JSON.stringify(batches).includes("Cannot read")
  if (failedRead) console.error(`${variant}: the look drew "Cannot read ..."; the fixtures answer in a shape it cannot read`)
  if (!batches.length || errors.length || failedRead) process.exitCode = 1
}
