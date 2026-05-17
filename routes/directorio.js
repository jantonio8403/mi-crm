const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { requireAuth } = require('../controllers/authMiddleware');

const ROLES_EDICION = ['admin', 'director', 'secretaria'];

function puedeEditar(req, res, next) {
  if (ROLES_EDICION.includes(req.session.usuario.rol)) return next();
  req.flash('error', 'No tienes permiso para realizar esta acción');
  res.redirect('/directorio');
}

// ── Búsqueda JSON (para autocomplete) ───────────────────────────
router.get('/buscar', requireAuth, async (req, res, next) => {
  try {
    const { q = '', tipo = '' } = req.query;
    const params = [];
    let where = 'f.activo=1';
    if (q.trim()) {
      where += ' AND (f.nombre LIKE ? OR f.cargo LIKE ? OR f.institucion LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (tipo) { where += ' AND f.tipo=?'; params.push(tipo); }

    const rows = await query(
      `SELECT f.id, f.nombre, f.cargo, f.tipo, f.institucion, f.email, f.telefono,
              a.nombre as area_nombre
       FROM funcionarios f
       LEFT JOIN areas a ON f.area_id = a.id
       WHERE ${where}
       ORDER BY f.nombre ASC LIMIT 12`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── Lista ────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { tipo = '', buscar = '' } = req.query;
    let where = '1=1';
    const params = [];
    if (tipo)   { where += ' AND f.tipo=?'; params.push(tipo); }
    if (buscar) {
      where += ' AND (f.nombre LIKE ? OR f.cargo LIKE ? OR f.institucion LIKE ? OR a.nombre LIKE ?)';
      params.push(`%${buscar}%`, `%${buscar}%`, `%${buscar}%`, `%${buscar}%`);
    }

    const funcionarios = await query(
      `SELECT f.*, a.nombre as area_nombre
       FROM funcionarios f
       LEFT JOIN areas a ON f.area_id = a.id
       WHERE ${where}
       ORDER BY f.tipo ASC, f.nombre ASC`,
      params
    );

    const [totales] = await query(
      `SELECT
         COUNT(*) as total,
         SUM(tipo='interno') as internos,
         SUM(tipo='externo') as externos
       FROM funcionarios WHERE activo=1`
    );

    res.render('directorio/lista', {
      titulo: 'Directorio de Funcionarios',
      funcionarios, totales,
      filtros: { tipo, buscar },
      puedeEditar: ROLES_EDICION.includes(req.session.usuario.rol),
    });
  } catch (err) { next(err); }
});

// ── Nuevo ────────────────────────────────────────────────────────
router.get('/nuevo', requireAuth, puedeEditar, async (req, res, next) => {
  try {
    const areas = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');
    const usuariosDisp = await query(
      `SELECT u.id, u.nombre, u.cargo, u.rol FROM usuarios u
       WHERE u.activo=1
         AND u.id NOT IN (SELECT usuario_id FROM funcionarios WHERE usuario_id IS NOT NULL)
       ORDER BY u.nombre`
    );
    res.render('directorio/form', {
      titulo: 'Nuevo Funcionario',
      funcionario: null, areas, usuariosDisp,
      accion: '/directorio',
      tipoPreset: req.query.tipo || 'externo',
      esJefeActual: false,
    });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, puedeEditar, async (req, res, next) => {
  try {
    const { nombre, cargo, tipo, institucion, area_id, email, telefono, es_jefe, usuario_id } = req.body;
    if (!nombre || !nombre.trim()) {
      req.flash('error', 'El nombre es requerido');
      return res.redirect('/directorio/nuevo');
    }
    const areaIdVal    = tipo === 'interno' && area_id    ? parseInt(area_id)    : null;
    const usuarioIdVal = tipo === 'interno' && usuario_id ? parseInt(usuario_id) : null;
    const result = await query(
      `INSERT INTO funcionarios (nombre, cargo, tipo, institucion, area_id, usuario_id, email, telefono)
       VALUES (?,?,?,?,?,?,?,?)`,
      [nombre.trim(), cargo || null, tipo || 'externo',
       tipo === 'externo' ? (institucion || null) : null,
       areaIdVal, usuarioIdVal,
       email || null, telefono || null]
    );
    if (tipo === 'interno' && areaIdVal && es_jefe === '1') {
      await query('UPDATE areas SET responsable_id=? WHERE id=?', [result.insertId, areaIdVal]);
    }
    req.flash('success', `Funcionario "${nombre.trim()}" agregado al directorio`);
    res.redirect('/directorio');
  } catch (err) { next(err); }
});

// ── Editar ───────────────────────────────────────────────────────
router.get('/:id/editar', requireAuth, puedeEditar, async (req, res, next) => {
  try {
    const [funcionario] = await query('SELECT * FROM funcionarios WHERE id=?', [req.params.id]);
    if (!funcionario) { req.flash('error', 'Funcionario no encontrado'); return res.redirect('/directorio'); }
    const areas = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');
    // Usuarios disponibles: los no vinculados + el que ya tiene este funcionario
    const usuariosDisp = await query(
      `SELECT u.id, u.nombre, u.cargo, u.rol FROM usuarios u
       WHERE u.activo=1
         AND (u.id NOT IN (SELECT usuario_id FROM funcionarios WHERE usuario_id IS NOT NULL)
              OR u.id = ?)
       ORDER BY u.nombre`,
      [funcionario.usuario_id || 0]
    );
    let esJefeActual = false;
    if (funcionario.tipo === 'interno' && funcionario.area_id) {
      const [area] = await query('SELECT responsable_id FROM areas WHERE id=?', [funcionario.area_id]);
      esJefeActual = area && area.responsable_id == funcionario.id;
    }
    res.render('directorio/form', {
      titulo: 'Editar Funcionario',
      funcionario, areas, usuariosDisp,
      accion: `/directorio/${funcionario.id}`,
      tipoPreset: funcionario.tipo,
      esJefeActual,
    });
  } catch (err) { next(err); }
});

router.post('/:id', requireAuth, puedeEditar, async (req, res, next) => {
  try {
    const { nombre, cargo, tipo, institucion, area_id, email, telefono, es_jefe, usuario_id } = req.body;
    if (!nombre || !nombre.trim()) {
      req.flash('error', 'El nombre es requerido');
      return res.redirect(`/directorio/${req.params.id}/editar`);
    }
    const areaIdVal    = tipo === 'interno' && area_id    ? parseInt(area_id)    : null;
    const usuarioIdVal = tipo === 'interno' && usuario_id ? parseInt(usuario_id) : null;
    await query(
      `UPDATE funcionarios SET nombre=?, cargo=?, tipo=?, institucion=?, area_id=?, usuario_id=?, email=?, telefono=?
       WHERE id=?`,
      [nombre.trim(), cargo || null, tipo || 'externo',
       tipo === 'externo' ? (institucion || null) : null,
       areaIdVal, usuarioIdVal,
       email || null, telefono || null, req.params.id]
    );
    if (tipo === 'interno' && areaIdVal && es_jefe === '1') {
      await query('UPDATE areas SET responsable_id=? WHERE id=?', [req.params.id, areaIdVal]);
    } else if (es_jefe !== '1') {
      // si se desmarca, quitar como jefe solo si aún figura en esa área
      await query('UPDATE areas SET responsable_id=NULL WHERE responsable_id=?', [req.params.id]);
    }
    req.flash('success', 'Funcionario actualizado correctamente');
    res.redirect('/directorio');
  } catch (err) { next(err); }
});

// ── Activar / desactivar ─────────────────────────────────────────
router.post('/:id/toggle', requireAuth, puedeEditar, async (req, res, next) => {
  try {
    const [f] = await query('SELECT activo, nombre FROM funcionarios WHERE id=?', [req.params.id]);
    if (!f) { req.flash('error', 'Funcionario no encontrado'); return res.redirect('/directorio'); }
    const nuevo = f.activo ? 0 : 1;
    await query('UPDATE funcionarios SET activo=? WHERE id=?', [nuevo, req.params.id]);
    req.flash('success', `"${f.nombre}" ${nuevo ? 'activado' : 'desactivado'}`);
    res.redirect('/directorio');
  } catch (err) { next(err); }
});

module.exports = router;
