const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { query } = require('../database/db');
const { requireAuth } = require('../controllers/authMiddleware');
const { generarOficioPDF } = require('../controllers/pdfGenerator');

// ─── Multer ──────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `ent-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

// ─── Destinatario fijo para circulares ───────────────────────────
const DESTINATARIO_CIRCULAR = 'Personal Médico y Paramédico, Trabajo Social, Internos de Pregrado, Administrativos, Pasantes de servicio social que laboran y/o prestan servicio en esta unidad médica';

// ─── Helper folio ─────────────────────────────────────────────────
async function siguienteFolio(tipo, area_id) {
  const anio = new Date().getFullYear();
  const prefijo = tipo === 'oficio' ? 'OFI' : tipo === 'circular' ? 'CIR' : 'MEM';

  // Obtener código del área
  let codigoArea = 'GEN';
  if (area_id) {
    const [area] = await query('SELECT codigo FROM areas WHERE id=?', [area_id]);
    if (area && area.codigo) codigoArea = area.codigo.toUpperCase();
  }

  // Consecutivo por área + tipo + año
  const [row] = await query(
    'SELECT MAX(consecutivo) as max FROM documentos_salientes WHERE tipo=? AND anio=? AND area_emisora_id<=>?',
    [tipo, anio, area_id || null]
  );
  const siguiente = (row.max || 0) + 1;
  return {
    consecutivo: siguiente,
    anio,
    numero_folio: `${prefijo}/${codigoArea}/${String(siguiente).padStart(4, '0')}/${anio}`,
  };
}

