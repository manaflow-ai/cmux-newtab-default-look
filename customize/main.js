// Default: cmux's Default New Tab page as a look, laid out like Claude Code desktop's new-session
// screen. Centered over the composer: the environment card (the folder the chat starts in, this
// Mac's other recent projects, Choose environment) and the suggestions card (the chats that need
// you), then the five most recent chats as quiet rows. The composer sits at the page's foot.
//
// Built only on the public customization API: cmux.newtab/1 draws the page once
// tabs.newTabApp names this app (cmux-setup.json sets it). Reads: agent_chat:read and
// project:read (granted at install). Clicks: actions:run (start a chat, open one, choose a
// folder) and workspace:write (show a chat's workspace), turned on in Settings > Apps > My views.

const RECENT = 5
const OTHER_PROJECTS = 3
const MINUTE = 60 * 1000

const [chats, setChats] = signal([])
const [attention, setAttention] = signal([])
const [projects, setProjects] = signal([])
const [loaded, setLoaded] = signal(false)
const [error, setError] = signal(null)
const [now, setNow] = signal(Date.now())
const [draft, setDraft] = signal("")
const [cwd, setCwd] = signal(null)

const message = (e) => (e instanceof Error ? e.message : (e && e.message) || String(e))
const lastActivity = (c) => Math.max(c.updated_ms || 0, c.since_ms || 0, c.created_ms || 0)
const needsYou = (c) => c.state === "input" || c.state === "failed" || c.state === "lost"
const folderName = (path) => (path || "").replace(/\/+$/, "").split("/").pop() || "No folder"
const need = (c) => (c.state === "input" ? 0 : needsYou(c) ? 1 : 2)
const byNeed = (list) => [...list].sort((a, b) => need(a) - need(b) || lastActivity(b) - lastActivity(a))

// The recent chats and the ones that need you, newest first. A host with server-side reads (limit,
// state) cuts and orders them; an older one answers every chat, which this look orders and cuts.
let hostCuts = true
async function readChats() {
  if (hostCuts) {
    try {
      const [recent, waiting] = await Promise.all([
        cmux.call("agent_chat.list", { limit: RECENT }),
        cmux.call("agent_chat.list", { limit: RECENT, state: ["input", "failed", "lost"] })
      ])
      return { recent: recent.chats.slice(0, RECENT), waiting: waiting.chats.filter(needsYou).slice(0, RECENT) }
    } catch (e) {
      if (!/param/i.test(message(e))) throw e
      hostCuts = false
    }
  }
  const all = (await cmux.call("agent_chat.list", {})).chats.sort((a, b) => lastActivity(b) - lastActivity(a))
  return { recent: all.slice(0, RECENT), waiting: all.filter(needsYou).slice(0, RECENT) }
}

let reading = false
let again = false
async function load() {
  if (reading) return void (again = true)
  reading = true
  try {
    const { recent, waiting } = await readChats()
    // As cmux's page orders them: the chats that need you first (needs input, then failed), then
    // the rest newest first.
    const ordered = byNeed([...waiting, ...recent.filter((c) => !waiting.some((w) => w.id === c.id))])
    setChats(ordered.slice(0, RECENT))
    setAttention(byNeed(waiting))
    setNow(Date.now())
    setError(null)
  } catch (e) {
    setError(message(e))
  } finally {
    reading = false
    setLoaded(true)
    if (again) {
      again = false
      load()
    }
  }
}

async function loadProjects() {
  try {
    const list = await cmux.project.list({ limit: OTHER_PROJECTS + 2 })
    setProjects((list.projects || []).filter((p) => p.state !== "missing").map((p) => ({ cwd: p.path, name: p.overlay?.rename || p.name || folderName(p.path) })))
  } catch {
    // No project list: the card shows the folder the tab starts in and Choose environment.
  }
}

