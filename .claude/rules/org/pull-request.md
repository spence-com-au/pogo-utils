# Pull Requests

- **Open a pull request; `master` is protected.** A direct push is rejected rather than queued, so branch, push the
  branch and open the PR with `gh pr create`. What the protection requires is deliberately not restated here, read it
  from `gh api repos/{owner}/{repo}/branches/master/protection` and `gh api repos/{owner}/{repo}/rulesets`, either of
  which may be the one in force. The approval comes from Claude, which the organization's
  [Common workflows ruleset](https://github.com/organizations/spence-com-au/settings/rules/25534190) runs on a pull
  request into `master` — nobody here can approve their own. So open it ready for review rather than as a draft: a draft
  gets no review, and marking it ready starts none, so the approval it needs waits for its next push.
- **A pull request is not done when it is opened.** It is reviewed automatically, and again on every push, so each fix
  can draw new feedback. Watch it after submitting, and keep addressing the reviews and failing checks until it merges.
- **Ask whether a pull request should merge itself.** `gh pr merge --auto --squash` hands it to GitHub, which merges the
  moment the checks pass and the review approves — with nobody looking at it again. That is the user's call rather than
  a default to assume either way, so when they have not said, ask before opening it, and leave auto-merge off until they
  answer.
- **Show a change to a user interface in screenshots.** A pull request that changes anything a UI draws — a web page,
  an app, a game — carries screenshots of it, so a reviewer can judge it without checking the branch out. One with no UI
  to draw, such as a change to workflows or configuration, has nothing to show and carries none. The branch's come from
  a real build of it, served locally the way the repository's own instructions say, and `master`'s from wherever it is
  deployed, or a build of `master` where nothing serves it. Show each state the change adds, and at phone width where
  the layout differs there. A bug fix shows the UI before and after, the broken state beside the fixed one, so a
  reviewer sees both what was wrong and that it no longer is. Upload each image through the undocumented endpoint
  GitHub's web editor uses,
  [described here](https://island94.org/2026/08/programmatically-upload-attachments-to-github-issues-pull-requests-comments),
  and embed the URL it returns in the PR body, so nothing lands on the branch. The body rather than a comment, because
  the body is what a reviewer reads first and the one place that can always show the current state: when a later push
  changes what the UI draws, take the screenshots again and replace them there, rather than leaving the old set in
  place or posting a new set in a comment.

  ```bash
  curl \
    --data-binary "@${FILE}" \
    --header "Authorization: Bearer $(gh auth token)" \
    --no-progress-meter \
    --request POST \
    "https://uploads.github.com/user-attachments/assets?name=${FILE}&content_type=image/png&repository_id=$(gh api repos/{owner}/{repo} --jq .id)" \
  | jq --exit-status --raw-output .url
  ```
