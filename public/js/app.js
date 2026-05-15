(function () {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  document.body.appendChild(overlay);

  const sidebar = document.querySelector('.sidebar');
  const topbar = document.querySelector('.topbar');
  if (!sidebar || !topbar) return;

  const btn = document.createElement('button');
  btn.className = 'hamburger';
  btn.setAttribute('aria-label', 'Abrir menú');
  btn.innerHTML = '&#9776;';
  topbar.insertBefore(btn, topbar.firstChild);

  function open() {
    sidebar.classList.add('open');
    overlay.classList.add('visible');
  }
  function close() {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
  }

  btn.addEventListener('click', () => sidebar.classList.contains('open') ? close() : open());
  overlay.addEventListener('click', close);
  sidebar.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
})();
