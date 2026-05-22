const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const TIPOS = { compra: 'Compra', donacion: 'Donación', transferencia: 'Transferencia', otro: 'Otro' };
const CONDICIONES = { bueno: 'Bueno', regular: 'Regular', malo: 'Malo' };
const CATEGORIAS = {
  equipo_medico: 'Equipo Médico', equipo_computo: 'Equipo de Cómputo',
  mobiliario: 'Mobiliario', mobiliario_medico: 'Mobiliario Médico',
  vehiculo: 'Vehículo', herramienta: 'Herramienta', otro: 'Otro'
};
const LABEL_ORIGEN = { compra: 'Proveedor', donacion: 'Donante', transferencia: 'Unidad de origen', otro: 'Origen' };

function requireLogin(req, res, next) {
  if (!req.session.usuario) return res.redirect('/login');
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.usuario) return res.redirect('/login');
  if (req.session.usuario.rol !== 'admin') {
    req.flash('error', 'Acción restringida a administradores');
    return res.redirect('/entradas');
  }
  next();
}
function requireAdminODirector(req, res, next) {
  if (!req.session.usuario) return res.redirect('/login');
  if (!['admin', 'director'].includes(req.session.usuario.rol)) {
    req.flash('error', 'No tienes acceso a esta sección');
    return res.redirect('/dashboard');
  }
  next();
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/entradas');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const prefix = req.params.id ? `entrada-${req.params.id}` : `entrada-soporte`;
    cb(null, `${prefix}-${Date.now()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

async function generarFolio() {
  const year = new Date().getFullYear();
  const rows = await query(
    `SELECT folio FROM entradas WHERE folio LIKE ? ORDER BY id DESC LIMIT 1`,
    [`ENT-%/${year}`]
  );
  let num = 1;
  if (rows.length) {
    const m = rows[0].folio.match(/ENT-(\d+)\//);
    if (m) num = parseInt(m[1]) + 1;
  }
  return `ENT-${String(num).padStart(3, '0')}/${year}`;
}

// ── GET / ────────────────────────────────────────────────────────
router.get('/', requireAdminODirector, async (req, res) => {
  const entradas = await query(`
    SELECT e.*, u.nombre AS creado_por_nombre,
           COUNT(eb.id) AS total_bienes
    FROM entradas e
    LEFT JOIN usuarios u ON u.id = e.creado_por
    LEFT JOIN entrada_bienes eb ON eb.entrada_id = e.id
    GROUP BY e.id
    ORDER BY e.creado_en DESC
  `);
  res.render('entradas/lista', { titulo: 'Entradas de Bienes', entradas, TIPOS });
});

// ── GET /nueva ───────────────────────────────────────────────────
router.get('/nueva', requireAdmin, async (req, res) => {
  const areas = await query(`SELECT id, nombre FROM areas WHERE activa=1 ORDER BY nombre`);
  res.render('entradas/nueva', { titulo: 'Nueva Entrada de Bienes', areas, TIPOS, CATEGORIAS, LABEL_ORIGEN });
});

// ── POST / ───────────────────────────────────────────────────────
router.post('/', requireAdmin, upload.single('archivo_soporte'), async (req, res) => {
  const {
    tipo, fecha_entrada, numero_documento, fecha_documento,
    proveedor_donante, responsable_entrega, cargo_entrega,
    responsable_recepcion, cargo_recepcion, observaciones, bienes
  } = req.body;

  if (!tipo || !fecha_entrada) {
    req.flash('error', 'Tipo y fecha son requeridos');
    return res.redirect('/entradas/nueva');
  }

  const bienesArr = bienes ? Object.values(bienes).filter(b => b.nombre && b.numero_inventario) : [];
  if (!bienesArr.length) {
    req.flash('error', 'Agrega al menos un bien con nombre y número de inventario');
    return res.redirect('/entradas/nueva');
  }

  try {
    const folio = await generarFolio();
    const u = req.session.usuario;

    const result = await query(
      `INSERT INTO entradas (folio, tipo, fecha_entrada, numero_documento, fecha_documento,
         proveedor_donante, responsable_entrega, cargo_entrega,
         responsable_recepcion, cargo_recepcion, observaciones, archivo_soporte, creado_por)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [folio, tipo, fecha_entrada, numero_documento || null, fecha_documento || null,
       proveedor_donante || null, responsable_entrega || null, cargo_entrega || null,
       responsable_recepcion || null, cargo_recepcion || null, observaciones || null,
       req.file ? req.file.filename : null, u.id]
    );
    const entradaId = result.insertId;

    for (const b of bienesArr) {
      const bResult = await query(
        `INSERT INTO bienes (nombre, categoria, marca, modelo, numero_inventario, numero_serie,
           area_id, resguardante, condicion, estado, creado_por)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [b.nombre.toUpperCase(), b.categoria || 'otro',
         b.marca ? b.marca.toUpperCase() : null,
         b.modelo ? b.modelo.toUpperCase() : null,
         b.numero_inventario.toUpperCase(),
         b.numero_serie ? b.numero_serie.toUpperCase() : null,
         b.area_id || null,
         b.resguardante ? b.resguardante.toUpperCase() : null,
         b.condicion || 'bueno', 'activo', u.id]
      );
      await query(
        `INSERT INTO entrada_bienes (entrada_id, bien_id, condicion_entrada, observaciones)
         VALUES (?,?,?,?)`,
        [entradaId, bResult.insertId, b.condicion || 'bueno',
         b.observaciones ? b.observaciones.toUpperCase() : null]
      );
    }

    req.flash('success', `Entrada ${folio} registrada — ${bienesArr.length} bien(es) ingresados al inventario`);
    res.redirect(`/entradas/${entradaId}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Error al registrar: ' + err.message);
    res.redirect('/entradas/nueva');
  }
});

