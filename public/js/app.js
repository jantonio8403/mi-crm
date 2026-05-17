(function () {
  // ── Sidebar hamburger ───────────────────────────────────────────
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

  function openSidebar()  { sidebar.classList.add('open');    overlay.classList.add('visible'); }
  function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('visible'); }

  btn.addEventListener('click', () => sidebar.classList.contains('open') ? closeSidebar() : openSidebar());
  overlay.addEventListener('click', closeSidebar);
  sidebar.querySelectorAll('a').forEach(a => a.addEventListener('click', closeSidebar));

  // ── Autocomplete de directorio de funcionarios ──────────────────
  const inpDest    = document.getElementById('inp-destinatario');
  const inpCargo   = document.getElementById('inp-cargo-dest');
  const inpInstit  = document.getElementById('inp-institucion-dest');
  const dropdown   = document.getElementById('dir-dropdown');

  if (!inpDest || !dropdown) return;

  let debounceTimer = null;
  let currentFocus  = -1;
  let ultimaQuery   = '';

  function mostrarDropdown(items) {
    dropdown.innerHTML = '';
    currentFocus = -1;

    if (items.length === 0) {
      dropdown.innerHTML = '<div class="dir-no-results">Sin resultados en el directorio</div>';
      dropdown.style.display = 'block';
      return;
    }

    items.forEach(function (f) {
      const esInterno = f.tipo === 'interno';
      const subtitulo = (f.cargo || '') + (f.cargo && (esInterno ? f.area_nombre : f.institucion) ? ' · ' : '') + (esInterno ? (f.area_nombre || '') : (f.institucion || ''));

      const el = document.createElement('div');
      el.className = 'dir-item';
      el.innerHTML =
        '<div class="dir-item-tipo ' + (esInterno ? 'int' : 'ext') + '">' +
          (esInterno ? 'I' : 'E') +
        '</div>' +
        '<div class="dir-item-info">' +
          '<div class="dir-item-nombre">' + f.nombre + '</div>' +
          '<div class="dir-item-sub">' + (subtitulo || '—') + '</div>' +
        '</div>';

      el.addEventListener('mousedown', function (e) {
        e.preventDefault();
        seleccionar(f);
      });

      dropdown.appendChild(el);
    });

    dropdown.style.display = 'block';
  }

  function ocultarDropdown() {
    dropdown.style.display = 'none';
    currentFocus = -1;
  }

  function seleccionar(f) {
    inpDest.value = f.nombre;
    if (inpCargo)  inpCargo.value  = f.cargo  || '';
    if (inpInstit) inpInstit.value = f.tipo === 'interno' ? (f.area_nombre || '') : (f.institucion || '');
    ocultarDropdown();
  }

  function buscar(q) {
    if (!q.trim()) { ocultarDropdown(); return; }
    ultimaQuery = q;
    fetch('/directorio/buscar?q=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (ultimaQuery === q) mostrarDropdown(data);
      })
      .catch(function () { ocultarDropdown(); });
  }

  inpDest.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { buscar(inpDest.value); }, 260);
  });

  inpDest.addEventListener('focus', function () {
    if (inpDest.value.trim().length > 0) buscar(inpDest.value);
  });

  inpDest.addEventListener('keydown', function (e) {
    const items = dropdown.querySelectorAll('.dir-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      currentFocus = Math.min(currentFocus + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      currentFocus = Math.max(currentFocus - 1, 0);
    } else if (e.key === 'Enter' && currentFocus >= 0) {
      e.preventDefault();
      items[currentFocus].dispatchEvent(new Event('mousedown'));
      return;
    } else if (e.key === 'Escape') {
      ocultarDropdown();
      return;
    }

    items.forEach(function (it, i) {
      it.classList.toggle('activo', i === currentFocus);
    });
    if (currentFocus >= 0) items[currentFocus].scrollIntoView({ block: 'nearest' });
  });

  document.addEventListener('click', function (e) {
    if (!inpDest.contains(e.target) && !dropdown.contains(e.target)) ocultarDropdown();
  });
})();
