const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database/db');
const { requireAuth } = require('../controllers/authMiddleware');
const { generarOficioPDF } = require('../controllers/pdfGenerator');

// ─── Multer para archivos entrantes ──────────────────────────────
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

// ─── Helpers ─────────────────────────────────────────────────────
function siguienteFolio(tipo) {
  const anio = new Date().getFullYear();
  const prefijo = tipo === 'oficio' ? 'OF' : 'MEM';
  const row = db.prepare(
    'SELECT MAX(consecutivo) as max FROM documentos_salientes WHERE tipo=? AND anio=?'
  ).get(tipo, anio);
  const siguiente = (row.max || 0) + 1;
  return {
    consecutivo: siguiente,
    anio,
    numero_folio: `${prefijo}-${String(siguiente).padStart(3, '0')}/${anio}`,
  };
}

// ═══════════════════════════════════════════════════════════════
//  DOCUMENTOS SALIENTES
// ═══════════════════════════════════════════════════════════════

router.get('/salientes', requireAuth, (req, res) => {
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

  const total = db.prepare(`SELECT COUNT(*) as c FROM documentos_salientes ds WHERE ${where}`).get(...params).c;
  const documentos = db.prepare(`
    SELECT ds.*, a.nombre as area_nombre, u.nombre as elaborado_nombre
    FROM documentos_salientes ds
    LEFT JOIN areas a ON ds.area_emisora_id = a.id
    LEFT JOIN usuarios u ON ds.elaborado_por_id = u.id
    WHERE ${where}
    ORDER BY ds.creado_en DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.render('correspondencia/salientes-lista', {
    titulo: 'Documentos Emitidos',
    documentos,
    filtros: { tipo, estatus, buscar },
    paginacion: { page: parseInt(page), total, limit, pages: Math.ceil(total / limit) },
  });
});

router.get('/salientes/nuevo', requireAuth, (req, res) => {
  const tipo = req.query.tipo || 'oficio';
  const folio = siguienteFolio(tipo);
  const areas = db.prepare('SELECT * FROM areas WHERE activa=1 ORDER BY nombre').all();
  res.render('correspondencia/salientes-form', {
    titulo: tipo === 'oficio' ? 'Nuevo Oficio' : 'Nuevo Memorándum',
    documento: null,
    folio,
    tipo,
    areas,
    accion: '/correspondencia/salientes',
  });
});

router.post('/salientes', requireAuth, async (req, res) => {
  const { tipo, fecha_emision, asunto, destinatario, cargo_destinatario,
          institucion_destinatario, contenido, area_emisora_id } = req.body;

  const { consecutivo, anio, numero_folio } = siguienteFolio(tipo);

  const stmt = db.prepare(`
    INSERT INTO documentos_salientes
    (tipo, numero_folio, consecutivo, anio, fecha_emision, asunto, destinatario,
     cargo_destinatario, institucion_destinatario, contenido, area_emisora_id, elaborado_por_id, estatus)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'borrador')
  `);
  const result = stmt.run(tipo, numero_folio, consecutivo, anio, fecha_emision, asunto,
    destinatario, cargo_destinatario || null, institucion_destinatario || null,
    contenido, area_emisora_id || null, req.session.usuario.id);

  const id = result.lastInsertRowid;

  // Generar PDF
  try {
    const rutaPdf = path.join(__dirname, `../pdfs/${numero_folio.replace('/', '-')}.pdf`);
    const doc = db.prepare('SELECT * FROM documentos_salientes WHERE id=?').get(id);
    await generarOficioPDF(doc, rutaPdf);
    db.prepare('UPDATE documentos_salientes SET ruta_pdf=? WHERE id=?')
      .run(`/pdfs/${numero_folio.replace('/', '-')}.pdf`, id);
  } catch (e) {
    console.error('Error al generar PDF:', e.message);
  }

  req.flash('success', `${tipo === 'oficio' ? 'Oficio' : 'Memorándum'} ${numero_folio} creado correctamente`);
  res.redirect(`/correspondencia/salientes/${id}`);
});

router.get('/salientes/:id', requireAuth, (req, res) => {
  const doc = db.prepare(`
    SELECT ds.*, a.nombre as area_nombre, u.nombre as elaborado_nombre
    FROM documentos_salientes ds
    LEFT JOIN areas a ON ds.area_emisora_id = a.id
    LEFT JOIN usuarios u ON ds.elaborado_por_id = u.id
    WHERE ds.id=?
  `).get(req.params.id);

  if (!doc) { req.flash('error', 'Documento no encontrado'); return res.redirect('/correspondencia/salientes'); }

  res.render('correspondencia/salientes-detalle', {
    titulo: `${doc.tipo === 'oficio' ? 'Oficio' : 'Memorándum'} ${doc.numero_folio}`,
    doc,
  });
});

router.post('/salientes/:id/estatus', requireAuth, (req, res) => {
  const { estatus } = req.body;
  db.prepare('UPDATE documentos_salientes SET estatus=?, actualizado_en=datetime("now","localtime") WHERE id=?')
    .run(estatus, req.params.id);
  req.flash('success', 'Estatus actualizado');
  res.redirect(`/correspondencia/salientes/${req.params.id}`);
});

router.post('/salientes/:id/regenerar-pdf', requireAuth, async (req, res) => {
  const doc = db.prepare('SELECT * FROM documentos_salientes WHERE id=?').get(req.params.id);
  if (!doc) return res.redirect('/correspondencia/salientes');

  const rutaPdf = path.join(__dirname, `../pdfs/${doc.numero_folio.replace('/', '-')}.pdf`);
  await generarOficioPDF(doc, rutaPdf);
  db.prepare('UPDATE documentos_salientes SET ruta_pdf=? WHERE id=?')
    .run(`/pdfs/${doc.numero_folio.replace('/', '-')}.pdf`, doc.id);

  req.flash('success', 'PDF regenerado correctamente');
  res.redirect(`/correspondencia/salientes/${doc.id}`);
});

// ═══════════════════════════════════════════════════════════════
//  CORRESPONDENCIA ENTRANTE
// ═══════════════════════════════════════════════════════════════

router.get('/entrante', requireAuth, (req, res) => {
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

  const total = db.prepare(`SELECT COUNT(*) as c FROM correspondencia_entrante ce WHERE ${where}`).get(...params).c;
  const documentos = db.prepare(`
    SELECT ce.*, a.nombre as area_nombre
    FROM correspondencia_entrante ce
    LEFT JOIN areas a ON ce.area_destinataria_id = a.id
    WHERE ${where}
    ORDER BY ce.fecha_recepcion DESC, ce.creado_en DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.render('correspondencia/entrante-lista', {
    titulo: 'Correspondencia Recibida',
    documentos,
    filtros: { tipo, estatus, buscar },
    paginacion: { page: parseInt(page), total, limit, pages: Math.ceil(total / limit) },
  });
});

