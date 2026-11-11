# CLAUDE.md

- **Give every subtask its own worktree.** A subagent takes `isolation: "worktree"`; a session enters one with
  `EnterWorktree`. Two agents in one checkout collide — they edit the same file at the same time, and a `git add -A`
  from either commits the other's half-finished work. Every worktree branches from `origin/master`, which is
  `worktree.baseRef`'s default and why `.claude/settings.json` does not set it: work goes through pull requests, so a
  branch wants the tip of what has already merged rather than whatever a local `master` happens to be at. Nothing to
  fast-forward, and nothing carried in from a `master` somebody forgot to pull. The cost is that a worktree cannot build
  on an unmerged branch, so stacked work waits for the branch beneath it to land.
- **An unresolved conversation can block the merge.** When the rulesets require review threads resolved, green checks
  are not enough, and clearing an open thread falls to the pull request's author: fix what it raises or reply with why
  not, then resolve it.
- **Light alone is enough for a pull request's screenshots.** Take a dark set as well only when dark draws the change
  meaningfully differently: a change that only follows the theme's colours gains nothing from a second set.
- **File an issue for what a change leaves behind.** A defect met on the way to something else, or a follow-up a change
  leaves open, goes into an issue rather than only the reply, a memory note or a pull request's "What's left", which one
  session reads once; an idea nobody asked for stays a sentence in the reply. File it with `bug-report` or
  `feature-request`, which say what an issue already filed makes of it, without asking — this rule is the approval their
  wait gives way to — before the pull request opens, so its body links the number, or at the end of the task when there
  is none. Reproduce it once first, from a frame, a command or a log line, and say what went unchecked, since a guess
  filed as a finding misleads whoever picks it up. Say where it was found (`Found while working on #807`). Text only:
  filed unasked, it publishes with nobody looking. A problem in another repository, the organization's or a third
  party's, is named in the reply and left to the user, and a subagent that opens no pull request reports what it found
  to its parent rather than file it.
- **Take turns with the phone.** Sessions share the phone plugged in here, so the `SessionStart` hook in
  `.claude/settings.json` puts `bin/adb` first on the PATH of a session's Bash commands and names it as `ADB`, which
  scrcpy runs in place of the `adb` on the PATH or a portable build's own. So every way to the phone — by hand, from
  scrcpy, and from `pnpm battle`, `pnpm inventory` and `pnpm adb` — runs `bin/adb`, which takes the phone's lease or is
  refused while another session holds it. A subagent shares its session's lease, but two subagents of one session, as
  forks run side by side, take turns as two sessions do. `bin/adb` runs the first other `adb` on the PATH, so a machine
  whose only `adb` is one bundled with scrcpy needs one there too. The refusal names the holder and says how to wait for
  it or ask it with `SendMessage`; do one of those rather than run the real `adb` by its path, which is the one way past
  the lease and taps over the other session's run. A session lets go of the phone when a turn ends with no command that
  reached it still running and no background agent — or, after a turn interrupted with `Esc` or ended by an API error,
  neither of which fires `Stop`, once it has sat idle about a minute — or when it exits, and a crashed one holds
  nothing; a subagent lets go of what it took as it finishes. Settings are read as a session starts, so one started
  before these hooks were in its checkout runs the bare `adb` until it restarts.
- **Cover the account in every capture of the phone.** A fixture, a PR screenshot or a recording hides each of the
  account's trainer names — on the VS screen, under the avatar on the map and as the partner under "OBTAINED IN A TRADE"
  on a detail screen — and the Nearby Battle QR code on the Battle tab, which is tied to the account. Fill them solid,
  since text can be read back out of a mosaic, and check every frame before the first push: the repository is public,
  and a pushed LFS object outlives a force-push. Rewrite an edited capture with `encodePng` from `src/core/png.mts`,
  because other tools drop the `Viewport` `tEXt` chunk a stitched capture carries. The map's location needs nothing,
  since the in-game location is spoofed.
