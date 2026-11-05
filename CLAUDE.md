# CLAUDE.md

- **Give every subtask its own worktree.** A subagent takes `isolation: "worktree"`; a session enters one with
  `EnterWorktree`. Two agents in one checkout collide — they edit the same file at the same time, and a `git add -A`
  from either commits the other's half-finished work. Every worktree branches from `origin/master`, which is
  `worktree.baseRef`'s default and why `.claude/settings.json` does not set it: work goes through pull requests, so a
  branch wants the tip of what has already merged rather than whatever a local `master` happens to be at. Nothing to
  fast-forward, and nothing carried in from a `master` somebody forgot to pull. The cost is that a worktree cannot build
  on an unmerged branch, so stacked work waits for the branch beneath it to land.
- **Open a pull request; `master` is protected.** A direct push is rejected rather than queued, so branch, push the
  branch, and open the PR with `gh pr create`. What the protection requires is deliberately not restated here —
  transcribing it is how this drifted before, down to naming a required check that had since been renamed — so read it
  from `gh api repos/{owner}/{repo}/branches/master/protection` and `gh api repos/{owner}/{repo}/rulesets`, either of
  which may be the one in force. The approval comes from Claude, which the org's `Workflows` ruleset runs on a pull
  request into `master` — nobody here can approve their own. So open it ready for review rather than as a draft: a draft
  gets no review, and marking it ready starts none, so the approval it needs waits for its next push.
- **An unresolved conversation can block the merge.** When the rulesets require review threads resolved, green checks
  are not enough, and clearing an open thread falls to the pull request's author: fix what it raises or reply with why
  not, then resolve it.
- **A pull request is not done when it is opened.** It is reviewed automatically, and again on every push, so each fix
  can draw new feedback. Watch it after submitting, and keep addressing the reviews and failing checks until it merges.
- **Ask whether a pull request should merge itself.** `gh pr merge --auto --squash` hands it to GitHub, which merges the
  moment the checks pass and the review approves — with nobody looking at it again. That is the user's call rather than
  a default to assume either way, so when they have not said, ask before opening it, and leave auto-merge off until they
  answer.
- **Show the change in screenshots.** A pull request that changes anything a page draws carries screenshots of it, taken
  from a real build (`pnpm build && pnpm serve`) rather than described, so a reviewer can judge it without checking the
  branch out. Show each state the change adds, and at phone width where the layout differs there. A bug fix shows the
  page before and after, the broken state from `master` beside the fixed one from the branch, so a reviewer sees both
  what was wrong and that it no longer is. Light alone is enough unless dark draws the change meaningfully differently;
  a change that only follows the theme's colours gains nothing from a second set. GitHub takes an image upload only
  through its web editor, so commit the images to the branch, embed them in the PR body by that commit's SHA
  (`…/blob/<sha>/<path>?raw=true`), and remove them in the next commit: the pinned links keep working, and the squash
  merge carries neither commit into `master`. The body rather than a comment, because the body is what a reviewer reads
  first and the one place that can always show the current state: when a later push changes what the page draws, take
  the screenshots again and replace them there, rather than leaving the old set in place or posting a new set in a
  comment.
- **Take turns with the phone.** Sessions share the phone plugged in here, so the `SessionStart` hook in
  `.claude/settings.json` puts `bin/adb` first on the PATH of a session's Bash commands and names it as `ADB`, which
  scrcpy runs in place of the `adb` on the PATH or a portable build's own. So every way to the phone — by hand, from
  scrcpy, and from `pnpm battle`, `pnpm inventory` and `pnpm adb` — runs `bin/adb`, which takes the phone's lease or is
  refused while another session holds it. `bin/adb` runs the first other `adb` on the PATH, so a machine whose only
  `adb` is one bundled with scrcpy needs one there too. The refusal names the holder and says how to wait for it or ask
  it with `SendMessage`; do one of those rather than run the real `adb` by its path, which is the one way past the lease
  and taps over the other session's run. A session lets go of the phone when a turn ends with no command that reached it
  still running and no background subagent — or, after a turn interrupted with `Esc` or ended by an API error, neither
  of which fires `Stop`, once it has sat idle about a minute — or when it exits, and a crashed one holds nothing.
  Settings are read as a session starts, so one started before these hooks were in its checkout runs the bare `adb`
  until it restarts.
- **Cover the account in every capture of the phone.** A fixture, a PR screenshot or a recording hides each of the
  account's trainer names — on the VS screen, under the avatar on the map and as the partner under "OBTAINED IN A TRADE"
  on a detail screen — and the Nearby Battle QR code on the Battle tab, which is tied to the account. Fill them solid,
  since text can be read back out of a mosaic, and check every frame before the first push: the repository is public,
  and a pushed LFS object outlives a force-push. Rewrite an edited capture with `encodePng` from
  `src/tools/inventory/png.mts`, because other tools drop the `Viewport` `tEXt` chunk a stitched capture carries. The
  map's location needs nothing, since the in-game location is spoofed.