// ── GET /:id ─────────────────────────────────────────────────────
router.get('/:id', requireAdminODirector, async (req, res) => {
  const rows = await query(`
    SELECT e.*, u.nombre AS creado_por_nombre
    FROM entradas e LEFT JOIN usuarios u ON u.id = e.creado_por
    WHERE e.id = ?
  `, [req.params.id]);
  if (!rows.length) return res.status(404).send('Entrada no encontrada');
  const entrada = rows[0];

  const bienes = await query(`
    SELECT eb.*, b.nombre, b.marca, b.modelo, b.numero_inventario, b.numero_serie,
           b.categoria, b.id AS bien_id, b.resguardante, a.nombre AS area_nombre
    FROM entrada_bienes eb
    JOIN bienes b ON b.id = eb.bien_id
    LEFT JOIN areas a ON a.id = b.area_id
    WHERE eb.entrada_id = ?
    ORDER BY b.numero_inventario
  `, [req.params.id]);

  res.render('entradas/detalle', {
    titulo: `Entrada ${entrada.folio}`,
    entrada, bienes, TIPOS, CONDICIONES, CATEGORIAS, LABEL_ORIGEN,
    canEdit: req.session.usuario.rol === 'admin'
  });
});

// ── GET /:id/pdf ─────────────────────────────────────────────────
router.get('/:id/pdf', requireAdminODirector, async (req, res) => {
  const rows = await query(`
    SELECT e.*, u.nombre AS creado_por_nombre
    FROM entradas e LEFT JOIN usuarios u ON u.id = e.creado_por
    WHERE e.id = ?
  `, [req.params.id]);
  if (!rows.length) return res.status(404).send('No encontrada');
  const entrada = rows[0];

  const bienes = await query(`
    SELECT eb.*, b.nombre, b.marca, b.modelo, b.numero_inventario, b.numero_serie,
           b.categoria, b.resguardante, a.nombre AS area_nombre
    FROM entrada_bienes eb
    JOIN bienes b ON b.id = eb.bien_id
    LEFT JOIN areas a ON a.id = b.area_id
    WHERE eb.entrada_id = ?
    ORDER BY b.numero_inventario
  `, [req.params.id]);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `inline; filename="entrada-${entrada.folio.replace('/', '-')}.pdf"`);
  generarPDF(entrada, bienes, res);
});

// ── POST /:id/firmar ─────────────────────────────────────────────
router.post('/:id/firmar', requireAdmin, upload.single('archivo_firmado'), async (req, res) => {
  if (!req.file) { req.flash('error', 'No se recibió archivo'); return res.redirect(`/entradas/${req.params.id}`); }
  await query(`UPDATE entradas SET archivo_firmado=? WHERE id=?`, [req.file.filename, req.params.id]);
  req.flash('success', 'Documento firmado adjuntado');
  res.redirect(`/entradas/${req.params.id}`);
});

