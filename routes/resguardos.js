const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const { query } = require('../database/db');
const { requireAuth, requireAdmin } = require('../controllers/authMiddleware');

const CATEGORIAS = {
  mobiliario:        'Mobiliario',
  mobiliario_medico: 'Mobiliario Médico',
  equipo_medico:     'Equipo Médico',
  equipo_computo:    'Equipo de Cómputo',
  instrumental:      'Instrumental Médico',
  vehiculo:          'Vehículo / Ambulancia',
  electromecanico:   'Equipo Electromecánico',
};

const CONDICIONES = {
  bueno:   'Bueno',
  regular: 'Regular',
  malo:    'Malo',
};

const multerFirmado = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../uploads/resguardos');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.pdf').toLowerCase();
      cb(null, `resguardo_${Date.now()}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/'));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

async function siguienteFolio() {
  const anio = new Date().getFullYear();
  const [row] = await query('SELECT MAX(consecutivo) as max FROM resguardos WHERE anio=?', [anio]);
  const siguiente = (row.max || 0) + 1;
  return { consecutivo: siguiente, anio, folio: `RSG-${String(siguiente).padStart(3, '0')}/${anio}` };
}

function fmtFecha(d) {
  if (!d) return '—';
  const s = d instanceof Date ? d.toISOString().split('T')[0] : String(d).split('T')[0];
  const [y, m, day] = s.split('-');
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return `${parseInt(day)} de ${meses[parseInt(m) - 1]} de ${y}`;
}

function requireAccesoInventario(req, res, next) {
  if (!req.session.usuario || !['admin','director','jefe_area'].includes(req.session.usuario.rol)) {
    req.flash('error', 'Sin permisos para esta sección');
    return res.redirect('/dashboard');
  }
  next();
}

// ── Lista ─────────────────────────────────────────────────────────────────
router.get('/', requireAuth, requireAccesoInventario, async (req, res, next) => {
  try {
    const u = req.session.usuario;
    const esJefeArea = u.rol === 'jefe_area';
    const { resguardante, estado } = req.query;

    let where = '1=1';
    const params = [];
    if (esJefeArea) {
      where += ' AND LOWER(r.resguardante) = LOWER(?)';
      params.push(u.nombre);
    } else {
      if (resguardante) { where += ' AND LOWER(r.resguardante) LIKE LOWER(?)'; params.push(`%${resguardante}%`); }
    }
    if (estado) { where += ' AND r.estado=?'; params.push(estado); }

    const resguardos = await query(`
      SELECT r.*, u.nombre as creado_por_nombre, COUNT(rb.id) as total_bienes
      FROM resguardos r
      LEFT JOIN usuarios u ON r.creado_por_id = u.id
      LEFT JOIN resguardo_bienes rb ON rb.resguardo_id = r.id
      WHERE ${where}
      GROUP BY r.id
      ORDER BY r.creado_en DESC
    `, params);

    let resguardantes = [];
    if (!esJefeArea) {
      resguardantes = await query(
        `SELECT DISTINCT resguardante FROM bienes
         WHERE activo=1 AND resguardante IS NOT NULL AND resguardante <> ''
         ORDER BY resguardante`
      );
    }

    res.render('resguardos/lista', {
      titulo: 'Resguardos de Inventario',
      resguardos, resguardantes, esJefeArea,
      filtros: { resguardante: resguardante || '', estado: estado || '' },
    });
  } catch (err) { next(err); }
});

// ── Nuevo (GET) ───────────────────────────────────────────────────────────
router.get('/nuevo', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const resguardantes = await query(
      `SELECT DISTINCT resguardante FROM bienes
       WHERE activo=1 AND resguardante IS NOT NULL AND resguardante <> ''
       ORDER BY resguardante`
    );
    const { resguardante } = req.query;
    let bienes = [];
    if (resguardante) {
      bienes = await query(`
        SELECT b.*, a.nombre as area_nombre
        FROM bienes b LEFT JOIN areas a ON b.area_id = a.id
        WHERE b.activo=1 AND LOWER(b.resguardante) = LOWER(?)
        ORDER BY b.categoria, b.nombre
      `, [resguardante]);
    }
    res.render('resguardos/nuevo', {
      titulo: 'Nuevo Resguardo',
      resguardantes, bienes,
      resguardanteSeleccionado: resguardante || '',
      CATEGORIAS,
    });
  } catch (err) { next(err); }
});

// ── Nuevo (POST) ──────────────────────────────────────────────────────────
router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { resguardante, notas, bienes_ids } = req.body;
    if (!resguardante) {
      req.flash('error', 'El resguardante es requerido');
      return res.redirect('/resguardos/nuevo');
    }
    const ids = Array.isArray(bienes_ids) ? bienes_ids : (bienes_ids ? [bienes_ids] : []);
    if (ids.length === 0) {
      req.flash('error', 'Selecciona al menos un bien');
      return res.redirect(`/resguardos/nuevo?resguardante=${encodeURIComponent(resguardante)}`);
    }

    const { consecutivo, anio, folio } = await siguienteFolio();
    const result = await query(
      'INSERT INTO resguardos (folio, consecutivo, anio, resguardante, notas, creado_por_id) VALUES (?,?,?,?,?,?)',
      [folio, consecutivo, anio, resguardante, notas || null, req.session.usuario.id]
    );
    const resguardoId = result.insertId;

    const bienes = await query(
      `SELECT b.*, a.nombre as area_nombre FROM bienes b
       LEFT JOIN areas a ON b.area_id = a.id
       WHERE b.id IN (${ids.map(() => '?').join(',')}) AND b.activo=1`,
      ids
    );
    for (const b of bienes) {
      await query(
        `INSERT INTO resguardo_bienes
         (resguardo_id, bien_id, numero_inventario, nombre, categoria, area_nombre, marca, modelo, numero_serie, condicion)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [resguardoId, b.id, b.numero_inventario, b.nombre, b.categoria,
         b.area_nombre || null, b.marca || null, b.modelo || null, b.numero_serie || null, b.condicion]
      );
    }

    req.flash('success', `Resguardo ${folio} creado`);
    res.redirect(`/resguardos/${resguardoId}`);
  } catch (err) { next(err); }
});

