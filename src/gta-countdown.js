(() => {
  const release = Date.parse(document.getElementById('gtaRelease').dateTime);
  const timer = document.getElementById('gtaRemaining');
  const twoDigits = value => String(value).padStart(2, '0');

  function refresh() {
    const secondsLeft = Math.ceil((release - Date.now()) / 1000);
    if (secondsLeft <= 0) {
      timer.textContent = 'Игра вышла';
      return;
    }

    const days = Math.floor(secondsLeft / 86400);
    const hours = Math.floor(secondsLeft / 3600) % 24;
    const minutes = Math.floor(secondsLeft / 60) % 60;
    const seconds = secondsLeft % 60;
    timer.textContent = `${days} д ${twoDigits(hours)} ч ${twoDigits(minutes)} мин ${twoDigits(seconds)} с`;
  }

  refresh();
  window.setInterval(refresh, 1000);
  document.addEventListener('visibilitychange', refresh);
})();