router.get('/entrante/nuevo', requireAuth, (req, res) => {
  const areas = db.prepare('SELECT * FROM areas WHERE activa=1 ORDER BY nombre').all();
  const hoy = new Date().toISOString().split('T')[0];
  res.render('correspondencia/entrante-form', {
    titulo: 'Registrar Correspondencia Recibida',
    documento: null,
    areas,
    hoy,
    accion: '/correspondencia/entrante',
  });
});

router.post('/entrante', requireAuth, upload.single('archivo'), (req, res) => {
  const {
    folio_externo, tipo, fecha_recepcion, fecha_documento,
    remitente_nombre, remitente_cargo, remitente_institucion,
    asunto, descripcion, area_destinataria_id,
    requiere_respuesta, fecha_limite_respuesta, notas,
  } = req.body;

  const ruta_archivo = req.file ? `/uploads/${req.file.filename}` : null;

  db.prepare(`
    INSERT INTO correspondencia_entrante
    (folio_externo, tipo, fecha_recepcion, fecha_documento, remitente_nombre, remitente_cargo,
     remitente_institucion, asunto, descripcion, area_destinataria_id, requiere_respuesta,
     fecha_limite_respuesta, ruta_archivo, notas, registrado_por_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    folio_externo || null, tipo, fecha_recepcion, fecha_documento || null,
    remitente_nombre, remitente_cargo || null, remitente_institucion,
    asunto, descripcion || null, area_destinataria_id || null,
    requiere_respuesta === 'on' ? 1 : 0,
    fecha_limite_respuesta || null, ruta_archivo, notas || null,
    req.session.usuario.id
  );

  req.flash('success', 'Correspondencia registrada correctamente');
  res.redirect('/correspondencia/entrante');
});

router.get('/entrante/:id', requireAuth, (req, res) => {
  const doc = db.prepare(`
    SELECT ce.*, a.nombre as area_nombre, u.nombre as registrado_nombre
    FROM correspondencia_entrante ce
    LEFT JOIN areas a ON ce.area_destinataria_id = a.id
    LEFT JOIN usuarios u ON ce.registrado_por_id = u.id
    WHERE ce.id=?
  `).get(req.params.id);

  if (!doc) { req.flash('error', 'Documento no encontrado'); return res.redirect('/correspondencia/entrante'); }

  res.render('correspondencia/entrante-detalle', {
    titulo: `Correspondencia: ${doc.asunto}`,
    doc,
  });
});

router.post('/entrante/:id/estatus', requireAuth, (req, res) => {
  const { estatus, notas } = req.body;
  db.prepare(`
    UPDATE correspondencia_entrante SET estatus=?, notas=?, actualizado_en=datetime('now','localtime') WHERE id=?
  `).run(estatus, notas || null, req.params.id);
  req.flash('success', 'Estatus actualizado');
  res.redirect(`/correspondencia/entrante/${req.params.id}`);
});

module.exports = router;
