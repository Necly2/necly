#!/bin/bash
d=$1; rm -rf $d; mkdir -p $d/shots $d/home "$d/home/.config/PVZ Master" $d/pvz/A/Ноябрь/Адреса\ 13 $d/pvz/C $d/pvz/O/Ноябрь
echo "{\"root\":\"$d/pvz/A\",\"cianRoot\":\"$d/pvz/C\",\"ozonOut\":\"$d/pvz/O\"}" > "$d/home/.config/PVZ Master/config.json"
now=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
echo "[{\"type\":\"check\",\"ok\":true,\"dur\":600000,\"done\":200,\"time\":\"$now\"},{\"type\":\"export\",\"site\":\"cian\",\"ok\":true,\"dur\":240000,\"total\":128,\"time\":\"$now\"},{\"type\":\"export\",\"site\":\"avito\",\"ok\":true,\"dur\":180000,\"total\":40,\"time\":\"$now\"}]" > "$d/home/.config/PVZ Master/history.json"
cp "tools/fixtures/export_excel 13 1.xlsx" "$d/pvz/A/Ноябрь/Адреса 13/"
cp "tools/fixtures/out/Ноябрь/OZON export_excel 13 1.xlsx" $d/pvz/O/Ноябрь/
echo "{\"files\":{\"$d/pvz/A/Ноябрь/Адреса 13/export_excel 13 1.xlsx\":{\"size\":1,\"result\":\"$d/pvz/O/Ноябрь/OZON export_excel 13 1.xlsx\"}}}" > $d/pvz/O/ozon_checked.json
cd /home/claude/necly && HOME=$d/home PVZ_FAKE=1 PVZ_DEEP=1 PVZ_THEME=${2:-dark} PVZ_SHOT=$d/shots timeout 150 xvfb-run -a -s "-screen 0 1400x900x24" node_modules/.bin/electron --no-sandbox --ignore-certificate-errors . > $d/log.txt 2>&1
grep -h "RENDERER\|JSERR\|DEEP\|MORE\|KEYS\|HOMESUM\|JOKE\|ETA" $d/log.txt | head -30
