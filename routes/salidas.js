const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const { query } = require('../database/db');
const { requireAuth, requireAdmin } = require('../controllers/authMiddleware');

// ── Constantes ────────────────────────────────────────────────────────────
const TIPOS = {
  mantenimiento: 'Mantenimiento externo',
  prestamo:      'Préstamo a unidad médica',
  donacion:      'Donación',
  baja:          'Baja definitiva',
};

const TIPOS_RETORNABLE = ['mantenimiento', 'prestamo'];

const ESTADO_BIEN_POR_TIPO = {
  mantenimiento: 'en_mantenimiento',
  prestamo:      'en_traslado',
  donacion:      'dado_de_baja',
  baja:          'dado_de_baja',
};

const CATEGORIAS = {
  mobiliario:        'Mobiliario',
  mobiliario_medico: 'Mobiliario Médico',
  equipo_medico:     'Equipo Médico',
  equipo_computo:    'Equipo de Cómputo',
  instrumental:      'Instrumental Médico',
  vehiculo:          'Vehículo / Ambulancia',
  electromecanico:   'Equipo Electromecánico',
};

const CONDICIONES = { bueno: 'Bueno', regular: 'Regular', malo: 'Malo' };

// ── Multer para archivo firmado ───────────────────────────────────────────
const multerFirmado = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../uploads/salidas');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.pdf').toLowerCase();
      cb(null, `salida_${Date.now()}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/'));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ── Helpers ───────────────────────────────────────────────────────────────
async function siguienteFolio() {
  const anio = new Date().getFullYear();
  const [row] = await query('SELECT MAX(consecutivo) as max FROM salidas WHERE anio=?', [anio]);
  const siguiente = (row.max || 0) + 1;
  return { consecutivo: siguiente, anio, folio: `SAL-${String(siguiente).padStart(3, '0')}/${anio}` };
}

function fmtFecha(d) {
  if (!d) return '—';
  const s = d instanceof Date ? d.toISOString().split('T')[0] : String(d).split('T')[0];
  const [y, m, day] = s.split('-');
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return `${parseInt(day)} de ${meses[parseInt(m) - 1]} de ${y}`;
}

function isoDate(d) {
  if (!d) return '';
  const s = d instanceof Date ? d.toISOString() : String(d);
  return s.split('T')[0];
}

function requireAcceso(req, res, next) {
  if (!req.session.usuario || !['admin','director','jefe_area'].includes(req.session.usuario.rol)) {
    req.flash('error', 'Sin permisos');
    return res.redirect('/dashboard');
  }
  next();
}

// ── Lista ─────────────────────────────────────────────────────────────────
router.get('/', requireAuth, requireAcceso, async (req, res, next) => {
  try {
    const u = req.session.usuario;
    const esJefeArea = u.rol === 'jefe_area';
    const { tipo, estado, buscar } = req.query;

    let where = '1=1';
    const params = [];

    if (esJefeArea) {
      // Solo salidas que contienen bienes del jefe_area
      where += ` AND s.id IN (
        SELECT DISTINCT sb.salida_id FROM salida_bienes sb
        JOIN bienes b ON sb.bien_id = b.id
        WHERE LOWER(b.resguardante) = LOWER(?)
      )`;
      params.push(u.nombre);
    }
    if (tipo)   { where += ' AND s.tipo=?';   params.push(tipo); }
    if (estado) { where += ' AND s.estado=?'; params.push(estado); }
    if (buscar) {
      where += ' AND (s.folio LIKE ? OR s.destino_nombre LIKE ?)';
      params.push(`%${buscar}%`, `%${buscar}%`);
    }

    const salidas = await query(`
      SELECT s.*, u.nombre as creado_por_nombre, COUNT(sb.id) as total_bienes
      FROM salidas s
      LEFT JOIN usuarios u ON s.creado_por_id = u.id
      LEFT JOIN salida_bienes sb ON sb.salida_id = s.id
      WHERE ${where}
      GROUP BY s.id
      ORDER BY s.creado_en DESC
    `, params);

    res.render('salidas/lista', {
      titulo: 'Salidas de Bienes',
      salidas, esJefeArea, TIPOS,
      filtros: { tipo: tipo||'', estado: estado||'', buscar: buscar||'' },
    });
  } catch (err) { next(err); }
});

// ── Nueva (GET) ───────────────────────────────────────────────────────────
router.get('/nueva', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const bienes = await query(`
      SELECT b.*, a.nombre as area_nombre
      FROM bienes b LEFT JOIN areas a ON b.area_id = a.id
      WHERE b.activo=1 AND b.estado IN ('activo','en_mantenimiento','en_traslado')
      ORDER BY b.area_id, b.categoria, b.nombre
    `);
    const areas = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');
    res.render('salidas/nueva', {
      titulo: 'Nueva Salida de Bienes',
      bienes, areas, TIPOS, CATEGORIAS, CONDICIONES,
    });
  } catch (err) { next(err); }
});

// ── Nueva (POST) ──────────────────────────────────────────────────────────
router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const {
      tipo, destino_nombre, destino_responsable, destino_cargo,
      fecha_salida, fecha_retorno_estimada, motivo, observaciones,
      autorizante_nombre, autorizante_cargo, bienes_ids,
    } = req.body;

    if (!tipo || !destino_nombre || !fecha_salida) {
      req.flash('error', 'Tipo, destino y fecha son requeridos');
      return res.redirect('/salidas/nueva');
    }
    const ids = Array.isArray(bienes_ids) ? bienes_ids : (bienes_ids ? [bienes_ids] : []);
    if (ids.length === 0) {
      req.flash('error', 'Selecciona al menos un bien');
      return res.redirect('/salidas/nueva');
    }

    const { consecutivo, anio, folio } = await siguienteFolio();
    const result = await query(
      `INSERT INTO salidas
       (folio, consecutivo, anio, tipo, destino_nombre, destino_responsable, destino_cargo,
        fecha_salida, fecha_retorno_estimada, motivo, observaciones,
        autorizante_nombre, autorizante_cargo, creado_por_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [folio, consecutivo, anio, tipo,
       destino_nombre, destino_responsable || null, destino_cargo || null,
       fecha_salida,
       TIPOS_RETORNABLE.includes(tipo) && fecha_retorno_estimada ? fecha_retorno_estimada : null,
       motivo || null, observaciones || null,
       autorizante_nombre || null, autorizante_cargo || null,
       req.session.usuario.id]
    );
    const salidaId = result.insertId;

    // Snapshot bienes + actualizar estado
    const bienes = await query(
      `SELECT b.*, a.nombre as area_nombre FROM bienes b
       LEFT JOIN areas a ON b.area_id = a.id
       WHERE b.id IN (${ids.map(() => '?').join(',')}) AND b.activo=1`,
      ids
    );
    const nuevoEstado = ESTADO_BIEN_POR_TIPO[tipo];
    for (const b of bienes) {
      await query(
        `INSERT INTO salida_bienes
         (salida_id, bien_id, numero_inventario, nombre, categoria, area_nombre,
          marca, modelo, numero_serie, condicion_salida)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [salidaId, b.id, b.numero_inventario, b.nombre, b.categoria,
         b.area_nombre || null, b.marca || null, b.modelo || null,
         b.numero_serie || null, b.condicion]
      );
      await query('UPDATE bienes SET estado=? WHERE id=?', [nuevoEstado, b.id]);
    }

    req.flash('success', `Salida ${folio} registrada`);
    res.redirect(`/salidas/${salidaId}`);
  } catch (err) { next(err); }
});

// ── Detalle ───────────────────────────────────────────────────────────────
router.get('/:id', requireAuth, requireAcceso, async (req, res, next) => {
  try {
    const u = req.session.usuario;
    const [salida] = await query(
      `SELECT s.*, u.nombre as creado_por_nombre
       FROM salidas s LEFT JOIN usuarios u ON s.creado_por_id = u.id
       WHERE s.id=?`, [req.params.id]
    );
    if (!salida) { req.flash('error', 'No encontrada'); return res.redirect('/salidas'); }

    const bienes = await query(
      'SELECT * FROM salida_bienes WHERE salida_id=? ORDER BY categoria, nombre',
      [req.params.id]
    );

    // jefe_area: solo si tiene bienes suyos en la salida
    if (u.rol === 'jefe_area') {
      const bienesIds = bienes.map(b => b.bien_id);
      if (bienesIds.length === 0) { req.flash('error', 'Sin acceso'); return res.redirect('/salidas'); }
      const propios = await query(
        `SELECT id FROM bienes WHERE id IN (${bienesIds.map(() => '?').join(',')}) AND LOWER(resguardante)=LOWER(?)`,
        [...bienesIds, u.nombre]
      );
      if (propios.length === 0) { req.flash('error', 'Sin acceso'); return res.redirect('/salidas'); }
    }

    res.render('salidas/detalle', {
      titulo: `Salida ${salida.folio}`,
      salida, bienes, TIPOS, CATEGORIAS, CONDICIONES,
      canEdit: ['admin','director'].includes(u.rol),
      esRetornable: TIPOS_RETORNABLE.includes(salida.tipo),
    });
  } catch (err) { next(err); }
});

// ── Subir firmado ─────────────────────────────────────────────────────────
router.post('/:id/firmar', requireAuth, requireAdmin, multerFirmado.single('archivo_firmado'), async (req, res, next) => {
  try {
    const [s] = await query('SELECT * FROM salidas WHERE id=?', [req.params.id]);
    if (!s) { req.flash('error', 'No encontrada'); return res.redirect('/salidas'); }
    if (s.archivo_firmado && req.file) {
      const old = path.join(__dirname, '../uploads/salidas', s.archivo_firmado);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }
    await query('UPDATE salidas SET archivo_firmado=? WHERE id=?',
      [req.file ? req.file.filename : s.archivo_firmado, req.params.id]);
    req.flash('success', 'Documento firmado adjuntado');
    res.redirect(`/salidas/${req.params.id}`);
  } catch (err) { next(err); }
});

// ── Retorno (GET) ─────────────────────────────────────────────────────────
router.get('/:id/retorno', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [salida] = await query('SELECT * FROM salidas WHERE id=?', [req.params.id]);
    if (!salida || !TIPOS_RETORNABLE.includes(salida.tipo) || salida.estado === 'cerrada') {
      req.flash('error', 'Esta salida no admite retorno');
      return res.redirect(`/salidas/${req.params.id}`);
    }
    const bienes = await query(
      'SELECT * FROM salida_bienes WHERE salida_id=? ORDER BY nombre', [req.params.id]
    );
    res.render('salidas/retorno', {
      titulo: `Retorno — ${salida.folio}`,
      salida, bienes, CONDICIONES, TIPOS,
    });
  } catch (err) { next(err); }
});

// ── Retorno (POST) ────────────────────────────────────────────────────────
router.post('/:id/retorno', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [salida] = await query('SELECT * FROM salidas WHERE id=?', [req.params.id]);
    if (!salida || salida.estado === 'cerrada') {
      req.flash('error', 'Salida no válida para retorno');
      return res.redirect('/salidas');
    }

    const { fecha_retorno_real, obs_general } = req.body;
    const condiciones   = req.body.condicion_retorno   || {};
    const observaciones = req.body.obs_retorno          || {};

    const bienes = await query('SELECT * FROM salida_bienes WHERE salida_id=?', [req.params.id]);

    for (const b of bienes) {
      const cond = condiciones[b.id] || 'bueno';
      const obs  = observaciones[b.id] || null;
      await query(
        'UPDATE salida_bienes SET condicion_retorno=?, observaciones_retorno=? WHERE id=?',
        [cond, obs, b.id]
      );
      await query("UPDATE bienes SET estado='activo', condicion=? WHERE id=?", [cond, b.bien_id]);
    }

    await query(
      "UPDATE salidas SET estado='cerrada', fecha_retorno_real=?, observaciones=CONCAT(IFNULL(observaciones,''),' | Retorno: ',?) WHERE id=?",
      [fecha_retorno_real || null, obs_general || '', req.params.id]
    );

    req.flash('success', 'Retorno registrado. Los bienes vuelven al inventario activo.');
    res.redirect(`/salidas/${req.params.id}`);
  } catch (err) { next(err); }
});

// ── PDF ───────────────────────────────────────────────────────────────────
router.get('/:id/pdf', requireAuth, requireAcceso, async (req, res, next) => {
  try {
    const u = req.session.usuario;
    const [salida] = await query('SELECT * FROM salidas WHERE id=?', [req.params.id]);
    if (!salida) return res.status(404).send('No encontrada');

    const bienes = await query(
      'SELECT * FROM salida_bienes WHERE salida_id=? ORDER BY categoria, nombre',
      [req.params.id]
    );

    const membretePath = path.join(__dirname, '../public/img/membrete.png');
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 60, bottom: 40, left: 50, right: 50 } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `inline; filename="salida-${salida.folio.replace(/\//g, '-')}.pdf"`);
    doc.pipe(res);
    generarPDF(doc, salida, bienes, membretePath);
    doc.end();
  } catch (err) { next(err); }
});

// ── Generación PDF ────────────────────────────────────────────────────────
function generarPDF(doc, salida, bienes, membretePath) {
  const margin = 50;
  const cw = 512; // content width

  if (fs.existsSync(membretePath)) {
    doc.image(membretePath, 0, 0, { width: 612, height: 792 });
    doc.y = 115;
  }

  // Folio y fecha
  doc.fontSize(9).font('Helvetica-Bold')
    .text(`Folio: ${salida.folio}`, margin, doc.y, { align: 'right', width: cw });
  doc.font('Helvetica')
    .text(`Berriozábal, Chiapas, ${fmtFecha(salida.fecha_salida)}`, { align: 'right', width: cw });
  doc.moveDown(0.8);

  // Título según tipo
  const titulos = {
    mantenimiento: 'COMPROBANTE DE SALIDA PARA MANTENIMIENTO',
    prestamo:      'ACTA DE PRÉSTAMO TEMPORAL DE BIENES',
    donacion:      'ACTA DE DONACIÓN DE BIENES',
    baja:          'ACTA DE BAJA DEFINITIVA DE BIENES',
  };
  doc.fontSize(13).font('Helvetica-Bold')
    .text(titulos[salida.tipo], { align: 'center', width: cw });
  doc.moveDown(0.8);

  // Cuerpo introductorio según tipo
  const cuerpos = {
    mantenimiento:
      `Por medio del presente documento se hace constar la salida temporal de los bienes que se enlistan a continuación, ` +
      `los cuales son remitidos a la empresa "${salida.destino_nombre}" para servicio de mantenimiento externo. ` +
      `El responsable de recepción es: ${salida.destino_responsable || '_______________'}` +
      (salida.destino_cargo ? `, ${salida.destino_cargo}` : '') + `. ` +
      (salida.fecha_retorno_estimada ? `Fecha estimada de retorno: ${fmtFecha(salida.fecha_retorno_estimada)}.` : ''),
    prestamo:
      `Por medio del presente documento se formaliza el préstamo temporal de los bienes que se enlistan a continuación, ` +
      `a favor de la unidad médica "${salida.destino_nombre}". ` +
      `Responsable receptor: ${salida.destino_responsable || '_______________'}` +
      (salida.destino_cargo ? `, ${salida.destino_cargo}` : '') + `. ` +
      (salida.fecha_retorno_estimada ? `Fecha comprometida de devolución: ${fmtFecha(salida.fecha_retorno_estimada)}.` : ''),
    donacion:
      `Por medio del presente documento se formaliza la donación definitiva de los bienes que se enlistan a continuación, ` +
      `a favor de "${salida.destino_nombre}". ` +
      `Responsable receptor: ${salida.destino_responsable || '_______________'}` +
      (salida.destino_cargo ? `, ${salida.destino_cargo}` : '') + `. ` +
      `Los bienes donados quedan fuera del inventario activo del H.B.C. 12 Camas Berriozábal.`,
    baja:
      `Por medio del presente documento se registra la baja definitiva de los bienes que se enlistan a continuación, ` +
      `mismos que han sido retirados del inventario activo del H.B.C. 12 Camas Berriozábal por las causas indicadas. ` +
      `A partir de la fecha, dichos bienes no forman parte del patrimonio institucional.`,
  };

  doc.fontSize(10).font('Helvetica')
    .text(cuerpos[salida.tipo], { width: cw, align: 'justify' });

  if (salida.motivo) {
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text('Motivo: ', { continued: true })
       .font('Helvetica').text(salida.motivo);
  }
  doc.moveDown(0.8);

  // ── Tabla ────────────────────────────────────────────────────────────────
  const cols = [65, 120, 80, 65, 65, 62, 55];
  const headers = ['N° Inventario', 'Nombre del bien', 'Categoría', 'Área', 'Marca / Modelo', 'N° Serie', 'Condición'];
  const rowH = 18;
  let x = margin;
  let y = doc.y;

  doc.rect(x, y, cw, rowH).fill('#1a7a4a');
  doc.fillColor('white').fontSize(7).font('Helvetica-Bold');
  let cx = x;
  headers.forEach((h, i) => {
    doc.text(h, cx + 3, y + 5, { width: cols[i] - 6, lineBreak: false });
    cx += cols[i];
  });
  doc.fillColor('black');
  y += rowH;

  bienes.forEach((b, idx) => {
    if (y > 670) { doc.addPage(); y = 60; }
    const marcaModelo = [b.marca, b.modelo].filter(Boolean).join(' / ');
    const cells = [
      b.numero_inventario,
      b.nombre,
      CATEGORIAS[b.categoria] || b.categoria,
      b.area_nombre || '—',
      marcaModelo || '—',
      b.numero_serie || '—',
      CONDICIONES[b.condicion_salida] || b.condicion_salida,
    ];
    if (idx % 2 === 1) doc.rect(x, y, cw, rowH).fill('#f3f4f6');
    doc.rect(x, y, cw, rowH).stroke('#e5e7eb');
    doc.fillColor('black').fontSize(7).font('Helvetica');
    cx = x;
    cells.forEach((cell, i) => {
      doc.text(String(cell), cx + 3, y + 5, { width: cols[i] - 6, lineBreak: false, ellipsis: true });
      cx += cols[i];
    });
    y += rowH;
  });

  doc.y = y + 10;

  if (salida.observaciones) {
    doc.moveDown(0.4);
    doc.fontSize(9).font('Helvetica-Bold').text('Observaciones: ', { continued: true })
       .font('Helvetica').text(salida.observaciones, { width: cw });
  }

  // ── Firmas ───────────────────────────────────────────────────────────────
  if (doc.y > 590) doc.addPage();
  doc.moveDown(1.5);
  doc.fontSize(9).font('Helvetica')
    .text('Las partes que suscriben dan conformidad con el presente documento.', { align: 'center', width: cw });
  doc.moveDown(3);

  const firmasDef = {
    mantenimiento: [
      { label: salida.autorizante_nombre || 'JEFE DE SERVICIOS GENERALES', cargo: salida.autorizante_cargo || 'Jefe de Servicios Generales' },
      { label: 'DIRECTORA', cargo: 'Directora del Hospital' },
      { label: (salida.destino_responsable || 'RESPONSABLE RECEPTOR').toUpperCase(), cargo: salida.destino_cargo || `${salida.destino_nombre}` },
    ],
    prestamo: [
      { label: 'DIRECTORA', cargo: 'Directora del Hospital' },
      { label: 'ADMINISTRADORA', cargo: 'Administradora' },
      { label: (salida.destino_responsable || 'RESPONSABLE RECEPTOR').toUpperCase(), cargo: salida.destino_cargo || `${salida.destino_nombre}` },
    ],
    donacion: [
      { label: 'DIRECTORA', cargo: 'Directora del Hospital' },
      { label: 'ADMINISTRADORA', cargo: 'Administradora' },
      { label: (salida.destino_responsable || 'REPRESENTANTE RECEPTOR').toUpperCase(), cargo: salida.destino_cargo || `${salida.destino_nombre}` },
    ],
    baja: [
      { label: salida.autorizante_nombre || 'JEFE DE SERVICIOS GENERALES', cargo: salida.autorizante_cargo || 'Jefe de Servicios Generales' },
      { label: 'DIRECTORA', cargo: 'Directora del Hospital' },
      { label: 'ADMINISTRADORA', cargo: 'Administradora' },
    ],
  };

  const firmas = firmasDef[salida.tipo];
  const sigW = 140;
  const gap = (cw - sigW * 3) / 2;
  const sigY = doc.y;

  firmas.forEach((f, i) => {
    const xPos = margin + i * (sigW + gap);
    doc.moveTo(xPos, sigY).lineTo(xPos + sigW, sigY).strokeColor('#333').stroke();
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#111')
      .text(f.label, xPos, sigY + 5, { width: sigW, align: 'center' });
    doc.fontSize(7).font('Helvetica').fillColor('#666')
      .text(f.cargo, xPos, sigY + 16, { width: sigW, align: 'center' });
  });
  doc.fillColor('black');
  doc.y = sigY + 35;
  doc.fontSize(7).fillColor('#aaa').font('Helvetica')
    .text(`Generado por AGORA · Sistema de Gestión Administrativa · ${salida.folio}`, { align: 'center', width: cw });
}

module.exports = router;
