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
`mirror-v86-win95.sh` script downloads and validates that image, then patches
Internet Explorer's default home page to `about:blank`. There is no
manual disk picker. The image is not included in this repository.

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

## Disk image

Windows 95 is proprietary; confirm you have rights to host and use an image
before running the mirror script. The Git repository does not include a disk
image. Run the script with `images/windows95-v3` as its destination before
serving the page; otherwise the page shows a loading error.

## Files

- `index.html`: the page and controls
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
