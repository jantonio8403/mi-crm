const express = require('express');
const router = express.Router();
const path  = require('path');
const fs    = require('fs');
const { query } = require('../database/db');
const { requireAuth, requireAdmin } = require('../controllers/authMiddleware');
const multer = require('multer');

// Multer memoria — solo para importación CSV
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Multer disco — para fotos de bienes
const multerFotos = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../uploads/inventario');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
      cb(null, `bien_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  },
  limits: { fileSize: 8 * 1024 * 1024, files: 10 },
});

const CAT_MAP = {
  'mobiliario': 'mobiliario',
  'mobiliario médico': 'mobiliario_medico', 'mobiliario medico': 'mobiliario_medico', 'mobiliario_medico': 'mobiliario_medico',
  'equipo médico': 'equipo_medico', 'equipo medico': 'equipo_medico', 'equipo_medico': 'equipo_medico',
  'equipo de cómputo': 'equipo_computo', 'equipo de computo': 'equipo_computo',
  'equipo cómputo': 'equipo_computo', 'equipo computo': 'equipo_computo', 'equipo_computo': 'equipo_computo',
  'instrumental médico': 'instrumental', 'instrumental medico': 'instrumental', 'instrumental': 'instrumental',
  'vehículo': 'vehiculo', 'vehiculo': 'vehiculo', 'ambulancia': 'vehiculo',
  'vehículo / ambulancia': 'vehiculo', 'vehiculo / ambulancia': 'vehiculo',
  'equipo electromecánico': 'electromecanico', 'equipo electromecanico': 'electromecanico', 'electromecanico': 'electromecanico',
};

const ESTADO_MAP = {
  'activo': 'activo',
  'en mantenimiento': 'en_mantenimiento', 'en_mantenimiento': 'en_mantenimiento', 'mantenimiento': 'en_mantenimiento',
  'en traslado': 'en_traslado', 'en_traslado': 'en_traslado', 'traslado': 'en_traslado',
  'dado de baja': 'dado_de_baja', 'dado_de_baja': 'dado_de_baja', 'baja': 'dado_de_baja',
};

const CONDICION_MAP = {
  'bueno': 'bueno', 'b': 'bueno',
  'regular': 'regular', 'r': 'regular',
  'malo': 'malo', 'm': 'malo',
};

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        row.push(field.trim());
        field = '';
      } else {
        field += c;
      }
    }
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

function parseFecha(str) {
  if (!str || !str.trim()) return null;
  const m1 = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str.trim())) return str.trim();
  return null;
}

const CATEGORIAS = {
  mobiliario:         'Mobiliario',
  mobiliario_medico:  'Mobiliario Médico',
  equipo_medico:      'Equipo Médico',
  equipo_computo:     'Equipo de Cómputo',
  instrumental:       'Instrumental Médico',
  vehiculo:           'Vehículo / Ambulancia',
  electromecanico:    'Equipo Electromecánico',
};

const ESTADOS = {
  activo:            'Activo',
  en_mantenimiento:  'En mantenimiento',
  en_traslado:       'En traslado',
  dado_de_baja:      'Dado de baja',
};

const CONDICIONES = {
  bueno:   { label: 'Bueno',   color: '#16a34a' },
  regular: { label: 'Regular', color: '#d97706' },
  malo:    { label: 'Malo',    color: '#dc2626' },
};

const TIPOS_MOV = {
  salida:            'Salida',
  traslado_interno:  'Traslado interno',
  traslado_externo:  'Traslado externo',
  retorno:           'Retorno',
  baja:              'Baja',
};

async function siguienteInventario() {
  const anio = new Date().getFullYear();
  const [row] = await query('SELECT MAX(consecutivo) as max FROM bienes WHERE anio=?', [anio]);
  const siguiente = (row.max || 0) + 1;
  return { consecutivo: siguiente, anio, numero_inventario: `INV/${String(siguiente).padStart(4, '0')}/${anio}` };
}

// ── Lista ─────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { categoria, estado, condicion, area, buscar, page = 1 } = req.query;
    const limit = 20;
    const offset = (parseInt(page) - 1) * limit;
    const u = req.session.usuario;
    const esJefeArea = u.rol === 'jefe_area';

    let where = 'b.activo=1';
    const params = [];
    if (esJefeArea) { where += ' AND LOWER(b.resguardante) = LOWER(?)'; params.push(u.nombre); }
    if (categoria) { where += ' AND b.categoria=?';  params.push(categoria); }
    if (estado)    { where += ' AND b.estado=?';     params.push(estado); }
    if (condicion) { where += ' AND b.condicion=?';  params.push(condicion); }
    if (area)      { where += ' AND b.area_id=?';    params.push(area); }
    if (buscar)    {
      where += ' AND (b.numero_inventario LIKE ? OR b.nombre LIKE ? OR b.marca LIKE ? OR b.numero_serie LIKE ?)';
      params.push(`%${buscar}%`, `%${buscar}%`, `%${buscar}%`, `%${buscar}%`);
    }

    const [totalRow] = await query(`SELECT COUNT(*) as c FROM bienes b WHERE ${where}`, params);
    const bienes = await query(`
      SELECT b.*, a.nombre as area_nombre
      FROM bienes b
      LEFT JOIN areas a ON b.area_id = a.id
      WHERE ${where}
      ORDER BY b.categoria, b.nombre
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    let stats = { activo: 0, en_mantenimiento: 0, en_traslado: 0, dado_de_baja: 0 };
    if (esJefeArea) {
      const statsRows = await query(
        `SELECT estado, COUNT(*) as c FROM bienes WHERE activo=1 AND LOWER(resguardante)=LOWER(?) GROUP BY estado`,
        [u.nombre]
      );
      statsRows.forEach(r => { stats[r.estado] = r.c; });
    } else {
      const statsRows = await query(`SELECT estado, COUNT(*) as c FROM bienes WHERE activo=1 GROUP BY estado`);
      statsRows.forEach(r => { stats[r.estado] = r.c; });
    }

    const areas = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');

    res.render('inventario/lista', {
      titulo: 'Inventario de Bienes',
      bienes, areas, stats, CATEGORIAS, ESTADOS, CONDICIONES,
      esJefeArea,
      filtros: { categoria, estado, condicion, area, buscar },
      paginacion: { page: parseInt(page), total: totalRow.c, limit, pages: Math.ceil(totalRow.c / limit) },
    });
  } catch (err) { next(err); }
});

