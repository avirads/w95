# Windows 95 in the browser (v86)

A self-hosted copy of the [copy.sh/v86 `windows95` profile](https://copy.sh/v86/?profile=windows95):
the [v86](https://github.com/copy/v86) x86 browser runtime (WebAssembly) set up as the same machine
(64 MB RAM, 8 MB VGA, SeaBIOS). The page is a single browser-filling window
with Minimize, Maximize (browser fullscreen), and Close controls. Reloading
restarts the VM after Close. The guest display stretches to fill the available
pane, so its aspect ratio can change on wide screens.

It is a static site with no build step, so GitHub Pages can host it.

On Fastium, v86's `windows95-v3` profile image is mirrored as 1,800 local
256 KiB chunks under `images/windows95-v3/` and boots automatically. The
`mirror-v86-win95.sh` script downloads and validates that image. There is no
manual disk picker. The image is not included in this repository.

## Browser disk cache

Image chunks are saved in the browser's persistent CacheStorage as Windows
reads them. The first visit downloads the chunks it needs; later visits and
reloads reuse those chunks without requesting them from the server. Previously
unread parts still download on demand (the full image is 450 MiB). This caches
the original image only: guest disk changes remain session-only.

The disk-only service worker requires HTTPS or localhost. If storage is full,
disabled, or unsupported, Windows continues with server downloads. The browser
may evict cached data; clearing site data also requires another download.
Page navigation, login, Jev/API calls and other assets are **not** served from
this cache, so the page still requires Fastium authentication and connectivity.

The immutable image revision is configured in `disk-image.mjs`. The current
`images/windows95-v3-restored/` directory on Fastium points to the verified
`windows95-v3/` mirror. For a new image, publish a **new directory URL** and
update that configuration; never replace the bytes behind an existing revision.
The worker removes only its own obsolete image caches when it updates. Deploy
`disk-image.mjs`, `disk-cache.mjs`, and `disk-cache-sw.js` alongside `index.html`.

## Networking

The title-bar Network selector reboots the VM when changed. **Internet** (the
default) requests a short-lived, origin-bound session from Fastium's existing
`/v1/sessions` gateway and carries raw NE2000 Ethernet frames over
`/v1/ethernet`. The gateway blocks private and metadata-address egress by
default. This mode requires the gateway routes and allowed origin; it will show
an error instead of silently booting without networking if unavailable. The
gateway permits one active VM network session at a time; each new connection
takes the lease and disconnects the previous VM.

**Browser-local** uses v86's `inbrowser` link. It connects VMs in tabs of the
same browser/origin, but has no Internet, DHCP, or router. Configure static
addresses in each guest on the same subnet (for example `192.168.42.10/24`
and `192.168.42.11/24`) to communicate. A lone Windows 95 VM has no peer.

Windows 95's bundled browser may not support modern TLS websites even when the
network is connected. Use a plain HTTP test endpoint to validate reachability.

## Jev agent

Click **Jev agent** to open the panel. It starts with a random suggestion drawn
from safe built-in Windows 95 tasks; **Shuffle** replaces it with another.
**Right Arrow** accepts a suggested prompt for editing, **Enter** runs it just
like **Run**, and **Shift+Enter** inserts a newline. You can also type your own
goal. Suggestions are examples, not guarantees of successful automation.
Click **Dictate** and allow microphone access to speak a prompt; dictation fills
the text box but does not start the agent. Speech recognition availability
depends on the browser, and its speech service may process audio online.

Drag the agent window by its blue title bar; it stays within the guest display.
The title bar's **×** closes the panel and keeps the prompt, and the Jev agent
button opens it again.

Starting a run hides the panel so the guest remains visible. Progress and a
**Cancel** button stay in the title bar; click the agent button to inspect the
panel again. Progress, completion and errors do not automatically reopen it.
The screen reader and agent code load only when a task is submitted.

The Jev agent panel accepts a natural-language goal and runs a bounded
screen-observe/action loop. It uses the same self-hosted OCR and server-side
`/20260918/api/jev/pc-step` route as Fastium's `/kalib/` page. Screenshots stay
in the browser; recognized text, candidate actions and recent action history
go to Jev. The server's `TYPESAFE_API_KEY` never reaches this page. Only OCR
targets, the fixed Windows Start button, allowlisted keys and literal text
quoted in the goal can become actions. Run can be cancelled; the VM resumes
for manual control when a task ends.

This is screen-based automation, not a Windows guest agent. OCR may miss
unlabelled graphics or unfamiliar controls; uncertainty stops the task rather
than inventing a click. Agent support requires Fastium's `/kalib/` OCR assets
and Jev API, so a standalone GitHub Pages copy will boot Windows but will not
run the agent.

## Disk image

Windows 95 is proprietary; confirm you have rights to host and use an image
before running the mirror script. The Git repository does not include a disk
image. Run the script with `images/windows95-v3` as its destination before
serving the page, then create the `images/windows95-v3-restored` alias (or mirror
directly to that directory); otherwise the page shows a loading error.

## Files

- `index.html`: the page and controls
- `agent-prompts.mjs`: bounded Windows 95 task suggestions and shuffle selection
- `disk-image.mjs`, `disk-cache.mjs`, `disk-cache-sw.js`: versioned disk configuration and persistent, disk-only browser cache
- `build/`: `libv86.js`, `v86.wasm` from the `v86` npm package 0.5.465 (BSD-2-Clause, see `build/LICENSE.v86`)
- `bios/`: SeaBIOS and the VGA BIOS from the v86 repository
- `mirror-v86-win95.sh`: reproducible downloader and size checks for the Fastium mirror

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000/
```

## Host on GitHub Pages

Settings → Pages → Build and deployment → Source: **Deploy from a branch**, then pick the
branch and `/ (root)`. The site is published at `https://<user>.github.io/w95/`.
