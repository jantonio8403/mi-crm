const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { requireAdmin } = require('../controllers/authMiddleware');

router.use(requireAdmin);

// ── Lista ────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const areas = await query(
      `SELECT a.*, f.nombre as jefe_nombre, f.cargo as jefe_cargo
       FROM areas a
       LEFT JOIN funcionarios f ON a.responsable_id = f.id
       ORDER BY a.nombre`
    );
    res.render('areas/lista', { titulo: 'Gestión de Áreas', areas });
  } catch (err) { next(err); }
});

// ── Nueva ────────────────────────────────────────────────────────
router.get('/nueva', async (req, res, next) => {
  try {
    res.render('areas/form', { titulo: 'Nueva Área', area: null, accion: '/areas' });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { nombre, codigo, descripcion, responsable_id } = req.body;
    if (!nombre || !nombre.trim()) {
      req.flash('error', 'El nombre del área es requerido');
      return res.redirect('/areas/nueva');
    }
    if (!codigo || !codigo.trim()) {
      req.flash('error', 'El código del área es requerido');
      return res.redirect('/areas/nueva');
    }
    const respId = responsable_id && responsable_id.trim() ? parseInt(responsable_id) : null;
    await query(
      'INSERT INTO areas (nombre, codigo, descripcion, responsable_id) VALUES (?,?,?,?)',
      [nombre.trim(), codigo.trim().toUpperCase(), descripcion || null, respId]
    );
    req.flash('success', `Área "${nombre.trim()}" creada correctamente`);
    res.redirect('/areas');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      req.flash('error', 'Ya existe un área con ese nombre o código');
      return res.redirect('/areas/nueva');
    }
    next(err);
  }
});

// ── Editar ───────────────────────────────────────────────────────
router.get('/:id/editar', async (req, res, next) => {
  try {
    const [area] = await query(
      `SELECT a.*, f.nombre as jefe_nombre, f.cargo as jefe_cargo
       FROM areas a
       LEFT JOIN funcionarios f ON a.responsable_id = f.id
       WHERE a.id=?`, [req.params.id]
    );
    if (!area) { req.flash('error', 'Área no encontrada'); return res.redirect('/areas'); }
    res.render('areas/form', { titulo: 'Editar Área', area, accion: `/areas/${area.id}` });
  } catch (err) { next(err); }
});

router.post('/:id', async (req, res, next) => {
  try {
    const { nombre, codigo, descripcion, responsable_id } = req.body;
    if (!nombre || !nombre.trim()) {
      req.flash('error', 'El nombre del área es requerido');
      return res.redirect(`/areas/${req.params.id}/editar`);
    }
    if (!codigo || !codigo.trim()) {
      req.flash('error', 'El código del área es requerido');
      return res.redirect(`/areas/${req.params.id}/editar`);
    }
    const respId = responsable_id && responsable_id.trim() ? parseInt(responsable_id) : null;
    await query(
      'UPDATE areas SET nombre=?, codigo=?, descripcion=?, responsable_id=? WHERE id=?',
      [nombre.trim(), codigo.trim().toUpperCase(), descripcion || null, respId, req.params.id]
    );
    req.flash('success', 'Área actualizada correctamente');
    res.redirect('/areas');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      req.flash('error', 'Ya existe un área con ese nombre o código');
      return res.redirect(`/areas/${req.params.id}/editar`);
    }
    next(err);
  }
});

// ── Activar / desactivar ─────────────────────────────────────────
router.post('/:id/toggle', async (req, res, next) => {
  try {
    const [area] = await query('SELECT activa, nombre FROM areas WHERE id=?', [req.params.id]);
    if (!area) { req.flash('error', 'Área no encontrada'); return res.redirect('/areas'); }
    const nuevo = area.activa ? 0 : 1;
    await query('UPDATE areas SET activa=? WHERE id=?', [nuevo, req.params.id]);
    req.flash('success', `Área "${area.nombre}" ${nuevo ? 'activada' : 'desactivada'}`);
    res.redirect('/areas');
  } catch (err) { next(err); }
});

module.exports = router;