// ── Nuevo ─────────────────────────────────────────────────────────
router.get('/nuevo', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const areas = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');
    const folio = await siguienteInventario();
    res.render('inventario/form', {
      titulo: 'Registrar Bien',
      bien: null, areas, folio, CATEGORIAS, ESTADOS, CONDICIONES,
      accion: '/inventario',
    });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, requireAdmin, multerFotos.array('fotos', 10), async (req, res, next) => {
  try {
    const {
      nombre, descripcion, categoria, marca, modelo, numero_serie, numero_placas,
      area_id, resguardante, fecha_fabricacion, fecha_instalacion, estado, condicion,
      valor_adquisicion, proveedor, observaciones,
    } = req.body;

    const { consecutivo, anio, numero_inventario } = await siguienteInventario();

    const result = await query(
      `INSERT INTO bienes (numero_inventario, consecutivo, anio, nombre, descripcion,
       categoria, marca, modelo, numero_serie, numero_placas, area_id, resguardante,
       fecha_fabricacion, fecha_instalacion, estado, condicion,
       valor_adquisicion, proveedor, observaciones)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [numero_inventario, consecutivo, anio, nombre, descripcion || null,
       categoria, marca || null, modelo || null, numero_serie || null, numero_placas || null,
       area_id || null, resguardante || null, fecha_fabricacion || null, fecha_instalacion || null,
       estado, condicion, valor_adquisicion || null, proveedor || null, observaciones || null]
    );

    // Insumos
    const insumos = [].concat(req.body['insumo_nombre[]'] || req.body.insumo_nombre || []);
    for (let i = 0; i < insumos.length; i++) {
      const nom = Array.isArray(insumos) ? insumos[i] : insumos;
      if (!nom || !nom.trim()) continue;
      await query(
        `INSERT INTO bien_insumos (bien_id, nombre, unidad, cantidad_minima, proveedor_sugerido, observaciones)
         VALUES (?,?,?,?,?,?)`,
        [result.insertId, nom.trim(),
         (req.body['insumo_unidad[]'] || req.body.insumo_unidad || [])[i] || null,
         (req.body['insumo_cantidad[]'] || req.body.insumo_cantidad || [])[i] || 1,
         (req.body['insumo_proveedor[]'] || req.body.insumo_proveedor || [])[i] || null,
         (req.body['insumo_obs[]'] || req.body.insumo_obs || [])[i] || null]
      );
    }

    for (const f of (req.files || [])) {
      await query('INSERT INTO bien_fotos (bien_id, filename) VALUES (?,?)', [result.insertId, f.filename]);
    }

    req.flash('success', `Bien ${numero_inventario} registrado correctamente`);
    res.redirect(`/inventario/${result.insertId}`);
  } catch (err) { next(err); }
});

// ── Imprimir lista ────────────────────────────────────────────────
router.get('/imprimir', requireAuth, async (req, res, next) => {
  try {
    const { categoria, estado, condicion, area, buscar } = req.query;
    const u = req.session.usuario;

    let where = 'b.activo=1';
    const params = [];
    if (categoria) { where += ' AND b.categoria=?'; params.push(categoria); }
    if (estado)    { where += ' AND b.estado=?';    params.push(estado); }
    if (condicion) { where += ' AND b.condicion=?'; params.push(condicion); }
    if (area)      { where += ' AND b.area_id=?';   params.push(area); }
    if (buscar)    {
      where += ' AND (b.numero_inventario LIKE ? OR b.nombre LIKE ? OR b.marca LIKE ?)';
      params.push(`%${buscar}%`, `%${buscar}%`, `%${buscar}%`);
    }

    const bienes = await query(`
      SELECT b.*, a.nombre as area_nombre
      FROM bienes b
      LEFT JOIN areas a ON b.area_id = a.id
      WHERE ${where}
      ORDER BY b.categoria, b.nombre
    `, params);

    const areas = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');

    res.render('inventario/imprimir', {
      titulo: 'Inventario — Impresión',
      bienes, areas, CATEGORIAS, ESTADOS, CONDICIONES,
      filtros: { categoria, estado, condicion, area, buscar },
      generadoPor: u.nombre,
      generadoEn: new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'long', timeStyle: 'short' }),
    });
  } catch (err) { next(err); }
});

// ── Etiquetas QR — lote (con filtros de lista) ────────────────────
router.get('/etiquetas', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { categoria, estado, condicion, area, buscar } = req.query;
    let where = 'b.activo=1';
    const params = [];
    if (categoria) { where += ' AND b.categoria=?'; params.push(categoria); }
    if (estado)    { where += ' AND b.estado=?';    params.push(estado); }
    if (condicion) { where += ' AND b.condicion=?'; params.push(condicion); }
    if (area)      { where += ' AND b.area_id=?';   params.push(area); }
    if (buscar)    {
      where += ' AND (b.numero_inventario LIKE ? OR b.nombre LIKE ?)';
      params.push(`%${buscar}%`, `%${buscar}%`);
    }
    const bienes = await query(`
      SELECT b.*, a.nombre as area_nombre FROM bienes b
      LEFT JOIN areas a ON b.area_id=a.id
      WHERE ${where} ORDER BY b.categoria, b.nombre`, params);
    const baseUrl = req.protocol + '://' + req.get('host');
    res.render('inventario/etiqueta', { titulo: 'Etiquetas QR', bienes, baseUrl });
  } catch (err) { next(err); }
});

// ── Importar — plantilla ──────────────────────────────────────────
router.get('/importar/plantilla', requireAuth, requireAdmin, (req, res) => {
  const headers = 'numero_inventario,nombre,categoria,area,resguardante,marca,modelo,numero_serie,numero_placas,estado,condicion,valor_adquisicion,proveedor,fecha_fabricacion,fecha_instalacion,observaciones';
  const example = '"MED-001","Ultrasonido Portátil","Equipo Médico","Urgencias","Dr. García","Philips","CX50","SN123456","","Activo","Bueno","150000","Philips México","01/01/2020","15/03/2020","En uso constante"';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla_inventario.csv"');
  res.send('﻿' + headers + '\n' + example + '\n');
});

// ── Importar — formulario ─────────────────────────────────────────
router.get('/importar', requireAuth, requireAdmin, (req, res) => {
  res.render('inventario/importar', { titulo: 'Importar Inventario' });
});

// ── Importar — procesar ───────────────────────────────────────────
router.post('/importar', requireAuth, requireAdmin, upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) {
      req.flash('error', 'No se seleccionó ningún archivo');
      return res.redirect('/inventario/importar');
    }

    const text = req.file.buffer.toString('utf-8');
    const rows = parseCSV(text);
    if (rows.length < 2) {
      req.flash('error', 'El archivo no contiene datos (mínimo encabezado + 1 fila)');
      return res.redirect('/inventario/importar');
    }

    const headers = rows[0].map(h => h.toLowerCase().trim().replace(/\s+/g, '_'));
    const col = (name) => { const j = headers.indexOf(name); return j >= 0 && rows._row && rows._row[j] ? rows._row[j].trim() : ''; };

    const areas = await query('SELECT id, nombre FROM areas WHERE activa=1');

    let importados = 0;
    const errores = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.every(c => !c)) continue;

      const get = (name) => {
        const j = headers.indexOf(name);
        return (j >= 0 && row[j]) ? row[j].trim() : '';
      };

      const numero_inventario = get('numero_inventario');
      const nombre = get('nombre');
      if (!numero_inventario || !nombre) {
        errores.push(`Fila ${i + 1}: falta número de inventario o nombre`);
        continue;
      }

      const catRaw = get('categoria').toLowerCase();
      const categoria = CAT_MAP[catRaw] || 'mobiliario';

      const areaNombre = get('area').toLowerCase().trim();
      const areaMatch = areas.find(a =>
        a.nombre.toLowerCase() === areaNombre ||
        a.nombre.toLowerCase().includes(areaNombre) ||
        (areaNombre && areaNombre.includes(a.nombre.toLowerCase()))
      );
      const area_id = (areaNombre && areaMatch) ? areaMatch.id : null;

      const estado   = ESTADO_MAP[get('estado').toLowerCase()]   || 'activo';
      const condicion = CONDICION_MAP[get('condicion').toLowerCase()] || 'bueno';
      const valorRaw  = get('valor_adquisicion').replace(/[$,\s]/g, '');

      try {
        await query(
          `INSERT INTO bienes (numero_inventario, consecutivo, anio, nombre, categoria, area_id,
           resguardante, marca, modelo, numero_serie, numero_placas, estado, condicion,
           valor_adquisicion, proveedor, fecha_fabricacion, fecha_instalacion, observaciones)
           VALUES (?,0,0,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [numero_inventario, nombre, categoria, area_id,
           get('resguardante') || null, get('marca') || null, get('modelo') || null,
           get('numero_serie') || null, get('numero_placas') || null,
           estado, condicion,
           valorRaw ? parseFloat(valorRaw) : null,
           get('proveedor') || null,
           parseFecha(get('fecha_fabricacion')),
           parseFecha(get('fecha_instalacion')),
           get('observaciones') || null]
        );
        importados++;
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') {
          errores.push(`Fila ${i + 1}: "${numero_inventario}" ya existe en el sistema`);
        } else {
          errores.push(`Fila ${i + 1} (${numero_inventario}): ${e.message}`);
        }
      }
    }

    req.flash('success', `Importación completada: ${importados} bien(es) importados${errores.length ? `, ${errores.length} con error` : ''}`);
    if (errores.length) req.flash('error', errores.slice(0, 15).join(' · ') + (errores.length > 15 ? ` …y ${errores.length - 15} más` : ''));
    res.redirect('/inventario');
  } catch (err) { next(err); }
});

