# Official-style Simple UI

## Purpose

Implement the six supplied official-app screenshots in the existing Simple UI,
using its real commands and status. Preserve the validated kill switch and
click-triggered pixel animation. Keep English product text. Do not copy screenshot
annotations, watermarks, a false latest-version claim, or obsolete macOS warnings.

## Progress

- [x] Inspect HTML/JS, native GTK sidebar, and existing official SVG assets.
- [x] Replace the web shell and restyle the six screens.
- [x] Integrate native sidebar without duplicate navigation; retain narrow layouts.
- [x] Verify real handlers with a mocked bridge, state variants, keyboard access,
      screenshots at desktop/mobile sizes, and compile the GTK integration.
- [x] Save previews in the project and document the completed result.

## Context and Orientation

simple-ui/index.html defines DOM IDs consumed by simple-ui/app.js. Preserve those
IDs while reorganizing markup. The existing native sidebar is built in
rustlib/src/gui/gtk_gui.rs and updates the backend navigation state. Native page
scripts are injected from rustlib/src/gui/webview.rs. A native-shell marker will
hide web navigation inside GTK; browser previews use the equivalent web sidebar.
Official mascots and wordmark are available under obscura-ui/src/res. Copy the
needed assets into simple-ui/assets for the existing gresource packaging process.

## Design and Decisions

Use a 200px sidebar, 52px page header, gray surfaces, orange controls and a blue
selection highlight as in the references. The Connection page has a centered
mascot and quick-connect action, city selection, and a bottom protection status
panel above the animated background. Location gets a status banner and flat
location rows; Account gets subscription, account and configuration rows.
Settings use grouped sections, Help uses the thinking mascot, and About uses the
official wordmark. Protection copy must distinguish a blocked disconnected state
from vulnerable traffic. Current app features remain reachable.

## Plan of Work

Reorganize the HTML while keeping command IDs. Replace the current card-heavy
CSS with semantic theme variables and scoped screen layouts. Update rendering
for the title, status panel/banner, flat server rows, selected city, and account
status. Keep navigation synchronized with native status and retain immediate
optimistic navigation. Add an explicit native-shell marker and scoped GTK sidebar
styling. No new frontend framework or animation dependency is needed.

## Validation and Acceptance

Run node --check simple-ui/app.js and the existing node --test suites. Use an
isolated headless browser with a fake commandBridge to inspect all six screens,
connected/disconnected/blocked states, account visibility, location selection,
pinning, navigation, and reduced-motion behavior without touching the live VPN.
Check desktop and narrow widths for overlap/overflow; check light and dark themes.
Build gresources and cargo check --features gui --bin obscura-gui --offline.
Save representative screenshots under previews/official-ui in the project.

## Idempotence and Recovery

Preserve pending user edits as the starting point. Only replace styling where
the requested reference design supersedes it. Do not deploy or publish a release
as part of this UI task. Browser tests use an isolated profile and fake data;
close that browser afterward. Do not modify the host VPN state.

## Surprises & Discoveries

The Linux app already has a native sidebar, so adding a web sidebar unconditionally
would duplicate navigation. The official SVG artwork can be reused directly.

## Outcomes & Retrospective

All six screens are implemented. Browser checks passed for navigation, search, pinning, keyboard connection, masked account numbers, firewall-aware status, light/dark themes and narrow layouts. Existing pixel-animation and kill-switch UI suites plus the new official-ui suite passed. cargo check --features gui --bin obscura-gui passed, and the native sidebar CSS parsed without GTK errors. The screenshot gallery is previews/official-ui/index.html; no package was published or installed during this UI task.

Verification notes: inline SVGs were used for navigation and the wordmark to avoid file-scheme mask restrictions in browser previews. The official app icon is copied from the existing Linux icon asset. Button foreground/background colors incorporate the subsequent user-requested theme adjustments. The final preview browser was closed after verification.
