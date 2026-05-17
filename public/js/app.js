// ── Sidebar hamburger ───────────────────────────────────────────────
(function () {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  document.body.appendChild(overlay);

  const sidebar = document.querySelector('.sidebar');
  const topbar  = document.querySelector('.topbar');
  if (!sidebar || !topbar) return;

  const btn = document.createElement('button');
  btn.className = 'hamburger';
  btn.setAttribute('aria-label', 'Abrir menú');
  btn.innerHTML = '&#9776;';
  topbar.insertBefore(btn, topbar.firstChild);

  function openSidebar()  { sidebar.classList.add('open');    overlay.classList.add('visible'); }
  function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('visible'); }

  btn.addEventListener('click', function () {
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  });
  overlay.addEventListener('click', closeSidebar);
  sidebar.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', closeSidebar);
  });
}());

