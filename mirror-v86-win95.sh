#!/usr/bin/env bash
# Mirror copy/v86's Windows 95 profile as 256 KiB parts for local browser reads.
# Windows 95 is proprietary; run only if authorized to host and use the image.
set -euo pipefail

destination=${1:?Usage: mirror-v86-win95.sh DESTINATION_DIR}
mkdir -p "$destination"
export destination

seq 0 1799 | xargs -P 12 -I '{}' bash -c '
  set -euo pipefail
  number=$1
  start=$((number * 262144))
  end=$((start + 262144))
  target="$destination/$start-$end.img"
  if [[ -f $target && $(stat -c %s "$target") -eq 262144 ]]; then exit 0; fi
  curl -fsS --retry 3 --connect-timeout 15 --max-time 120 \
    "https://i.copy.sh/windows95-v3/$start-$end.img" -o "$target.part"
  [[ $(stat -c %s "$target.part") -eq 262144 ]]
  mv "$target.part" "$target"
' _ '{}'

for number in $(seq 0 1799); do
  start=$((number * 262144))
  end=$((start + 262144))
  [[ $(stat -c %s "$destination/$start-$end.img") -eq 262144 ]]
done
echo "Verified 1800 Windows 95 chunks (471859200 bytes) in $destination"

# IE's HKCU Start Page lives in this chunk of the stock windows95-v3 USER.DAT.
# Keep the replacement the same length to avoid rewriting FAT/registry layout.
python3 - "$destination/212074496-212336640.img" <<'PY'
from pathlib import Path
import sys

chunk = Path(sys.argv[1])
data = bytearray(chunk.read_bytes())
old = b"Start Pagehttp://copy.sh"
new = b"Start Pageabout:blank\x00\x00\x00"
if data.count(new) == 1:
    print("Internet Explorer home page already set to about:blank")
elif data.count(old) == 1:
    offset = data.index(old)
    data[offset:offset + len(old)] = new
    replacement = chunk.with_name(chunk.name + ".tmp-homepage")
    replacement.write_bytes(data)
    replacement.chmod(chunk.stat().st_mode)
    replacement.replace(chunk)
    print("Set Internet Explorer home page to about:blank")
else:
    raise SystemExit("Unrecognized Windows 95 registry layout; home page not changed")
PY