// "now", "4m", "2h", "3d", as cmux's rows count.
function age(ms) {
  if (!ms) return ""
  const minutes = Math.round((now() - ms) / MINUTE)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

function stateOf(c) {
  if (c.state === "input") return { text: "Needs input", tone: "warning" }
  if (c.state === "failed" || c.state === "lost") return { text: "Failed", tone: "danger" }
  if (c.state === "working") return { text: "Running", tone: "secondary" }
  if (c.unread) return { text: "Unread", tone: "secondary" }
  return null
}

// The agent's mark. Scene icons are cmux's icon pack, which has no agent logos yet (GAPS.md), so
// every agent gets the chat glyph.
const markOf = () => "agent.chat"

async function start() {
  const text = draft().trim()
  if (!text) return
  try {
    await cmux.actions.run("newTab.submit", { text })
    setDraft("")
  } catch (e) {
    cmux.toast({ title: "Cannot start the chat", message: message(e), tone: "warning" })
  }
}

async function open(chat) {
  try {
    if (chat.workspace) await cmux.workspace.focus({ workspace: chat.workspace })
    else await cmux.actions.run("agent.openSessionTab", { session: chat.id })
  } catch (e) {
    cmux.toast({ title: "Cannot open the chat", message: message(e), tone: "warning" })
  }
}

// A row of a stage card: an icon, the text, a quiet detail, a check. A wash only on hover.
function stageRow({ symbol, text, detail, detailTone, checked, help, onTap }) {
  return HStack({ spacing: 10 }, [
    symbol ? Icon(symbol).size(15).color("secondary").frame({ width: 16, height: 16 }) : null,
    Text(text).font(15).color(symbol ? "secondary" : "primary").lineLimit(1),
    Spacer(),
    detail ? Text(detail).font(13).color(detailTone || "tertiary").lineLimit(1).fixedSize("horizontal") : null,
    checked !== undefined ? Text(checked ? "✓" : "").font(13).color("primary").frame({ width: 14 }) : null
  ])
    .paddingHorizontal(10)
    .frame({ height: 32 })
    .cornerRadius(6)
    .hoverBackground("hover")
    .cursor("pointer")
    .help(help || "")
    .onTap(onTap)
}

// Where the chat starts: this folder checked, this Mac's other recent projects, Choose environment.
function environmentCard(ctx) {
  const current = () => cwd() || ctx.cwd || null
  return Panel({ style: "card", spacing: 0 }, [
    () =>
      current()
        ? stageRow({ symbol: "folder", text: folderName(current()), detail: "This Mac", checked: true, help: current(), onTap: () => setCwd(current()) })
        : stageRow({ symbol: "folder", text: "No folder", checked: true, onTap: () => setCwd(null) }),
    ForEach({ items: () => projects().filter((p) => p.cwd !== current()).slice(0, OTHER_PROJECTS), key: (p) => p.cwd }, (p) =>
      stageRow({ symbol: "folder", text: () => p().name, detail: "This Mac", checked: false, help: () => p().cwd, onTap: () => setCwd(p().cwd) })
    ),
    Divider(),
    stageRow({
      symbol: null,
      text: "Choose environment",
      onTap: () => cmux.actions.run("palette.newAgentChat", current() ? { cwd: current() } : {}).catch((e) => cmux.toast({ title: "Cannot choose a folder", message: message(e), tone: "warning" }))
    })
  ])
    .cornerRadius(14)
    .frame({ width: 440 })
}

// The chats that need you: needs input, failed, or lost its agent.
function suggestionsCard() {
  return () =>
    attention().length
      ? Panel({ style: "card", spacing: 0 }, [
          ForEach({ items: attention, key: (c) => c.id }, (c) => {
            const s = () => stateOf(c()) || { text: "", tone: "tertiary" }
            return stageRow({
              symbol: "agent.chat",
              text: () => c().title,
              detail: () => s().text,
              detailTone: () => s().tone,
              help: () => [c().title, c().error || s().text].filter(Boolean).join("\n"),
              onTap: () => open(c())
            })
          })
        ])
          .cornerRadius(14)
          .frame({ width: 440 })
      : null
}

// "Chats" with All Chats across from it, then the recent chats as quiet rows: the title, what it
// waits on or its last reply, the agent and the age.
function recentRows() {
  return VStack({ spacing: 0, alignment: "leading" }, [
    HStack({ spacing: 12 }, [
      Text("Chats").font(15).weight("semibold").color("primary"),
      Spacer(),
      Button(HStack({ spacing: 4 }, [Text("All Chats").font(13), Icon("nav.forward").size(11)]), () =>
        cmux.actions.run("search.chats").catch((e) => cmux.toast({ title: "Cannot show all chats", message: message(e), tone: "warning" }))
      ).color("tertiary")
    ]).frame({ height: 40 }),
    () => (loaded() && !error() && chats().length === 0 ? Text("No chats yet").font(13).color("tertiary").padding({ top: 8 }) : null),
    ForEach({ items: chats, key: (c) => c.id }, (c) => {
      const s = () => stateOf(c())
      const line = () => (s() ? s().text : c().preview || "")
      return HStack({ spacing: 8 }, [
        Text(() => c().title).font(15).weight("semibold").color("primary").lineLimit(1).layoutPriority(1),
        Text(line).font(13).color(() => (s() ? s().tone : "tertiary")).lineLimit(1),
        Spacer(),
        Icon(() => markOf(c().harness)).size(15).color("tertiary"),
        Text(() => age(lastActivity(c()))).font(13).color("tertiary").monospaced().frame({ width: 34, alignment: "trailing" })
      ])
        .frame({ height: 32 })
        .cornerRadius(8)
        .hoverBackground("hover")
        .cursor("pointer")
        .help(() => [c().title, c().cwd].filter(Boolean).join("\n"))
        .onTap(() => open(c()))
    })
  ]).frame({ maxWidth: "infinity" })
}

// Over the field: the folder the chat starts in (the environment card's pick) and the machine.
function place(ctx) {
  const where = () => folderName(cwd() || ctx.cwd)
  return HStack({ spacing: 20 }, [
    HStack({ spacing: 6 }, [Icon("folder").size(14).color("secondary"), Text(where).font(14).color("secondary").lineLimit(1)]),
    HStack({ spacing: 6 }, [Icon("machine.local").size(14).color("secondary"), Text("This Mac").font(14).color("secondary")]),
    Spacer()
  ])
    .paddingHorizontal(18)
    .frame({ maxWidth: "infinity" })
}

// The composer: one rounded field with the prompt and Send.
function composer() {
  return Panel({ style: "card" }, [
    HStack({ spacing: 12 }, [
      Icon("action.add").size(16).color("secondary"),
      TextField(draft, { placeholder: "Ask anything or type a URL", autofocus: true, onEdit: setDraft, onSubmit: start })
        .font(15)
        .frame({ maxWidth: "infinity" }),
      Spacer(),
      Button(Icon("composer.send").size(15), start)
        .frame({ width: 30, height: 30 })
        .cornerRadius(15)
        .background(() => (draft().trim() ? "primary" : "#00000000"))
        .color(() => (draft().trim() ? "#FFFFFF" : "secondary"))
        .help("Send")
    ])
      .paddingHorizontal(16)
      .frame({ minHeight: 36 })
  ])
    .cornerRadius(999)
    .frame({ maxWidth: "infinity" })
}

function renderNewTab(ctx) {
  ctx = ctx || {}
  load()
  loadProjects()
  cmux.events.on("agent_chat.changed", load)
  cmux.timer.every(30000, () => setNow(Date.now()))
  return VStack({ spacing: 12, alignment: "leading" }, [
    HStack({ spacing: 0 }, [Spacer(), environmentCard(ctx), Spacer()]),
    HStack({ spacing: 0 }, [Spacer(), suggestionsCard(), Spacer()]),
    () => (error() ? EmptyState({ title: "Cannot read your chats", message: error(), symbol: "exclamationmark.triangle" }) : null),
    recentRows().padding({ top: 8 }),
    // The stage's free space; the composer at the page's foot once the page gives the scene its height.
    Spacer().frame({ minHeight: 8 }),
    place(ctx),
    composer()
  ])
}

globalThis.__cmuxAppExports = { renderNewTab }
