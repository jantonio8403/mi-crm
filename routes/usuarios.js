const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query } = require('../database/db');
const { requireAuth, requireAdmin } = require('../controllers/authMiddleware');

const ROLES = {
  admin:      'Administrador',
  director:   'Director',
  jefe_area:  'Jefe de Área',
  secretaria: 'Secretaria',
  recepcion:  'Recepción',
};

// ── Lista ────────────────────────────────────────────────────────
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { buscar, rol, area_id } = req.query;
    let where = '1=1';
    const params = [];
    if (buscar) {
      where += ' AND (u.nombre LIKE ? OR u.username LIKE ? OR u.cargo LIKE ?)';
      params.push(`%${buscar}%`, `%${buscar}%`, `%${buscar}%`);
    }
    if (rol)     { where += ' AND u.rol=?';     params.push(rol); }
    if (area_id) { where += ' AND u.area_id=?'; params.push(area_id); }

    const usuarios = await query(`
      SELECT u.*, a.nombre as area_nombre
      FROM usuarios u
      LEFT JOIN areas a ON u.area_id = a.id
      WHERE ${where}
      ORDER BY u.activo DESC, u.nombre ASC
    `, params);

    const areas = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');

    res.render('usuarios/lista', {
      titulo: 'Gestión de Usuarios',
      usuarios, areas, ROLES,
      filtros: { buscar, rol, area_id },
    });
  } catch (err) { next(err); }
});

// ── Nuevo ────────────────────────────────────────────────────────
router.get('/nuevo', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const areas = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');
    res.render('usuarios/form', {
      titulo: 'Nuevo Usuario',
      usuarioEdit: null, areas, ROLES,
      accion: '/usuarios',
    });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { nombre, cargo, username, password, rol, area_id } = req.body;

    if (!password || password.trim().length < 6) {
      req.flash('error', 'La contraseña debe tener al menos 6 caracteres');
      return res.redirect('/usuarios/nuevo');
    }

    const existe = await query('SELECT id FROM usuarios WHERE username=?', [username]);
    if (existe.length > 0) {
      req.flash('error', 'El nombre de usuario ya está en uso');
      return res.redirect('/usuarios/nuevo');
    }

    const hash = bcrypt.hashSync(password, 10);
    await query(
      'INSERT INTO usuarios (nombre, cargo, username, password_hash, rol, area_id) VALUES (?,?,?,?,?,?)',
      [nombre, cargo || null, username, hash, rol, area_id || null]
    );

    req.flash('success', `Usuario "${username}" creado correctamente`);
    res.redirect('/usuarios');
  } catch (err) { next(err); }
});

// ── Editar ───────────────────────────────────────────────────────
router.get('/:id/editar', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [usuarioEdit] = await query('SELECT * FROM usuarios WHERE id=?', [req.params.id]);
    if (!usuarioEdit) { req.flash('error', 'Usuario no encontrado'); return res.redirect('/usuarios'); }
    const areas = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');
    res.render('usuarios/form', {
      titulo: 'Editar Usuario',
      usuarioEdit, areas, ROLES,
      accion: `/usuarios/${usuarioEdit.id}`,
    });
  } catch (err) { next(err); }
});

router.post('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { nombre, cargo, username, password, rol, area_id } = req.body;
    const id = req.params.id;

    const existe = await query('SELECT id FROM usuarios WHERE username=? AND id!=?', [username, id]);
    if (existe.length > 0) {
      req.flash('error', 'El nombre de usuario ya está en uso');
      return res.redirect(`/usuarios/${id}/editar`);
    }

    if (password && password.trim()) {
      if (password.trim().length < 6) {
        req.flash('error', 'La contraseña debe tener al menos 6 caracteres');
        return res.redirect(`/usuarios/${id}/editar`);
      }
      const hash = bcrypt.hashSync(password, 10);
      await query(
        'UPDATE usuarios SET nombre=?, cargo=?, username=?, password_hash=?, rol=?, area_id=? WHERE id=?',
        [nombre, cargo || null, username, hash, rol, area_id || null, id]
      );
    } else {
      await query(
        'UPDATE usuarios SET nombre=?, cargo=?, username=?, rol=?, area_id=? WHERE id=?',
        [nombre, cargo || null, username, rol, area_id || null, id]
      );
    }

    if (String(req.session.usuario.id) === String(id)) {
      req.session.usuario.nombre = nombre;
      req.session.usuario.cargo  = cargo;
      req.session.usuario.rol    = rol;
    }

    req.flash('success', 'Usuario actualizado correctamente');
    res.redirect('/usuarios');
  } catch (err) { next(err); }
});

// ── Activar / Desactivar ─────────────────────────────────────────
router.post('/:id/toggle', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [u] = await query('SELECT * FROM usuarios WHERE id=?', [req.params.id]);
    if (!u) { req.flash('error', 'Usuario no encontrado'); return res.redirect('/usuarios'); }

    if (String(u.id) === String(req.session.usuario.id)) {
      req.flash('error', 'No puedes desactivar tu propia cuenta');
      return res.redirect('/usuarios');
    }

    await query('UPDATE usuarios SET activo=? WHERE id=?', [u.activo ? 0 : 1, u.id]);
    req.flash('success', `Usuario ${u.activo ? 'desactivado' : 'activado'} correctamente`);
    res.redirect('/usuarios');
  } catch (err) { next(err); }
});

module.exports = router;
