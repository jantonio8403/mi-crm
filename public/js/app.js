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

// ── Autocomplete — Directorio de funcionarios ───────────────────────
(function () {
  var inpDest   = document.getElementById('inp-destinatario');
  var inpCargo  = document.getElementById('inp-cargo-dest');
  var inpInstit = document.getElementById('inp-institucion-dest');
  var dropdown  = document.getElementById('dir-dropdown');

  // Solo inicializar en páginas que tengan el campo destinatario
  if (!inpDest || !dropdown) return;

  var timer       = null;
  var foco        = -1;
  var ultimaQuery = '';

  function mostrar(items) {
    dropdown.innerHTML = '';
    foco = -1;

    if (!items || items.length === 0) {
      dropdown.innerHTML = '<div class="dir-no-results">Sin resultados en el directorio</div>';
      dropdown.style.display = 'block';
      return;
    }

    items.forEach(function (f) {
      var esInt   = f.tipo === 'interno';
      var segunda = '';
      if (f.cargo) segunda += f.cargo;
      var org = esInt ? (f.area_nombre || '') : (f.institucion || '');
      if (org) segunda += (segunda ? ' · ' : '') + org;

      var el = document.createElement('div');
      el.className = 'dir-item';
      el.innerHTML =
        '<div class="dir-item-tipo ' + (esInt ? 'int' : 'ext') + '">' + (esInt ? 'I' : 'E') + '</div>' +
        '<div class="dir-item-info">' +
          '<div class="dir-item-nombre">' + escHtml(f.nombre) + '</div>' +
          '<div class="dir-item-sub">'   + escHtml(segunda || '—') + '</div>' +
        '</div>';

      el.addEventListener('mousedown', function (e) {
        e.preventDefault();
        inpDest.value  = f.nombre;
        if (inpCargo)  inpCargo.value  = f.cargo || '';
        if (inpInstit) inpInstit.value = esInt ? (f.area_nombre || '') : (f.institucion || '');
        ocultar();
        inpDest.focus();
      });

      dropdown.appendChild(el);
    });

    dropdown.style.display = 'block';
  }

  function ocultar() {
    dropdown.style.display = 'none';
    foco = -1;
  }

  function buscar(q) {
    if (!q || !q.trim()) { ocultar(); return; }
    ultimaQuery = q;

    fetch('/directorio/buscar?q=' + encodeURIComponent(q.trim()), {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    })
    .then(function (r) {
      if (!r.ok) {
        console.warn('Directorio /buscar respondió con', r.status);
        ocultar();
        return null;
      }
      return r.json();
    })
    .then(function (data) {
      if (data && ultimaQuery === q) mostrar(data);
    })
    .catch(function (err) {
      console.warn('Error en búsqueda de directorio:', err);
      ocultar();
    });
  }

  // Escapar HTML para evitar XSS en el dropdown
  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Evento: escribir en el campo
  inpDest.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { buscar(inpDest.value); }, 250);
  });

  // Evento: recuperar foco con texto existente
  inpDest.addEventListener('focus', function () {
    if (inpDest.value.trim().length >= 1) buscar(inpDest.value);
  });

  // Navegación con teclado
  inpDest.addEventListener('keydown', function (e) {
    var items = dropdown.querySelectorAll('.dir-item');
    if (dropdown.style.display === 'none' || !items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      foco = Math.min(foco + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      foco = Math.max(foco - 1, 0);
    } else if (e.key === 'Enter' && foco >= 0) {
      e.preventDefault();
      items[foco].dispatchEvent(new MouseEvent('mousedown'));
      return;
    } else if (e.key === 'Escape') {
      ocultar();
      return;
    } else {
      return;
    }

    items.forEach(function (it, i) { it.classList.toggle('activo', i === foco); });
    if (foco >= 0) items[foco].scrollIntoView({ block: 'nearest' });
  });

  // Cerrar al hacer clic fuera
  document.addEventListener('click', function (e) {
    if (!inpDest.contains(e.target) && !dropdown.contains(e.target)) ocultar();
  });
}());