// ── Detalle ───────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const [bien] = await query(`
      SELECT b.*, a.nombre as area_nombre
      FROM bienes b LEFT JOIN areas a ON b.area_id = a.id
      WHERE b.id=?`, [req.params.id]);
    if (!bien) { req.flash('error', 'Bien no encontrado'); return res.redirect('/inventario'); }

    const u = req.session.usuario;
    if (u.rol === 'jefe_area' && (!bien.resguardante || bien.resguardante.toLowerCase() !== u.nombre.toLowerCase())) {
      req.flash('error', 'Solo puedes ver los bienes que tienes bajo resguardo');
      return res.redirect('/inventario');
    }

    const mantenimientos = await query(
      `SELECT bm.*, u.nombre as usuario_nombre FROM bien_mantenimientos bm
       LEFT JOIN usuarios u ON bm.usuario_id = u.id
       WHERE bm.bien_id=? ORDER BY bm.fecha DESC`, [req.params.id]);

    const movimientos = await query(
      `SELECT bm.*, u.nombre as usuario_nombre FROM bien_movimientos bm
       LEFT JOIN usuarios u ON bm.usuario_id = u.id
       WHERE bm.bien_id=? ORDER BY bm.fecha DESC, bm.creado_en DESC`, [req.params.id]);

    const insumos = await query(
      'SELECT * FROM bien_insumos WHERE bien_id=? AND activo=1 ORDER BY nombre', [req.params.id]);

    const fotos = await query(
      'SELECT * FROM bien_fotos WHERE bien_id=? ORDER BY orden, creado_en', [req.params.id]);

    const areas = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');

    res.render('inventario/detalle', {
      titulo: `Bien ${bien.numero_inventario}`,
      bien, mantenimientos, movimientos, insumos, fotos, areas,
      CATEGORIAS, ESTADOS, CONDICIONES, TIPOS_MOV,
      canEditar: ['admin', 'director'].includes(req.session.usuario.rol),
    });
  } catch (err) { next(err); }
});

// ── Actualización rápida (móvil) ──────────────────────────────────
router.get('/:id/actualizar', requireAuth, async (req, res, next) => {
  try {
    const [bien] = await query(`
      SELECT b.*, a.nombre as area_nombre FROM bienes b
      LEFT JOIN areas a ON b.area_id=a.id WHERE b.id=?`, [req.params.id]);
    if (!bien) { req.flash('error', 'Bien no encontrado'); return res.redirect('/inventario'); }
    const fotos = await query(
      'SELECT * FROM bien_fotos WHERE bien_id=? ORDER BY orden, creado_en', [req.params.id]);
    res.render('inventario/actualizar', {
      titulo: `Actualizar ${bien.numero_inventario}`,
      bien, fotos, CONDICIONES, ESTADOS,
    });
  } catch (err) { next(err); }
});

router.post('/:id/actualizar', requireAuth, multerFotos.array('fotos', 10), async (req, res, next) => {
  try {
    const { condicion, resguardante, estado, observaciones } = req.body;
    const id = req.params.id;
    await query(
      `UPDATE bienes SET condicion=?, resguardante=?, estado=?,
       observaciones=?, actualizado_en=NOW() WHERE id=?`,
      [condicion, resguardante || null, estado, observaciones || null, id]
    );
    for (const f of (req.files || [])) {
      await query('INSERT INTO bien_fotos (bien_id, filename) VALUES (?,?)', [id, f.filename]);
    }
    req.flash('success', 'Registro actualizado correctamente');
    res.redirect(`/inventario/${id}/actualizar`);
  } catch (err) { next(err); }
});

// ── Etiqueta QR — individual ──────────────────────────────────────
router.get('/:id/etiqueta', requireAuth, async (req, res, next) => {
  try {
    const [bien] = await query(`
      SELECT b.*, a.nombre as area_nombre FROM bienes b
      LEFT JOIN areas a ON b.area_id=a.id WHERE b.id=?`, [req.params.id]);
    if (!bien) return res.redirect('/inventario');
    const baseUrl = req.protocol + '://' + req.get('host');
    res.render('inventario/etiqueta', { titulo: 'Etiqueta QR', bienes: [bien], baseUrl });
  } catch (err) { next(err); }
});

// ── Editar ────────────────────────────────────────────────────────
router.get('/:id/editar', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [bien] = await query('SELECT * FROM bienes WHERE id=?', [req.params.id]);
    if (!bien) { req.flash('error', 'Bien no encontrado'); return res.redirect('/inventario'); }
    const insumos = await query('SELECT * FROM bien_insumos WHERE bien_id=? AND activo=1', [req.params.id]);
    const areas   = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');
    res.render('inventario/form', {
      titulo: `Editar ${bien.numero_inventario}`,
      bien, insumos, areas, folio: { numero_inventario: bien.numero_inventario },
      CATEGORIAS, ESTADOS, CONDICIONES,
      accion: `/inventario/${bien.id}`,
    });
  } catch (err) { next(err); }
});

router.post('/:id', requireAuth, requireAdmin, multerFotos.array('fotos', 10), async (req, res, next) => {
  try {
    const {
      nombre, descripcion, categoria, marca, modelo, numero_serie, numero_placas,
      area_id, resguardante, fecha_fabricacion, fecha_instalacion, estado, condicion,
      valor_adquisicion, proveedor, observaciones,
    } = req.body;

    await query(
      `UPDATE bienes SET nombre=?, descripcion=?, categoria=?, marca=?, modelo=?,
       numero_serie=?, numero_placas=?, area_id=?, resguardante=?, fecha_fabricacion=?,
       fecha_instalacion=?, estado=?, condicion=?, valor_adquisicion=?,
       proveedor=?, observaciones=? WHERE id=?`,
      [nombre, descripcion || null, categoria, marca || null, modelo || null,
       numero_serie || null, numero_placas || null, area_id || null,
       resguardante || null, fecha_fabricacion || null, fecha_instalacion || null,
       estado, condicion, valor_adquisicion || null,
       proveedor || null, observaciones || null, req.params.id]
    );

    // Reemplazar insumos
    await query('UPDATE bien_insumos SET activo=0 WHERE bien_id=?', [req.params.id]);
    const insumos = [].concat(req.body['insumo_nombre[]'] || req.body.insumo_nombre || []);
    for (let i = 0; i < insumos.length; i++) {
      const nom = Array.isArray(insumos) ? insumos[i] : insumos;
      if (!nom || !nom.trim()) continue;
      await query(
        `INSERT INTO bien_insumos (bien_id, nombre, unidad, cantidad_minima, proveedor_sugerido, observaciones)
         VALUES (?,?,?,?,?,?)`,
        [req.params.id, nom.trim(),
         (req.body['insumo_unidad[]'] || req.body.insumo_unidad || [])[i] || null,
         (req.body['insumo_cantidad[]'] || req.body.insumo_cantidad || [])[i] || 1,
         (req.body['insumo_proveedor[]'] || req.body.insumo_proveedor || [])[i] || null,
         (req.body['insumo_obs[]'] || req.body.insumo_obs || [])[i] || null]
      );
    }

    for (const f of (req.files || [])) {
      await query('INSERT INTO bien_fotos (bien_id, filename) VALUES (?,?)', [req.params.id, f.filename]);
    }

    req.flash('success', 'Bien actualizado correctamente');
    res.redirect(`/inventario/${req.params.id}`);
  } catch (err) { next(err); }
});

// ── Registrar mantenimiento ───────────────────────────────────────
router.post('/:id/mantenimiento', requireAuth, async (req, res, next) => {
  try {
    const { fecha, tipo, descripcion, responsable, costo, condicion_resultado, proximo_mantenimiento } = req.body;
    const id = req.params.id;

    await query(
      `INSERT INTO bien_mantenimientos (bien_id, fecha, tipo, descripcion, responsable, costo, condicion_resultado, proximo_mantenimiento, usuario_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, fecha, tipo, descripcion, responsable || null, costo || null,
       condicion_resultado || null, proximo_mantenimiento || null, req.session.usuario.id]
    );

    await query(
      `UPDATE bienes SET fecha_ultimo_mant=?, condicion=IFNULL(?,condicion) WHERE id=?`,
      [fecha, condicion_resultado || null, id]
    );

    req.flash('success', 'Mantenimiento registrado');
    res.redirect(`/inventario/${id}`);
  } catch (err) { next(err); }
});

