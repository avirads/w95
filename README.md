# Windows 95 in the browser (v86)

A self-hosted copy of the [copy.sh/v86 `windows95` profile](https://copy.sh/v86/?profile=windows95):
the [v86](https://github.com/copy/v86) x86 emulator (WebAssembly) set up as the same machine
(64 MB RAM, 8 MB VGA, SeaBIOS). The page is a single browser-filling window
with Minimize, Maximize (browser fullscreen), and Close controls. Reloading
restarts the VM after Close. The guest display stretches to fill the available
pane, so its aspect ratio can change on wide screens.

It is a static site with no build step, so GitHub Pages can host it.

On Fastium, v86's `windows95-v3` profile image is mirrored as 1,800 local
256 KiB chunks under `images/windows95-v3/` and boots automatically. The
`mirror-v86-win95.sh` script downloads and validates that image. There is no
manual disk picker. The image is not included in this repository.

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