function folioToFilename(folio) {
  return folio.replace(/\//g, '-');
}

// ═══════════════════════════════════════════════════════════════
//  DOCUMENTOS SALIENTES
// ═══════════════════════════════════════════════════════════════

router.get('/salientes', requireAuth, async (req, res, next) => {
  try {
    const { tipo, estatus, buscar, page = 1 } = req.query;
    const limit = 15;
    const offset = (parseInt(page) - 1) * limit;

    let where = '1=1';
    const params = [];
    if (tipo) { where += ' AND ds.tipo=?'; params.push(tipo); }
    if (estatus) { where += ' AND ds.estatus=?'; params.push(estatus); }
    if (buscar) {
      where += ' AND (ds.numero_folio LIKE ? OR ds.asunto LIKE ? OR ds.destinatario LIKE ?)';
      params.push(`%${buscar}%`, `%${buscar}%`, `%${buscar}%`);
    }

    const [totalRow] = await query(`SELECT COUNT(*) as c FROM documentos_salientes ds WHERE ${where}`, params);
    const total = totalRow.c;
    const documentos = await query(
      `SELECT ds.*, a.nombre as area_nombre, u.nombre as elaborado_nombre
       FROM documentos_salientes ds
       LEFT JOIN areas a ON ds.area_emisora_id = a.id
       LEFT JOIN usuarios u ON ds.elaborado_por_id = u.id
       WHERE ${where} ORDER BY ds.creado_en DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.render('correspondencia/salientes-lista', {
      titulo: 'Documentos Emitidos',
      documentos,
      filtros: { tipo, estatus, buscar },
      paginacion: { page: parseInt(page), total, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

router.get('/salientes/nuevo', requireAuth, async (req, res, next) => {
  try {
    const tipo = req.query.tipo || 'oficio';
    const u = req.session.usuario;
    const areaFija = u.rol === 'jefe_area';
    const folio = await siguienteFolio(tipo, u.area_id || null);
    const areas = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');
    const [firmante] = await query(
      `SELECT nombre, cargo FROM funcionarios WHERE usuario_id=? AND tipo='interno' AND activo=1 LIMIT 1`,
      [u.id]
    );
    // Director del hospital — para jefe_area que quiera firmar en nombre de la dirección
    let director = null;
    if (areaFija) {
      const [dirPorRol] = await query(
        `SELECT f.nombre, f.cargo FROM funcionarios f
         INNER JOIN usuarios u2 ON f.usuario_id = u2.id
         WHERE u2.rol='director' AND f.tipo='interno' AND f.activo=1 LIMIT 1`
      );
      if (dirPorRol) {
        director = dirPorRol;
      } else {
        const [dirPorArea] = await query(
          `SELECT f.nombre, f.cargo FROM funcionarios f
           INNER JOIN areas a ON a.responsable_id = f.id
           WHERE a.nombre='Dirección' AND f.activo=1 LIMIT 1`
        );
        director = dirPorArea || null;
      }
    }
    let areaNombre = '';
    if (areaFija && u.area_id) {
      const [a] = await query('SELECT nombre FROM areas WHERE id=?', [u.area_id]);
      if (a) areaNombre = a.nombre;
    }
    const titulos = { oficio: 'Nuevo Oficio', memorandum: 'Nuevo Memorándum', circular: 'Nueva Circular' };
    res.render('correspondencia/salientes-form', {
      titulo: titulos[tipo] || 'Nuevo Documento',
      documento: null, folio, tipo, areas,
      firmante: firmante || null,
      director,
      areaFija, areaNombre,
      destinatarioCircular: DESTINATARIO_CIRCULAR,
      accion: '/correspondencia/salientes',
    });
  } catch (err) { next(err); }
});

router.get('/salientes/folio', requireAuth, async (req, res, next) => {
  try {
    const tipo = req.query.tipo || 'oficio';
    const areaId = req.query.area_id ? parseInt(req.query.area_id) : null;
    const folio = await siguienteFolio(tipo, areaId);
    res.json({ numero_folio: folio.numero_folio });
  } catch (err) { next(err); }
});

router.post('/salientes', requireAuth, async (req, res, next) => {
  try {
    const { tipo, fecha_emision, asunto, destinatario, cargo_destinatario,
            atencion_a, atencion_a_cargo, contenido, area_emisora_id,
            firmante_nombre, firmante_cargo,
            vobo_nombre, vobo_cargo,
            elaboro_nombre, elaboro_cargo } = req.body;

    const redir = `/correspondencia/salientes/nuevo?tipo=${tipo}`;

    // ── Validación servidor ───────────────────────────────────────────────────
    // Circular: destinatario es fijo, no se valida contra el directorio
    if (tipo !== 'circular') {
      const tipoDestino = tipo === 'memorandum' ? 'interno' : 'externo';
      const [destOk] = await query(
        'SELECT id FROM funcionarios WHERE nombre=? AND tipo=? AND activo=1 LIMIT 1',
        [destinatario, tipoDestino]
      );
      if (!destOk) {
        req.flash('error', 'El destinatario no existe en el directorio. Selecciónalo del autocomplete.');
        return res.redirect(redir);
      }
    }

    if (tipo === 'oficio' && atencion_a) {
      const [atenOk] = await query(
        "SELECT id FROM funcionarios WHERE nombre=? AND tipo='externo' AND activo=1 LIMIT 1",
        [atencion_a]
      );
      if (!atenOk) {
        req.flash('error', '"Con atención a" no existe en el directorio externo. Selecciónalo del autocomplete.');
        return res.redirect(redir);
      }
    }

    if (!firmante_nombre) {
      req.flash('error', 'El firmante es obligatorio. Selecciónalo del directorio interno.');
      return res.redirect(redir);
    }
    const [firmanteOk] = await query(
      "SELECT id FROM funcionarios WHERE nombre=? AND tipo='interno' AND activo=1 LIMIT 1",
      [firmante_nombre]
    );
    if (!firmanteOk) {
      req.flash('error', 'El firmante no existe en el directorio interno. Selecciónalo del autocomplete.');
      return res.redirect(redir);
    }

    if (vobo_nombre && vobo_nombre.trim()) {
      const [voboOk] = await query(
        "SELECT id FROM funcionarios WHERE nombre=? AND tipo='interno' AND activo=1 LIMIT 1",
        [vobo_nombre.trim()]
      );
      if (!voboOk) {
        req.flash('error', 'El Vo. Bo. no existe en el directorio interno. Selecciónalo del autocomplete.');
        return res.redirect(redir);
      }
    }

    // elaboro: siempre del funcionario vinculado al usuario en sesión (ignorar body)
    const [elaboroFunc] = await query(
      "SELECT nombre, cargo FROM funcionarios WHERE usuario_id=? AND tipo='interno' AND activo=1 LIMIT 1",
      [req.session.usuario.id]
    );
    const elaboro_nombre_real = elaboroFunc ? elaboroFunc.nombre : null;
    const elaboro_cargo_real  = elaboroFunc ? elaboroFunc.cargo  : null;

    if (tipo === 'oficio' && req.body.copias) {
      const copiasRaw = Array.isArray(req.body.copias)
        ? req.body.copias : Object.values(req.body.copias);
      for (const c of copiasRaw) {
        if (!c || !c.nombre || !c.nombre.trim()) continue;
        const [copiaOk] = await query(
          "SELECT id FROM funcionarios WHERE nombre=? AND tipo='externo' AND activo=1 LIMIT 1",
          [c.nombre.trim()]
        );
        if (!copiaOk) {
          req.flash('error', `La copia para "${c.nombre.trim()}" no existe en el directorio. Selecciónala del autocomplete.`);
          return res.redirect(redir);
        }
      }
    }
    // ── Fin validación ────────────────────────────────────────────────────────

    // Jefe de área: su área es siempre la emisora, independiente del body
    const u = req.session.usuario;
    const areaId = u.rol === 'jefe_area'
      ? (u.area_id || null)
      : (area_emisora_id ? parseInt(area_emisora_id) : (u.area_id || null));
    const { consecutivo, anio, numero_folio } = await siguienteFolio(tipo, areaId);

    const result = await query(
      `INSERT INTO documentos_salientes
       (tipo, numero_folio, consecutivo, anio, fecha_emision, asunto, destinatario,
        cargo_destinatario, atencion_a, atencion_a_cargo, contenido, area_emisora_id,
        elaborado_por_id, firmante_nombre, firmante_cargo,
        vobo_nombre, vobo_cargo, elaboro_nombre, elaboro_cargo, estatus)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'borrador')`,
      [tipo, numero_folio, consecutivo, anio, fecha_emision, asunto,
       tipo === 'circular' ? DESTINATARIO_CIRCULAR : destinatario,
       tipo === 'circular' ? null : (cargo_destinatario || null),
       tipo === 'oficio' ? (atencion_a || null) : null,
       tipo === 'oficio' ? (atencion_a_cargo || null) : null,
       contenido, areaId, req.session.usuario.id,
       firmante_nombre || null, firmante_cargo || null,
       vobo_nombre ? vobo_nombre.trim() : null, vobo_cargo ? vobo_cargo.trim() : null,
       elaboro_nombre_real, elaboro_cargo_real]
    );
    const id = result.insertId;

    // Guardar copias (C.c.p.) — solo oficio
    if (tipo === 'oficio' && req.body.copias) {
      const copiasRaw = Array.isArray(req.body.copias)
        ? req.body.copias : Object.values(req.body.copias);
      let orden = 0;
      for (const c of copiasRaw) {
        if (c && c.nombre && c.nombre.trim()) {
          await query(
            'INSERT INTO documento_copias (documento_id, nombre, cargo, orden) VALUES (?,?,?,?)',
            [id, c.nombre.trim(), c.cargo ? c.cargo.trim() : null, orden++]
          );
        }
      }
    }

    try {
      const nombreArchivo = folioToFilename(numero_folio);
      const rutaPdf = path.join(__dirname, `../pdfs/${nombreArchivo}.pdf`);
      const [doc] = await query('SELECT * FROM documentos_salientes WHERE id=?', [id]);
      const copias = await query('SELECT * FROM documento_copias WHERE documento_id=? ORDER BY orden', [id]);
      await generarOficioPDF(doc, rutaPdf, copias);
      await query('UPDATE documentos_salientes SET ruta_pdf=? WHERE id=?',
        [`/pdfs/${nombreArchivo}.pdf`, id]);
    } catch (e) {
      console.error('Error al generar PDF:', e.message);
    }

    req.flash('success', `${tipo === 'oficio' ? 'Oficio' : 'Memorándum'} ${numero_folio} creado correctamente`);
    res.redirect(`/correspondencia/salientes/${id}`);
  } catch (err) { next(err); }
});

// ── Editar borrador ───────────────────────────────────────────
async function cargarDatosEdicion(u, areaFija) {
  const firmante = (await query(
    `SELECT nombre, cargo FROM funcionarios WHERE usuario_id=? AND tipo='interno' AND activo=1 LIMIT 1`,
    [u.id]
  ))[0] || null;
  let director = null;
  if (areaFija) {
    const [d1] = await query(
      `SELECT f.nombre, f.cargo FROM funcionarios f
       INNER JOIN usuarios u2 ON f.usuario_id=u2.id
       WHERE u2.rol='director' AND f.tipo='interno' AND f.activo=1 LIMIT 1`
    );
    if (d1) { director = d1; }
    else {
      const [d2] = await query(
        `SELECT f.nombre, f.cargo FROM funcionarios f
         INNER JOIN areas a ON a.responsable_id=f.id
         WHERE a.nombre='Dirección' AND f.activo=1 LIMIT 1`
      );
      director = d2 || null;
    }
  }
  return { firmante, director };
}

router.get('/salientes/:id/editar', requireAuth, async (req, res, next) => {
  try {
    const [doc] = await query('SELECT * FROM documentos_salientes WHERE id=?', [req.params.id]);
    if (!doc) { req.flash('error', 'Documento no encontrado'); return res.redirect('/correspondencia/salientes'); }
    if (doc.estatus !== 'borrador') {
      req.flash('error', 'Solo se pueden editar documentos en borrador');
      return res.redirect(`/correspondencia/salientes/${req.params.id}`);
    }
    const u = req.session.usuario;
    const areaFija = u.rol === 'jefe_area';
    const areas = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');
    const copias = await query('SELECT * FROM documento_copias WHERE documento_id=? ORDER BY orden', [doc.id]);
    const { firmante, director } = await cargarDatosEdicion(u, areaFija);
    let areaNombre = '';
    if (areaFija && u.area_id) {
      const [a] = await query('SELECT nombre FROM areas WHERE id=?', [u.area_id]);
      if (a) areaNombre = a.nombre;
    }
    // Normalizar fecha para input[type=date]
    doc.fecha_emisionStr = doc.fecha_emision instanceof Date
      ? doc.fecha_emision.toISOString().split('T')[0]
      : String(doc.fecha_emision || '').split('T')[0];
    const titulos = { oficio: 'Editar Oficio', memorandum: 'Editar Memorándum', circular: 'Editar Circular' };
    res.render('correspondencia/salientes-form', {
      titulo: titulos[doc.tipo] || 'Editar Documento',
      documento: doc, folio: { numero_folio: doc.numero_folio },
      tipo: doc.tipo, areas, copias,
      firmante, director, areaFija, areaNombre,
      destinatarioCircular: DESTINATARIO_CIRCULAR,
      accion: `/correspondencia/salientes/${doc.id}/editar`,
    });
  } catch (err) { next(err); }
});

router.post('/salientes/:id/editar', requireAuth, async (req, res, next) => {
  try {
    const [doc] = await query('SELECT * FROM documentos_salientes WHERE id=?', [req.params.id]);
    if (!doc) { req.flash('error', 'Documento no encontrado'); return res.redirect('/correspondencia/salientes'); }
    if (doc.estatus !== 'borrador') {
      req.flash('error', 'Solo se pueden editar documentos en borrador');
      return res.redirect(`/correspondencia/salientes/${req.params.id}`);
    }
    const redir = `/correspondencia/salientes/${req.params.id}/editar`;
    const u = req.session.usuario;
    const { tipo, fecha_emision, asunto, destinatario, cargo_destinatario,
            atencion_a, atencion_a_cargo, contenido, area_emisora_id,
            firmante_nombre, firmante_cargo,
            vobo_nombre, vobo_cargo, elaboro_nombre, elaboro_cargo } = req.body;

    // ── Validaciones (mismas que en creación) ────────────────────
    if (tipo !== 'circular') {
      const tipoDestino = tipo === 'memorandum' ? 'interno' : 'externo';
      const [destOk] = await query(
        'SELECT id FROM funcionarios WHERE nombre=? AND tipo=? AND activo=1 LIMIT 1',
        [destinatario, tipoDestino]
      );
      if (!destOk) { req.flash('error', 'El destinatario no existe en el directorio.'); return res.redirect(redir); }
    }

    if (tipo === 'oficio' && atencion_a) {
      const [aOk] = await query(
        "SELECT id FROM funcionarios WHERE nombre=? AND tipo='externo' AND activo=1 LIMIT 1",
        [atencion_a]
      );
      if (!aOk) { req.flash('error', '"Con atención a" no existe en el directorio externo.'); return res.redirect(redir); }
    }
    if (!firmante_nombre) { req.flash('error', 'El firmante es obligatorio.'); return res.redirect(redir); }
    const [firOk] = await query(
      "SELECT id FROM funcionarios WHERE nombre=? AND tipo='interno' AND activo=1 LIMIT 1",
      [firmante_nombre]
    );
    if (!firOk) { req.flash('error', 'El firmante no existe en el directorio interno.'); return res.redirect(redir); }

    if (vobo_nombre && vobo_nombre.trim()) {
      const [vOk] = await query(
        "SELECT id FROM funcionarios WHERE nombre=? AND tipo='interno' AND activo=1 LIMIT 1",
        [vobo_nombre.trim()]
      );
      if (!vOk) { req.flash('error', 'El Vo. Bo. no existe en el directorio interno.'); return res.redirect(redir); }
    }
    // elaboro: del funcionario vinculado al usuario en sesión (ignorar body)
    const [elaboroFuncEd] = await query(
      "SELECT nombre, cargo FROM funcionarios WHERE usuario_id=? AND tipo='interno' AND activo=1 LIMIT 1",
      [u.id]
    );
    const elaboro_nombre_real = elaboroFuncEd ? elaboroFuncEd.nombre : null;
    const elaboro_cargo_real  = elaboroFuncEd ? elaboroFuncEd.cargo  : null;
    if (tipo === 'oficio' && req.body.copias) {
      const cr = Array.isArray(req.body.copias) ? req.body.copias : Object.values(req.body.copias);
      for (const c of cr) {
        if (!c || !c.nombre || !c.nombre.trim()) continue;
        const [cOk] = await query(
          "SELECT id FROM funcionarios WHERE nombre=? AND tipo='externo' AND activo=1 LIMIT 1",
          [c.nombre.trim()]
        );
        if (!cOk) { req.flash('error', `Copia para "${c.nombre.trim()}" no existe en el directorio.`); return res.redirect(redir); }
      }
    }
    // ── Actualizar ───────────────────────────────────────────────
    const areaId = u.rol === 'jefe_area'
      ? (u.area_id || null)
      : (area_emisora_id ? parseInt(area_emisora_id) : (u.area_id || null));

    await query(
      `UPDATE documentos_salientes SET
       fecha_emision=?, asunto=?, destinatario=?, cargo_destinatario=?,
       atencion_a=?, atencion_a_cargo=?, contenido=?, area_emisora_id=?,
       firmante_nombre=?, firmante_cargo=?,
       vobo_nombre=?, vobo_cargo=?, elaboro_nombre=?, elaboro_cargo=?
       WHERE id=?`,
      [fecha_emision, asunto,
       tipo === 'circular' ? DESTINATARIO_CIRCULAR : destinatario,
       tipo === 'circular' ? null : (cargo_destinatario || null),
       tipo === 'oficio' ? (atencion_a || null) : null,
       tipo === 'oficio' ? (atencion_a_cargo || null) : null,
       contenido, areaId,
       firmante_nombre || null, firmante_cargo || null,
       vobo_nombre ? vobo_nombre.trim() : null, vobo_cargo ? vobo_cargo.trim() : null,
       elaboro_nombre_real, elaboro_cargo_real,
       req.params.id]
    );
    // Copias: borrar y reemplazar
    await query('DELETE FROM documento_copias WHERE documento_id=?', [req.params.id]);
    if (tipo === 'oficio' && req.body.copias) {
      const cr = Array.isArray(req.body.copias) ? req.body.copias : Object.values(req.body.copias);
      let orden = 0;
      for (const c of cr) {
        if (c && c.nombre && c.nombre.trim())
          await query('INSERT INTO documento_copias (documento_id, nombre, cargo, orden) VALUES (?,?,?,?)',
            [req.params.id, c.nombre.trim(), c.cargo ? c.cargo.trim() : null, orden++]);
      }
    }
    // Regenerar PDF
    try {
      const [docAct] = await query('SELECT * FROM documentos_salientes WHERE id=?', [req.params.id]);
      const copiasAct = await query('SELECT * FROM documento_copias WHERE documento_id=? ORDER BY orden', [req.params.id]);
      const nombreArchivo = folioToFilename(docAct.numero_folio);
      const rutaPdf = path.join(__dirname, `../pdfs/${nombreArchivo}.pdf`);
      await generarOficioPDF(docAct, rutaPdf, copiasAct);
      await query('UPDATE documentos_salientes SET ruta_pdf=? WHERE id=?', [`/pdfs/${nombreArchivo}.pdf`, req.params.id]);
    } catch (e) { console.error('Error PDF edición:', e.message); }

    req.flash('success', 'Documento actualizado correctamente');
    res.redirect(`/correspondencia/salientes/${req.params.id}`);
  } catch (err) { next(err); }
});

router.get('/salientes/:id', requireAuth, async (req, res, next) => {
  try {
    const [doc] = await query(
      `SELECT ds.*, a.nombre as area_nombre, u.nombre as elaborado_nombre
       FROM documentos_salientes ds
       LEFT JOIN areas a ON ds.area_emisora_id = a.id
       LEFT JOIN usuarios u ON ds.elaborado_por_id = u.id
       WHERE ds.id=?`, [req.params.id]
    );
    if (!doc) { req.flash('error', 'Documento no encontrado'); return res.redirect('/correspondencia/salientes'); }
    const copias = await query('SELECT * FROM documento_copias WHERE documento_id=? ORDER BY orden', [doc.id]);
    res.render('correspondencia/salientes-detalle', {
      titulo: `${doc.tipo === 'oficio' ? 'Oficio' : 'Memorándum'} ${doc.numero_folio}`,
      doc, copias,
    });
  } catch (err) { next(err); }
});

router.post('/salientes/:id/estatus', requireAuth, async (req, res, next) => {
  try {
    const { estatus } = req.body;
    await query('UPDATE documentos_salientes SET estatus=? WHERE id=?', [estatus, req.params.id]);
    req.flash('success', 'Estatus actualizado');
    res.redirect(`/correspondencia/salientes/${req.params.id}`);
  } catch (err) { next(err); }
});

router.post('/salientes/:id/leer', requireAuth, async (req, res, next) => {
  try {
    await query(
      `UPDATE documentos_salientes SET leido_en=NOW() WHERE id=? AND tipo='memorandum' AND leido_en IS NULL`,
      [req.params.id]
    );
    req.flash('success', 'Memorándum marcado como leído');
    res.redirect(`/correspondencia/salientes/${req.params.id}`);
  } catch (err) { next(err); }
});

router.post('/salientes/:id/regenerar-pdf', requireAuth, async (req, res, next) => {
  try {
    const [doc] = await query('SELECT * FROM documentos_salientes WHERE id=?', [req.params.id]);
    if (!doc) return res.redirect('/correspondencia/salientes');
    const nombreArchivo = folioToFilename(doc.numero_folio);
    const rutaPdf = path.join(__dirname, `../pdfs/${nombreArchivo}.pdf`);
    const copias = await query('SELECT * FROM documento_copias WHERE documento_id=? ORDER BY orden', [doc.id]);
    await generarOficioPDF(doc, rutaPdf, copias);
    await query('UPDATE documentos_salientes SET ruta_pdf=? WHERE id=?',
      [`/pdfs/${nombreArchivo}.pdf`, doc.id]);
    req.flash('success', 'PDF regenerado correctamente');
    res.redirect(`/correspondencia/salientes/${doc.id}`);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════
//  CORRESPONDENCIA ENTRANTE
// ═══════════════════════════════════════════════════════════════

router.get('/entrante', requireAuth, async (req, res, next) => {
  try {
    const { tipo, estatus, buscar, page = 1 } = req.query;
    const limit = 15;
    const offset = (parseInt(page) - 1) * limit;

    let where = '1=1';
    const params = [];
    if (tipo) { where += ' AND ce.tipo=?'; params.push(tipo); }
    if (estatus) { where += ' AND ce.estatus=?'; params.push(estatus); }
    if (buscar) {
      where += ' AND (ce.folio_externo LIKE ? OR ce.asunto LIKE ? OR ce.remitente_nombre LIKE ? OR ce.remitente_institucion LIKE ?)';
      params.push(`%${buscar}%`, `%${buscar}%`, `%${buscar}%`, `%${buscar}%`);
    }

    const [totalRow] = await query(`SELECT COUNT(*) as c FROM correspondencia_entrante ce WHERE ${where}`, params);
    const total = totalRow.c;
    const documentos = await query(
      `SELECT ce.*, a.nombre as area_nombre
       FROM correspondencia_entrante ce
       LEFT JOIN areas a ON ce.area_destinataria_id = a.id
       WHERE ${where} ORDER BY ce.fecha_recepcion DESC, ce.creado_en DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.render('correspondencia/entrante-lista', {
      titulo: 'Correspondencia Recibida',
      documentos,
      filtros: { tipo, estatus, buscar },
      paginacion: { page: parseInt(page), total, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

router.get('/entrante/nuevo', requireAuth, async (req, res, next) => {
  try {
    const areas = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');
    const hoy = new Date().toISOString().split('T')[0];
    res.render('correspondencia/entrante-form', {
      titulo: 'Registrar Correspondencia Recibida',
      documento: null, areas, hoy,
      accion: '/correspondencia/entrante',
    });
  } catch (err) { next(err); }
});

router.post('/entrante', requireAuth, upload.single('archivo'), async (req, res, next) => {
  try {
    const { folio_externo, tipo, fecha_recepcion, fecha_documento,
            remitente_nombre, remitente_cargo, remitente_institucion,
            asunto, descripcion, area_destinataria_id,
            requiere_respuesta, fecha_limite_respuesta, notas } = req.body;

    const ruta_archivo = req.file ? `/uploads/${req.file.filename}` : null;

    await query(
      `INSERT INTO correspondencia_entrante
       (folio_externo, tipo, fecha_recepcion, fecha_documento, remitente_nombre, remitente_cargo,
        remitente_institucion, asunto, descripcion, area_destinataria_id, requiere_respuesta,
        fecha_limite_respuesta, ruta_archivo, notas, registrado_por_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [folio_externo || null, tipo, fecha_recepcion, fecha_documento || null,
       remitente_nombre, remitente_cargo || null, remitente_institucion,
       asunto, descripcion || null, area_destinataria_id || null,
       requiere_respuesta === 'on' ? 1 : 0,
       fecha_limite_respuesta || null, ruta_archivo, notas || null,
       req.session.usuario.id]
    );

    req.flash('success', 'Correspondencia registrada correctamente');
    res.redirect('/correspondencia/entrante');
  } catch (err) { next(err); }
});

router.get('/entrante/:id', requireAuth, async (req, res, next) => {
  try {
    const [doc] = await query(
      `SELECT ce.*, a.nombre as area_nombre, u.nombre as registrado_nombre
       FROM correspondencia_entrante ce
       LEFT JOIN areas a ON ce.area_destinataria_id = a.id
       LEFT JOIN usuarios u ON ce.registrado_por_id = u.id
       WHERE ce.id=?`, [req.params.id]
    );
    if (!doc) { req.flash('error', 'Documento no encontrado'); return res.redirect('/correspondencia/entrante'); }
    res.render('correspondencia/entrante-detalle', {
      titulo: `Correspondencia: ${doc.asunto}`,
      doc,
    });
  } catch (err) { next(err); }
});

router.post('/entrante/:id/estatus', requireAuth, async (req, res, next) => {
  try {
    const { estatus, notas } = req.body;
    await query(
      'UPDATE correspondencia_entrante SET estatus=?, notas=? WHERE id=?',
      [estatus, notas || null, req.params.id]
    );
    req.flash('success', 'Estatus actualizado');
    res.redirect(`/correspondencia/entrante/${req.params.id}`);
  } catch (err) { next(err); }
});

module.exports = router;
