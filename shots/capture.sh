#!/usr/bin/env bash
# Screenshots of one or more New Tab looks, drawn by cmux's web New Tab page in light and dark.
# Run from the root of a cmux checkout (cmux's gallery and app runtime come from there):
#
#   bash LOOK/shots/capture.sh OUT_DIR LOOK [LOOK...]
#
# Each LOOK is a look folder (cmux-setup.json, customize/). Writes OUT_DIR/after-<look>-<variant>/.
set -euo pipefail
out=$(mkdir -p "$1" && cd "$1" && pwd)
shift
first=$1
names=()
for look in "$@"; do
  name=$(basename "$(cd "$look" && pwd)")
  names+=("$name")
  bun "$look/shots/ops.ts" "$look" "webviews/.looks/ops/$name"
done
cp "$first/shots/NewTabLook.gallery.ts" webviews/src/agent-session/acpmux/newtab/NewTabLook.gallery.ts
spec=webviews/.looks/after.json
LOOKS="${names[*]}" SPEC="$spec" bun -e '
const fs = require("node:fs");
const shots = [];
for (const look of process.env.LOOKS.split(" "))
  for (const file of fs.readdirSync(`webviews/.looks/ops/${look}`).sort()) {
    const variant = `${look}-${file.replace(/\.json$/, "")}`;
    shots.push({ name: `after-${variant}`, entry: "agent-pane.new-tab-look", variant, width: 1100, height: 720, deviceScaleFactor: 2, arms: { now: "" } });
  }
fs.writeFileSync(process.env.SPEC, JSON.stringify({ envs: [["light", "none"], ["dark", "none"]], shots }, null, 1));
'
cd webviews
CMUX_CAPTURE_BUILD=1 bun scripts/gallery/capture-states.mjs .looks/after.json "$out"
