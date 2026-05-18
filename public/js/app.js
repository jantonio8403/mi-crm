// ── Mayúsculas globales ──────────────────────────────────────────────
(function () {
  var EXCLUIR_TIPOS = { email:1, password:1, hidden:1, date:1, file:1, checkbox:1, radio:1, number:1 };
  var EXCLUIR_NOMBRES = { username:1 };

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
    if (EXCLUIR_TIPOS[el.type]) return;
    if (EXCLUIR_NOMBRES[el.name]) return;
    if (el.dataset.noUpper !== undefined) return;
    var pos = el.selectionStart;
    el.value = el.value.toUpperCase();
    try { el.setSelectionRange(pos, pos); } catch (_) {}
  });
}());

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

