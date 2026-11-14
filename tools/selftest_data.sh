#!/bin/bash
d=$1; rm -rf $d; mkdir -p $d/shots $d/home "$d/home/.config/PVZ Master" $d/pvz/A/Ноябрь/Адреса\ 13 $d/pvz/C $d/pvz/O/Ноябрь
# старый сценарий (должен стать заказом с общими папками) и заказ со своими папками (J/Выгрузки, J/Результаты)
mkdir -p "$d/pvz/J/Выгрузки/Ноябрь/Циан 14" "$d/pvz/J/Результаты/Ноябрь"
echo "{\"root\":\"$d/pvz/A\",\"cianRoot\":\"$d/pvz/C\",\"ozonOut\":\"$d/pvz/O\",\"presets\":{\"Старый сценарий\":{\"cian\":true,\"avito\":false,\"region\":\"msk_mo\",\"priceTo\":120000}},\"schedules\":[{\"id\":\"s1\",\"enabled\":true,\"time\":\"13:30\",\"days\":[1],\"kind\":\"preset\",\"preset\":\"Старый сценарий\",\"name\":\"Старый сценарий\"}],\"jobs\":[{\"id\":\"jt1\",\"name\":\"Заказ Химки\",\"color\":\"#F97316\",\"exp\":\"$d/pvz/J/Выгрузки\",\"res\":\"$d/pvz/J/Результаты\",\"sources\":{\"cian\":true,\"avito\":false,\"winner\":false},\"checks\":{\"ozon\":true},\"params\":{\"region\":\"msk_mo\",\"areaFrom\":40},\"lastRun\":1763100000000}]}" > "$d/home/.config/PVZ Master/config.json"
now=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
echo "[{\"type\":\"check\",\"ok\":true,\"dur\":600000,\"done\":200,\"time\":\"$now\"},{\"type\":\"export\",\"site\":\"cian\",\"ok\":true,\"dur\":240000,\"total\":128,\"time\":\"$now\"},{\"type\":\"export\",\"site\":\"avito\",\"ok\":true,\"dur\":180000,\"total\":40,\"time\":\"$now\"}]" > "$d/home/.config/PVZ Master/history.json"
cp "tools/fixtures/export_excel 13 1.xlsx" "$d/pvz/A/Ноябрь/Адреса 13/"
cp "tools/fixtures/out/Ноябрь/OZON export_excel 13 1.xlsx" $d/pvz/O/Ноябрь/
echo "{\"files\":{\"$d/pvz/A/Ноябрь/Адреса 13/export_excel 13 1.xlsx\":{\"size\":1,\"result\":\"$d/pvz/O/Ноябрь/OZON export_excel 13 1.xlsx\"}}}" > $d/pvz/O/ozon_checked.json
cp "tools/fixtures/export_excel 13 1.xlsx" "$d/pvz/J/Выгрузки/Ноябрь/Циан 14/export_excel ЦИАН 14 1.xlsx"
cp "tools/fixtures/out/Ноябрь/OZON export_excel 13 1.xlsx" "$d/pvz/J/Результаты/Ноябрь/OZON export_excel ЦИАН 14 1.xlsx"
echo "{\"files\":{\"$d/pvz/J/Выгрузки/Ноябрь/Циан 14/export_excel ЦИАН 14 1.xlsx\":{\"size\":1,\"result\":\"$d/pvz/J/Результаты/Ноябрь/OZON export_excel ЦИАН 14 1.xlsx\"}}}" > "$d/pvz/J/Результаты/ozon_checked.json"
cd "$(dirname "$0")/.." && HOME=$d/home PVZ_FAKE=1 PVZ_DEEP=1 PVZ_THEME=${2:-dark} PVZ_SHOT=$d/shots timeout 200 xvfb-run -a -s "-screen 0 1400x900x24" node_modules/.bin/electron --no-sandbox --ignore-certificate-errors . > $d/log.txt 2>&1
grep -h "RENDERER\|JSERR\|JOB\|SCHED\|RJOB\|DEEP\|MORE\|KEYS\|HOMESUM\|JOKE\|ETA" $d/log.txt | head -30
