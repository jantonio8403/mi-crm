const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { requireAdmin } = require('../controllers/authMiddleware');

router.use(requireAdmin);

// ── Lista ────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const areas = await query('SELECT * FROM areas ORDER BY nombre');
    res.render('areas/lista', { titulo: 'Gestión de Áreas', areas });
  } catch (err) { next(err); }
});

// ── Nueva ────────────────────────────────────────────────────────
router.get('/nueva', async (req, res) => {
  res.render('areas/form', { titulo: 'Nueva Área', area: null, accion: '/areas' });
});

router.post('/', async (req, res, next) => {
  try {
    const { nombre, descripcion, responsable } = req.body;
    if (!nombre || !nombre.trim()) {
      req.flash('error', 'El nombre del área es requerido');
      return res.redirect('/areas/nueva');
    }
    await query(
      'INSERT INTO areas (nombre, descripcion, responsable) VALUES (?,?,?)',
      [nombre.trim(), descripcion || null, responsable || null]
    );
    req.flash('success', `Área "${nombre.trim()}" creada correctamente`);
    res.redirect('/areas');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      req.flash('error', 'Ya existe un área con ese nombre');
      return res.redirect('/areas/nueva');
    }
    next(err);
  }
});

// ── Editar ───────────────────────────────────────────────────────
router.get('/:id/editar', async (req, res, next) => {
  try {
    const [area] = await query('SELECT * FROM areas WHERE id=?', [req.params.id]);
    if (!area) { req.flash('error', 'Área no encontrada'); return res.redirect('/areas'); }
    res.render('areas/form', { titulo: 'Editar Área', area, accion: `/areas/${area.id}` });
  } catch (err) { next(err); }
});

router.post('/:id', async (req, res, next) => {
  try {
    const { nombre, descripcion, responsable } = req.body;
    if (!nombre || !nombre.trim()) {
      req.flash('error', 'El nombre del área es requerido');
      return res.redirect(`/areas/${req.params.id}/editar`);
    }
    await query(
      'UPDATE areas SET nombre=?, descripcion=?, responsable=? WHERE id=?',
      [nombre.trim(), descripcion || null, responsable || null, req.params.id]
    );
    req.flash('success', 'Área actualizada correctamente');
    res.redirect('/areas');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      req.flash('error', 'Ya existe un área con ese nombre');
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
