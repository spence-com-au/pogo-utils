# CLAUDE.md

- **Give every subtask its own worktree.** A subagent takes `isolation: "worktree"`; a session enters one with
  `EnterWorktree`. Two agents in one checkout collide — they edit the same file at the same time, and a `git add -A`
  from either commits the other's half-finished work. Every worktree branches from `origin/master`, which is
  `worktree.baseRef`'s default and why `.claude/settings.json` does not set it: work goes through pull requests, so a
  branch wants the tip of what has already merged rather than whatever a local `master` happens to be at. Nothing to
  fast-forward, and nothing carried in from a `master` somebody forgot to pull. The cost is that a worktree cannot build
  on an unmerged branch, so stacked work waits for the branch beneath it to land.
  a default to assume either way, so when they have not said, ask before opening it, and leave auto-merge off until they
  answer.
- **Take turns with the phone.** Sessions share the phone plugged in here, so the `SessionStart` hook in
  `.claude/settings.json` puts `bin/adb` first on the PATH of a session's Bash commands and names it as `ADB`, which
  scrcpy runs in place of the `adb` on the PATH or a portable build's own. So every way to the phone — by hand, from
  scrcpy, and from `pnpm battle`, `pnpm inventory` and `pnpm adb` — runs `bin/adb`, which takes the phone's lease or is
  refused while another session holds it. `bin/adb` runs the first other `adb` on the PATH, so a machine whose only
  `adb` is one bundled with scrcpy needs one there too. The refusal names the holder and says how to wait for it or ask
  it with `SendMessage`; do one of those rather than run the real `adb` by its path, which is the one way past the lease
  and taps over the other session's run. A session lets go of the phone when a turn ends with no command that reached it
  still running and no background agent, or when it exits, and a crashed one holds nothing. Settings are read as a
  session starts, so one started before these hooks were in its checkout runs the bare `adb` until it restarts.
- **Cover the account in every capture of the phone.** A fixture, a PR screenshot or a recording hides each of the
  account's trainer names — on the VS screen, under the avatar on the map and as the partner under "OBTAINED IN A TRADE"
  on a detail screen — and the Nearby Battle QR code on the Battle tab, which is tied to the account. Fill them solid,
  since text can be read back out of a mosaic, and check every frame before the first push: the repository is public,
  and a pushed LFS object outlives a force-push. Rewrite an edited capture with `encodePng` from
  `src/tools/inventory/png.mts`, because other tools drop the `Viewport` `tEXt` chunk a stitched capture carries. The
  map's location needs nothing, since the in-game location is spoofed.