// ── Detalle ───────────────────────────────────────────────────────────────
router.get('/:id', requireAuth, requireAccesoInventario, async (req, res, next) => {
  try {
    const u = req.session.usuario;
    const [resguardo] = await query(
      `SELECT r.*, u.nombre as creado_por_nombre
       FROM resguardos r LEFT JOIN usuarios u ON r.creado_por_id = u.id
       WHERE r.id=?`, [req.params.id]
    );
    if (!resguardo) { req.flash('error', 'Resguardo no encontrado'); return res.redirect('/resguardos'); }
    if (u.rol === 'jefe_area' && resguardo.resguardante.toLowerCase() !== u.nombre.toLowerCase()) {
      req.flash('error', 'Sin acceso a este resguardo');
      return res.redirect('/resguardos');
    }

    const bienes = await query(
      'SELECT * FROM resguardo_bienes WHERE resguardo_id=? ORDER BY categoria, nombre',
      [req.params.id]
    );

    res.render('resguardos/detalle', {
      titulo: `Resguardo ${resguardo.folio}`,
      resguardo, bienes, CATEGORIAS, CONDICIONES,
      canEdit: ['admin','director'].includes(u.rol),
    });
  } catch (err) { next(err); }
});

// ── Marcar como firmado + subir archivo ───────────────────────────────────
router.post('/:id/firmar', requireAuth, requireAdmin, multerFirmado.single('archivo_firmado'), async (req, res, next) => {
  try {
    const [r] = await query('SELECT * FROM resguardos WHERE id=?', [req.params.id]);
    if (!r) { req.flash('error', 'No encontrado'); return res.redirect('/resguardos'); }

    if (r.archivo_firmado && req.file) {
      const oldPath = path.join(__dirname, '../uploads/resguardos', r.archivo_firmado);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const filename = req.file ? req.file.filename : r.archivo_firmado;
    await query(
      'UPDATE resguardos SET estado="firmado", archivo_firmado=?, firmado_en=NOW() WHERE id=?',
      [filename, req.params.id]
    );

    req.flash('success', 'Resguardo marcado como firmado');
    res.redirect(`/resguardos/${req.params.id}`);
  } catch (err) { next(err); }
});

// ── PDF ───────────────────────────────────────────────────────────────────
router.get('/:id/pdf', requireAuth, requireAccesoInventario, async (req, res, next) => {
  try {
    const u = req.session.usuario;
    const [resguardo] = await query('SELECT * FROM resguardos WHERE id=?', [req.params.id]);
    if (!resguardo) return res.status(404).send('No encontrado');
    if (u.rol === 'jefe_area' && resguardo.resguardante.toLowerCase() !== u.nombre.toLowerCase()) {
      return res.status(403).send('Sin acceso');
    }

    const bienes = await query(
      'SELECT * FROM resguardo_bienes WHERE resguardo_id=? ORDER BY categoria, nombre',
      [req.params.id]
    );

    const membretePath = path.join(__dirname, '../public/img/membrete.png');
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 60, bottom: 40, left: 50, right: 50 } });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="resguardo-${resguardo.folio.replace(/\//g, '-')}.pdf"`);
    doc.pipe(res);

    generarPDF(doc, resguardo, bienes, membretePath);
    doc.end();
  } catch (err) { next(err); }
});

function generarPDF(doc, resguardo, bienes, membretePath) {
  const margin = 50;
  const contentWidth = 512; // 612 - 50*2

  // Membrete
  if (fs.existsSync(membretePath)) {
    doc.image(membretePath, 0, 0, { width: 612, height: 792 });
    doc.y = 115;
  }

  // Folio y fecha
  doc.fontSize(9).font('Helvetica-Bold')
    .text(`Folio: ${resguardo.folio}`, margin, doc.y, { align: 'right', width: contentWidth });
  doc.font('Helvetica')
    .text(`Berriozábal, Chiapas, ${fmtFecha(resguardo.creado_en)}`, { align: 'right', width: contentWidth });
  doc.moveDown(0.8);

  // Título
  doc.fontSize(13).font('Helvetica-Bold')
    .text('RESGUARDO DE INVENTARIO', { align: 'center', width: contentWidth });
  doc.moveDown(0.8);

  // Cuerpo introductorio
  doc.fontSize(10).font('Helvetica')
    .text('Por medio del presente documento se hace constar que el (la) ciudadano(a):', { width: contentWidth });
  doc.moveDown(0.4);
  doc.fontSize(11).font('Helvetica-Bold')
    .text(resguardo.resguardante.toUpperCase(), { align: 'center', width: contentWidth });
  doc.moveDown(0.4);
  doc.fontSize(10).font('Helvetica').text(
    'recibe bajo su resguardo y responsabilidad los bienes inventariados que se describen a continuación, ' +
    'comprometiéndose a su correcto uso, conservación y custodia.',
    { width: contentWidth, align: 'justify' }
  );
  doc.moveDown(1);

  // ── Tabla de bienes ────────────────────────────────────────────────────
  const cols = [65, 120, 75, 65, 60, 72, 55];
  const headers = ['N° Inventario', 'Nombre del bien', 'Categoría', 'Área', 'Marca / Modelo', 'N° Serie', 'Condición'];
  const rowH = 18;
  let x = margin;
  let y = doc.y;

  // Cabecera
  doc.rect(x, y, contentWidth, rowH).fill('#1a7a4a');
  doc.fillColor('white').fontSize(7).font('Helvetica-Bold');
  let cx = x;
  headers.forEach((h, i) => {
    doc.text(h, cx + 3, y + 5, { width: cols[i] - 6, lineBreak: false });
    cx += cols[i];
  });
  doc.fillColor('black');
  y += rowH;

  // Filas
  bienes.forEach((b, idx) => {
    if (y > 680) {
      doc.addPage();
      y = 60;
    }
    const marcaModelo = [b.marca, b.modelo].filter(Boolean).join(' / ');
    const cells = [
      b.numero_inventario,
      b.nombre,
      CATEGORIAS[b.categoria] || b.categoria,
      b.area_nombre || '—',
      marcaModelo || '—',
      b.numero_serie || '—',
      CONDICIONES[b.condicion] || b.condicion,
    ];

    if (idx % 2 === 1) doc.rect(x, y, contentWidth, rowH).fill('#f3f4f6');
    doc.rect(x, y, contentWidth, rowH).stroke('#e5e7eb');
    doc.fillColor('black').fontSize(7).font('Helvetica');
    cx = x;
    cells.forEach((cell, i) => {
      doc.text(String(cell), cx + 3, y + 5, { width: cols[i] - 6, lineBreak: false, ellipsis: true });
      cx += cols[i];
    });
    y += rowH;
  });

  doc.y = y + 10;

  // Notas
  if (resguardo.notas) {
    doc.moveDown(0.4);
    doc.fontSize(9).font('Helvetica-Bold').text('Observaciones:', { width: contentWidth });
    doc.font('Helvetica').fontSize(9).text(resguardo.notas, { width: contentWidth });
  }

  // ── Firmas ─────────────────────────────────────────────────────────────
  if (doc.y > 610) doc.addPage();
  doc.moveDown(1.5);
  doc.fontSize(9).font('Helvetica')
    .text('Las partes que suscriben dan conformidad con el presente resguardo.', { align: 'center', width: contentWidth });
  doc.moveDown(3);

  const sigY = doc.y;
  const sigW = 140;
  const gap = (contentWidth - sigW * 3) / 2;

  function firma(label, cargo, xPos) {
    doc.moveTo(xPos, sigY).lineTo(xPos + sigW, sigY).strokeColor('#333').stroke();
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#111')
      .text(label, xPos, sigY + 5, { width: sigW, align: 'center' });
    doc.fontSize(7).font('Helvetica').fillColor('#666')
      .text(cargo, xPos, sigY + 15, { width: sigW, align: 'center' });
    doc.fillColor('black');
  }

  firma(resguardo.resguardante.toUpperCase(), 'Resguardante', margin);
  firma('DIRECTORA', 'Directora del Hospital', margin + sigW + gap);
  firma('ADMINISTRADORA', 'Administradora', margin + (sigW + gap) * 2);

  // Pie
  doc.y = sigY + 35;
  doc.fontSize(7).fillColor('#aaa').font('Helvetica')
    .text(`Generado por AGORA · Sistema de Gestión Administrativa · ${resguardo.folio}`, { align: 'center', width: contentWidth });
}

module.exports = router;