// ── Registrar movimiento ──────────────────────────────────────────
router.post('/:id/movimiento', requireAuth, async (req, res, next) => {
  try {
    const { tipo, fecha, destino, responsable_nombre, responsable_cargo, motivo, observaciones } = req.body;
    const id = req.params.id;

    await query(
      `INSERT INTO bien_movimientos (bien_id, tipo, fecha, destino, responsable_nombre, responsable_cargo, motivo, observaciones, usuario_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, tipo, fecha, destino || null, responsable_nombre || null,
       responsable_cargo || null, motivo || null, observaciones || null, req.session.usuario.id]
    );

    const nuevoEstado = tipo === 'baja' ? 'dado_de_baja'
      : tipo === 'retorno' ? 'activo'
      : tipo === 'salida' || tipo === 'traslado_externo' ? 'en_traslado'
      : 'activo';

    await query('UPDATE bienes SET estado=? WHERE id=?', [nuevoEstado, id]);

    req.flash('success', 'Movimiento registrado');
    res.redirect(`/inventario/${id}`);
  } catch (err) { next(err); }
});

// ── Eliminar foto ─────────────────────────────────────────────────
router.post('/:id/foto/:fotoId/eliminar', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [foto] = await query(
      'SELECT * FROM bien_fotos WHERE id=? AND bien_id=?', [req.params.fotoId, req.params.id]);
    if (foto) {
      const filePath = path.join(__dirname, '../uploads/inventario', foto.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      await query('DELETE FROM bien_fotos WHERE id=?', [foto.id]);
    }
    res.redirect(`/inventario/${req.params.id}`);
  } catch (err) { next(err); }
});

// ── Comprobante de salida (impresión) ─────────────────────────────
router.get('/:id/movimiento/:movId/salida', requireAuth, async (req, res, next) => {
  try {
    const [bien] = await query(`
      SELECT b.*, a.nombre as area_nombre FROM bienes b
      LEFT JOIN areas a ON b.area_id = a.id WHERE b.id=?`, [req.params.id]);
    const [mov] = await query(
      'SELECT * FROM bien_movimientos WHERE id=? AND bien_id=?',
      [req.params.movId, req.params.id]);
    if (!bien || !mov) return res.redirect('/inventario');

    const insumos = await query('SELECT * FROM bien_insumos WHERE bien_id=? AND activo=1', [req.params.id]);

    res.render('inventario/salida', {
      titulo: 'Comprobante de Salida',
      bien, mov, insumos, CATEGORIAS, TIPOS_MOV,
      generadoPor: req.session.usuario.nombre,
      generadoEn: new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'long', timeStyle: 'short' }),
    });
  } catch (err) { next(err); }
});

module.exports = router;