// ── PDF ──────────────────────────────────────────────────────────
function generarPDF(entrada, bienes, res) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
  doc.pipe(res);

  const membrete = path.join(__dirname, '../public/img/membrete.png');
  if (fs.existsSync(membrete)) { doc.image(membrete, 0, 0, { width: 612 }); doc.moveDown(6); }

  const CATS = { equipo_medico: 'Eq. Médico', equipo_computo: 'Cómputo', mobiliario: 'Mobiliario', mobiliario_medico: 'Mob. Médico', vehiculo: 'Vehículo', herramienta: 'Herramienta', otro: 'Otro' };
  const COND = { bueno: 'Bueno', regular: 'Regular', malo: 'Malo' };
  const TIPOS_L = { compra: 'Compra', donacion: 'Donación', transferencia: 'Transferencia', otro: 'Otro' };
  const ORIGEN_L = { compra: 'Proveedor', donacion: 'Donante', transferencia: 'Unidad de origen', otro: 'Origen' };

  doc.fontSize(13).font('Helvetica-Bold').text('ACTA DE RECEPCIÓN DE BIENES', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(10).font('Helvetica').text(
    `Folio: ${entrada.folio}   ·   Tipo: ${TIPOS_L[entrada.tipo]}   ·   Fecha: ${new Date(entrada.fecha_entrada + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}`,
    { align: 'center' }
  );
  doc.moveDown(0.8);

  function fila(label, val) {
    if (!val) return;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#555').text(label + ': ', { continued: true });
    doc.font('Helvetica').fillColor('#000').text(val);
  }
  fila(ORIGEN_L[entrada.tipo], entrada.proveedor_donante);
  fila('Documento soporte', entrada.numero_documento);
  fila('Quien entrega', [entrada.responsable_entrega, entrada.cargo_entrega].filter(Boolean).join(' · '));
  fila('Quien recibe', [entrada.responsable_recepcion, entrada.cargo_recepcion].filter(Boolean).join(' · '));
  fila('Observaciones', entrada.observaciones);
  doc.moveDown(0.8);

  doc.fontSize(9).font('Helvetica-Bold').text('BIENES RECIBIDOS:', { underline: true });
  doc.moveDown(0.4);

  const cols = [55, 115, 70, 60, 60, 62, 62, 55];
  const hdrs = ['N° Inv.', 'Nombre', 'Categoría', 'Marca', 'Modelo', 'N° Serie', 'Área', 'Condición'];
  const sx = 40;
  let y = doc.y;
  const totalW = cols.reduce((a, b) => a + b, 0);

  doc.rect(sx, y, totalW, 16).fill('#1a7a4a');
  let cx = sx;
  hdrs.forEach((h, i) => {
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#fff')
       .text(h, cx + 3, y + 4, { width: cols[i] - 6, lineBreak: false });
    cx += cols[i];
  });
  y += 16;

  bienes.forEach((b, idx) => {
    const rh = 20;
    if (y + rh > doc.page.height - 120) { doc.addPage(); y = 50; }
    doc.rect(sx, y, totalW, rh).fill(idx % 2 === 0 ? '#f0faf4' : '#fff');
    doc.rect(sx, y, totalW, rh).stroke('#d1d5db');
    const row = [b.numero_inventario, b.nombre, CATS[b.categoria] || b.categoria,
      b.marca || '—', b.modelo || '—', b.numero_serie || '—',
      b.area_nombre || '—', COND[b.condicion_entrada] || b.condicion_entrada];
    cx = sx;
    doc.font('Helvetica').fontSize(7.5).fillColor('#111');
    row.forEach((v, i) => {
      doc.text(String(v || '—'), cx + 3, y + 6, { width: cols[i] - 6, lineBreak: false, ellipsis: true });
      cx += cols[i];
    });
    y += rh;
  });

  const fy = doc.page.height - 90;
  if (fy < y + 40) doc.addPage();
  const sigs = [
    { t: 'Quien entrega', n: entrada.responsable_entrega || '', c: entrada.cargo_entrega || '' },
    { t: 'Quien recibe', n: entrada.responsable_recepcion || '', c: entrada.cargo_recepcion || '' },
    { t: 'Vo.Bo. Directora', n: '', c: 'Directora General' }
  ];
  const sw = 150, gap = 30, fsX = 55, finalY = doc.page.height - 90;
  sigs.forEach((s, i) => {
    const x = fsX + i * (sw + gap);
    doc.moveTo(x, finalY).lineTo(x + sw, finalY).stroke('#555');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000').text(s.n || '________________________', x, finalY + 3, { width: sw, align: 'center' });
    doc.fontSize(7.5).font('Helvetica').fillColor('#555').text(s.c, x, finalY + 13, { width: sw, align: 'center' });
    doc.font('Helvetica-Bold').fillColor('#333').text(s.t, x, finalY + 23, { width: sw, align: 'center' });
  });

  doc.end();
}

module.exports = router;
