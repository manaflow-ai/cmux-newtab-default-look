// l10n-allow-file: screenshot harness for a cmux.newtab/1 look, not shipped UI.
// The look's New Tab page drawn by cmux's own web New Tab page: the host's ready payload names the
// app (tabs.newTabApp), so the pane draws NewTabAppPage, and a stand-in for the app host replays the
// scene batches shots/ops.ts recorded from the look's main.js in cmux's app runtime.
//
// Copy to webviews/src/agent-session/acpmux/newtab/ in a cmux checkout, with the recorded batches
// under webviews/.looks/ops/<look>/<variant>.json (shots/capture.sh does both).
import { agentPaneEntry } from "../../../gallery/format";
import { CWD, noChat } from "../../../gallery/fixtures/acpmux";
import { installAppPanelsDevClient } from "../../../apps/scene/panelsClient";
import type { PageClient } from "../../../pages/shared/pageClient";

type Recorded = { variant: string; cwd: string; batches: unknown[][] };
const recorded = import.meta.glob<Recorded>("../../../../.looks/ops/*/*.json", { eager: true, import: "default" });
const byName = new Map<string, Recorded>();
for (const [file, value] of Object.entries(recorded)) {
  const [look, name] = file.split("/").slice(-2);
  byName.set(`${look}-${name!.replace(/\.json$/, "")}`, value);
}

// The app host for one page: mount answers, the scene stream replays the recorded batches.
const shown = new URLSearchParams(globalThis.location?.search ?? "").get("variant") ?? "";
const host: PageClient = {
  async call<R>(op: string): Promise<R> {
    if (op === "cmux.apps.panels.mount") return { mount_id: "look" } as R;
    return {} as R;
  },
  async subscribe<E>(stream: string, onEvent: (data: E, seq: number) => void) {
    if (stream === "cmux.apps.panels.scene") {
      const batches = byName.get(shown)?.batches ?? [];
      queueMicrotask(() =>
        batches.forEach((ops, index) => onEvent({ mount_id: "look", ops, reset: index === 0 } as E, index + 1)),
      );
    }
    return () => undefined;
  },
  handle() {
    return () => undefined;
  },
};
installAppPanelsDevClient(host);

const ready = { newTab: { layout: "b", kind: "agent", cwd: CWD, home: "/Users/you", app: "local/customize" }, newSession: true };

export default agentPaneEntry({
  id: "agent-pane.new-tab-look",
  title: "New Tab look (cmux.newtab/1)",
  area: "New Tab",
  height: 720,
  covers: ["agent-session/acpmux/newtab/appPage.css"],
  variants: Object.fromEntries(
    [...byName.keys()].map((name) => [
      name,
      {
        note: `The ${name} look's page, from its main.js in cmux's app runtime.`,
        ready,
        snapshot: noChat([]),
        play: async (ctx) => {
          await ctx.waitFor(() => ctx.document.querySelector('.nt-app-page[data-status="ready"]') !== null);
        },
      },
    ]),
  ),
});
