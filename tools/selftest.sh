#!/bin/bash
# $1 = dir, $2 = with folders (1/0), $3 theme
d=$1; rm -rf $d; mkdir -p $d/shots $d/home
if [ "$2" = "1" ]; then mkdir -p "$d/home/.config/PVZ Master" $d/pvz/A $d/pvz/C $d/pvz/O; echo "{\"root\":\"$d/pvz/A\",\"cianRoot\":\"$d/pvz/C\",\"ozonOut\":\"$d/pvz/O\"}" > "$d/home/.config/PVZ Master/config.json"; fi
cd /home/claude/necly && HOME=$d/home PVZ_FAKE=${4:-} PVZ_EXT=${5:-} PVZ_DEEP=${6:-} PVZ_THEME=${3:-dark} PVZ_SHOT=$d/shots timeout 100 xvfb-run -a -s "-screen 0 1400x900x24" node_modules/.bin/electron --no-sandbox --ignore-certificate-errors . > $d/log.txt 2>&1
grep -h "RENDERER\|JSERR\|SELFTEST" $d/log.txt | head -5
