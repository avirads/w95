# Windows 95 in the browser (v86)

A self-hosted copy of the [copy.sh/v86 `windows95` profile](https://copy.sh/v86/?profile=windows95):
the [v86](https://github.com/copy/v86) x86 emulator (WebAssembly) set up as the same machine
(64 MB RAM, 8 MB VGA, SeaBIOS) with copy.sh-style controls: Ctrl+Alt+Del, Alt+Tab, Start key,
lock mouse, fullscreen, scaling, screenshot, save/restore state, and live MIPS / uptime /
resolution in a status bar.

It is a static site with no build step, so GitHub Pages can host it.

On Fastium, v86's `windows95-v3` profile image is mirrored as 1,800 local
256 KiB chunks under `images/windows95-v3/` and boots automatically. The
`mirror-v86-win95.sh` script downloads and validates that image. Add
`?manual=1` to show the disk picker instead. The image is not included in
this repository.

## Disk image

Windows 95 is proprietary; confirm you have rights to host and use an image
before running the mirror script. The Git repository does not include a disk
image. Without the Fastium mirror, use `?manual=1` and supply an image:

| How | What to do |
| --- | --- |
| Local file | Click **Open disk image (.img)…**. The file is read in the browser and never uploaded. |
| Single URL | Paste the URL and click **Boot from URL**. The server must send CORS headers and support `Range` requests. |
| Chunked mirror | Open `index.html?cdn=https://your-mirror/`. Uses copy.sh's layout: `windows95-v3/<start>-<end>.img`, 256 KB parts, 471,859,200 bytes. |

To make a chunked mirror from an image: `split -b 262144 -d` and rename the parts to
`<offset>-<offset+262144>.img`, then host them on a CORS-enabled server.

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
