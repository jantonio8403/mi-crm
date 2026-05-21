const express = require('express');
const router  = express.Router();
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

async function totalBienesAlcance(sesion) {
  let where = "activo=1 AND estado != 'dado_de_baja'";
  const params = [];
  if (sesion.alcance === 'area' && sesion.area_id) {
    where += ' AND area_id=?';
    params.push(sesion.area_id);
  }
  const [row] = await query(`SELECT COUNT(*) as c FROM bienes WHERE ${where}`, params);
  return row.c;
}

// ── Lista de sesiones ─────────────────────────────────────────────
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const sesiones = await query(`
      SELECT v.*, u.nombre as creado_por_nombre, a.nombre as area_nombre,
        (SELECT COUNT(*) FROM verificacion_detalles WHERE verificacion_id=v.id) as total_escaneados
      FROM verificaciones_inventario v
      LEFT JOIN usuarios u ON v.creado_por_id = u.id
      LEFT JOIN areas a ON v.area_id = a.id
      ORDER BY v.fecha_inicio DESC
    `);
    const areas = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');
    res.render('verificaciones/lista', { titulo: 'Verificaciones de Inventario', sesiones, areas });
  } catch (err) { next(err); }
});

// ── Nueva sesión ──────────────────────────────────────────────────
router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { nombre, alcance, area_id } = req.body;
    const result = await query(
      `INSERT INTO verificaciones_inventario (nombre, alcance, area_id, creado_por_id)
       VALUES (?,?,?,?)`,
      [nombre.trim(), alcance || 'global',
       (alcance === 'area' && area_id) ? area_id : null,
       req.session.usuario.id]
    );
    req.flash('success', `Sesión "${nombre}" iniciada`);
    res.redirect(`/verificaciones/${result.insertId}/escanear`);
  } catch (err) { next(err); }
});

// ── Página de escaneo (móvil) ─────────────────────────────────────
router.get('/:id/escanear', requireAuth, async (req, res, next) => {
  try {
    const [sesion] = await query(`
      SELECT v.*, a.nombre as area_nombre
      FROM verificaciones_inventario v
      LEFT JOIN areas a ON v.area_id = a.id
      WHERE v.id=?`, [req.params.id]);
    if (!sesion) { req.flash('error', 'Sesión no encontrada'); return res.redirect('/verificaciones'); }
    if (sesion.estado === 'cerrada') { return res.redirect(`/verificaciones/${sesion.id}/reporte`); }

    const total = await totalBienesAlcance(sesion);
    const [cntRow] = await query(
      'SELECT COUNT(*) as c FROM verificacion_detalles WHERE verificacion_id=?', [sesion.id]);

    res.render('verificaciones/escanear', {
      titulo: `Verificación: ${sesion.nombre}`,
      sesion, total, escaneados: cntRow.c,
      canCerrar: ['admin', 'director'].includes(req.session.usuario.rol),
    });
  } catch (err) { next(err); }
});

// ── AJAX: registrar escaneo ───────────────────────────────────────
router.post('/:id/registrar', requireAuth, async (req, res, next) => {
  try {
    const { bien_id } = req.body;
    const [sesion] = await query('SELECT * FROM verificaciones_inventario WHERE id=?', [req.params.id]);
    if (!sesion || sesion.estado === 'cerrada')
      return res.json({ ok: false, msg: 'Sesión no disponible' });

    const [bien] = await query(`
      SELECT b.*, a.nombre as area_nombre
      FROM bienes b LEFT JOIN areas a ON b.area_id=a.id
      WHERE b.id=? AND b.activo=1`, [bien_id]);
    if (!bien) return res.json({ ok: false, msg: 'Bien no encontrado en inventario' });

    let duplicado = false;
    try {
      await query(
        `INSERT INTO verificacion_detalles (verificacion_id, bien_id, escaneado_por_id)
         VALUES (?,?,?)`,
        [sesion.id, bien_id, req.session.usuario.id]);
      await query('UPDATE bienes SET ultima_verificacion_en=NOW() WHERE id=?', [bien_id]);
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') duplicado = true;
      else throw e;
    }

    const [cntRow] = await query(
      'SELECT COUNT(*) as c FROM verificacion_detalles WHERE verificacion_id=?', [sesion.id]);

    return res.json({
      ok: true, duplicado,
      escaneados: cntRow.c,
      bien: {
        nombre: bien.nombre,
        numero_inventario: bien.numero_inventario,
        area_nombre: bien.area_nombre || '—',
      },
    });
  } catch (err) { next(err); }
});

// ── Cerrar sesión ─────────────────────────────────────────────────
router.post('/:id/cerrar', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await query(
      "UPDATE verificaciones_inventario SET estado='cerrada', fecha_cierre=NOW() WHERE id=?",
      [req.params.id]);
    res.redirect(`/verificaciones/${req.params.id}/reporte`);
  } catch (err) { next(err); }
});

// ── Reporte ───────────────────────────────────────────────────────
router.get('/:id/reporte', requireAuth, async (req, res, next) => {
  try {
    const [sesion] = await query(`
      SELECT v.*, u.nombre as creado_por_nombre, a.nombre as area_nombre_sesion
      FROM verificaciones_inventario v
      LEFT JOIN usuarios u ON v.creado_por_id = u.id
      LEFT JOIN areas a ON v.area_id = a.id
      WHERE v.id=?`, [req.params.id]);
    if (!sesion) return res.redirect('/verificaciones');

    const presentes = await query(`
      SELECT b.numero_inventario, b.nombre, b.categoria, b.resguardante,
             a.nombre as area_nombre, vd.verificado_en, u.nombre as escaneado_por
      FROM verificacion_detalles vd
      JOIN bienes b ON vd.bien_id = b.id
      LEFT JOIN areas a ON b.area_id = a.id
      LEFT JOIN usuarios u ON vd.escaneado_por_id = u.id
      WHERE vd.verificacion_id=?
      ORDER BY b.categoria, b.nombre`, [sesion.id]);

    let whereAus = "b.activo=1 AND b.estado != 'dado_de_baja'";
    const paramsAus = [];
    if (sesion.alcance === 'area' && sesion.area_id) {
      whereAus += ' AND b.area_id=?';
      paramsAus.push(sesion.area_id);
    }

    const ausentes = await query(`
      SELECT b.numero_inventario, b.nombre, b.categoria, b.resguardante,
             a.nombre as area_nombre
      FROM bienes b
      LEFT JOIN areas a ON b.area_id = a.id
      WHERE ${whereAus}
        AND b.id NOT IN (
          SELECT bien_id FROM verificacion_detalles WHERE verificacion_id=?
        )
      ORDER BY b.categoria, b.nombre`, [...paramsAus, sesion.id]);

    const u = req.session.usuario;
    res.render('verificaciones/reporte', {
      titulo: `Reporte — ${sesion.nombre}`,
      sesion, presentes, ausentes, CATEGORIAS,
      generadoPor: u.nombre,
      generadoEn: new Date().toLocaleString('es-MX', {
        timeZone: 'America/Mexico_City', dateStyle: 'long', timeStyle: 'short' }),
    });
  } catch (err) { next(err); }
});

module.exports = router;
