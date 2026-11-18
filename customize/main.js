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
const folderName = (path) => (path || "").replace(/\/+$/, "").split("/").pop() || path || ""

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
    setChats(recent)
    setAttention(waiting)
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
  if (c.state === "working") return { text: "Working", tone: "secondary" }
  return null
}

const markOf = (harness) => (harness === "codex" ? "terminal" : "sparkle")

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
  return HStack({ spacing: 8 }, [
    Icon(symbol).size(14).color("tertiary").frame({ width: 16, height: 16 }),
    Text(text).font(13).color("secondary").lineLimit(1),
    Spacer(),
    detail ? Text(detail).font("caption").color(detailTone || "tertiary").lineLimit(1).fixedSize("horizontal") : null,
    checked !== undefined ? Text(checked ? "✓" : "").font(13).color("primary").frame({ width: 14 }) : null
  ])
    .paddingHorizontal(8)
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
        : stageRow({ symbol: "folder", text: "No project", checked: true, onTap: () => setCwd(null) }),
    ForEach({ items: () => projects().filter((p) => p.cwd !== current()).slice(0, OTHER_PROJECTS), key: (p) => p.cwd }, (p) =>
      stageRow({ symbol: "folder", text: () => p().name, detail: "This Mac", checked: false, help: () => p().cwd, onTap: () => setCwd(p().cwd) })
    ),
    Divider().padding({ top: 4, bottom: 4 }),
    stageRow({
      symbol: "folder",
      text: "Choose environment",
      onTap: () => cmux.actions.run("palette.newAgentChat", current() ? { cwd: current() } : {}).catch((e) => cmux.toast({ title: "Cannot choose a folder", message: message(e), tone: "warning" }))
    })
  ])
    .cornerRadius(14)
    .frame({ maxWidth: 440 })
}

// The chats that need you: needs input, failed, or lost its agent.
function suggestionsCard() {
  return () =>
    attention().length
      ? Panel({ style: "card", spacing: 0 }, [
          ForEach({ items: attention, key: (c) => c.id }, (c) => {
            const s = () => stateOf(c()) || { text: "", tone: "tertiary" }
            return stageRow({
              symbol: "bubble.left",
              text: () => c().title,
              detail: () => s().text,
              detailTone: () => s().tone,
              help: () => [c().title, c().error || s().text].filter(Boolean).join("\n"),
              onTap: () => open(c())
            })
          })
        ])
          .cornerRadius(14)
          .frame({ maxWidth: 440 })
      : null
}

// The recent chats as quiet rows: the title, its last reply, the age and the agent.
function recentRows() {
  return VStack({ spacing: 2 }, [
    ForEach({ items: chats, key: (c) => c.id }, (c) => {
      const s = () => stateOf(c())
      const line = () => (s() ? s().text : c().preview || "")
      return HStack({ spacing: 8 }, [
        Text(() => c().title).font(13).weight("medium").color("primary").lineLimit(1).layoutPriority(1),
        Text(line).font(12).color(() => (s() ? s().tone : "tertiary")).lineLimit(1),
        Spacer(),
        Icon(() => markOf(c().harness)).size(13).color("tertiary"),
        Text(() => age(lastActivity(c()))).font("caption").color("tertiary").monospaced().frame({ width: 34 })
      ])
        .paddingHorizontal(8)
        .frame({ height: 30 })
        .cornerRadius(8)
        .hoverBackground("hover")
        .cursor("pointer")
        .help(() => [c().title, c().cwd].filter(Boolean).join("\n"))
        .onTap(() => open(c()))
    })
  ]).frame({ maxWidth: 440 })
}

// The composer at the foot: the field and Send, the folder and the agent under it.
function composer(ctx) {
  const where = () => folderName(cwd() || ctx.cwd) || "No project"
  return Panel({ style: "card", spacing: 6 }, [
    HStack({ spacing: 8 }, [
      TextField(draft, { placeholder: "Ask anything", autofocus: true, onEdit: setDraft, onSubmit: start }).font(14),
      Button(Icon("arrow.up").size(13), start)
        .frame({ width: 28, height: 28 })
        .cornerRadius(14)
        .background(() => (draft().trim() ? "primary" : "hover"))
        .color(() => (draft().trim() ? "#FFFFFF" : "tertiary"))
        .help("Send")
    ]).frame({ minHeight: 44 }),
    HStack({ spacing: 10 }, [
      HStack({ spacing: 4 }, [Icon("folder").size(12).color("tertiary"), Text(where).font("caption").color("secondary").lineLimit(1)]),
      Spacer()
    ])
  ])
    .cornerRadius(16)
}

function renderNewTab(ctx) {
  ctx = ctx || {}
  load()
  loadProjects()
  cmux.events.on("agent_chat.changed", load)
  cmux.timer.every(30000, () => setNow(Date.now()))
  return VStack({ spacing: 12, alignment: "center" }, [
    environmentCard(ctx),
    suggestionsCard(),
    () => (error() ? EmptyState({ title: "Cannot read your chats", message: error(), symbol: "exclamationmark.triangle" }) : null),
    recentRows(),
    // The stage's free space; the composer at the page's foot once the page gives the scene its height.
    Spacer().frame({ minHeight: 24 }),
    composer(ctx)
  ])
}

globalThis.__cmuxAppExports = { renderNewTab }
