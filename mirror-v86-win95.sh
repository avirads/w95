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
