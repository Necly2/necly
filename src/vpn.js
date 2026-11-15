// Проверка VPN: сайты Авито / Циана / Ozon с VPN часто не открываются или показывают проверку на робота.
// Признаки: (1) активный VPN-адаптер (WireGuard/OpenVPN/TAP/utun с IPv4…), (2) обычный интернет есть, а наши сайты не отвечают.
const os = require('os');
const { net } = require('electron');

const VPN_NAME = /(wireguard|wg\d|openvpn|tap-?windows|\btap\d|\btun\d|outline|nord|proton|expressvpn|surfshark|amnezia|hiddify|v2ray|xray|clash|sing-?box|nekoray|happ|vpn|ppp\d|ipsec)/i;
function adapterVpn() {
  const ifs = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifs)) {
    // 169.254.x.x — адрес неподключённого адаптера (установленный, но выключенный VPN-клиент) — не считается
    const v4 = (list || []).filter(a => a.family === 'IPv4' && !a.internal && !/^169\.254\./.test(a.address));
    if (!v4.length) continue;
    if (VPN_NAME.test(name)) return name;
    // macOS: системные utun без IPv4; VPN-клиенты поднимают utun с IPv4
    if (/^utun\d+$/.test(name) && process.platform === 'darwin') return name;
  }
  return null;
}
async function reach(url, ms = 8000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { const r = await net.fetch(url, { method: 'GET', signal: ac.signal, redirect: 'follow' }); return r.status; }
  catch { return 0; } finally { clearTimeout(t); }
}
async function check() {
  const adapter = adapterVpn();
  const [ya, avito, cian, ozon] = await Promise.all([reach('https://ya.ru/'), reach('https://www.avito.ru/'), reach('https://www.cian.ru/'), reach('https://pvz-map.ozon.ru/')]);
  const internet = ya > 0 || avito > 0 || cian > 0;
  // «сайт не открывается» — только нет соединения или 451. Ответы 403 / 429 / 5xx сайты дают и без VPN (защита от роботов) —
  // раньше они считались признаком VPN, и предупреждение появлялось зря. Сам по себе адаптер (utun на Mac есть у многих программ) тоже не признак.
  const bad = [['Авито', avito], ['Циан', cian], ['Ozon', ozon]].filter(([, s]) => !s || s === 451).map(([n]) => n);
  const vpn = internet && ya > 0 && (adapter ? bad.length >= 1 : bad.length >= 3);
  return { adapter, internet, bad, vpn, status: { ya, avito, cian, ozon } };
}
// фоновая проверка: при включении VPN — уведомление (и окно в программе)
function watch(onChange, everyMs = 120000) {
  let last = null, streak = 0;
  const tick = async () => {
    const r = await check().catch(() => null); if (!r) return;
    // «VPN включён» — только после двух проверок подряд (разовый сбой сети не считается)
    streak = r.vpn ? streak + 1 : 0;
    const now = r.vpn && streak >= 2;
    if (last === null ? now : now !== last) onChange(Object.assign(r, { vpn: now }), last);
    last = now;
  };
  setTimeout(tick, 4000); return setInterval(tick, everyMs);
}
module.exports = { check, watch, adapterVpn };
