const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { requireAuth, requireAdmin } = require('../controllers/authMiddleware');

const CATEGORIAS = {
  mobiliario:      'Mobiliario',
  equipo_medico:   'Equipo Médico',
  equipo_computo:  'Equipo de Cómputo',
  instrumental:    'Instrumental Médico',
  vehiculo:        'Vehículo / Ambulancia',
  electromecanico: 'Equipo Electromecánico',
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

    let where = 'b.activo=1';
    const params = [];
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

    const statsRows = await query(
      `SELECT estado, COUNT(*) as c FROM bienes WHERE activo=1 GROUP BY estado`
    );
    const stats = { activo: 0, en_mantenimiento: 0, en_traslado: 0, dado_de_baja: 0 };
    statsRows.forEach(r => { stats[r.estado] = r.c; });

    const areas = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');

    res.render('inventario/lista', {
      titulo: 'Inventario de Bienes',
      bienes, areas, stats, CATEGORIAS, ESTADOS, CONDICIONES,
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

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
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

// ── Detalle ───────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const [bien] = await query(`
      SELECT b.*, a.nombre as area_nombre
      FROM bienes b LEFT JOIN areas a ON b.area_id = a.id
      WHERE b.id=?`, [req.params.id]);
    if (!bien) { req.flash('error', 'Bien no encontrado'); return res.redirect('/inventario'); }

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

    const areas = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');

    res.render('inventario/detalle', {
      titulo: `Bien ${bien.numero_inventario}`,
      bien, mantenimientos, movimientos, insumos, areas,
      CATEGORIAS, ESTADOS, CONDICIONES, TIPOS_MOV,
      canEditar: ['admin', 'director'].includes(req.session.usuario.rol),
    });
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

router.post('/:id', requireAuth, requireAdmin, async (req, res, next) => {
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
