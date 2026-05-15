const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query } = require('../database/db');
const { requireAuth } = require('../controllers/authMiddleware');

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const [usuario_db] = await query(
      `SELECT u.*, a.nombre as area_nombre
       FROM usuarios u LEFT JOIN areas a ON u.area_id = a.id
       WHERE u.id=?`, [req.session.usuario.id]
    );
    res.render('perfil', { titulo: 'Mi Perfil', usuario_db });
  } catch (err) { next(err); }
});

router.post('/password', async (req, res, next) => {
  try {
    const { password_actual, password_nuevo, password_confirm } = req.body;

    if (!password_actual || !password_nuevo || !password_confirm) {
      req.flash('error', 'Todos los campos de contraseña son requeridos');
      return res.redirect('/perfil');
    }
    if (password_nuevo.length < 6) {
      req.flash('error', 'La nueva contraseña debe tener al menos 6 caracteres');
      return res.redirect('/perfil');
    }
    if (password_nuevo !== password_confirm) {
      req.flash('error', 'La nueva contraseña y su confirmación no coinciden');
      return res.redirect('/perfil');
    }

    const [usuario_db] = await query('SELECT password_hash FROM usuarios WHERE id=?', [req.session.usuario.id]);
    const ok = bcrypt.compareSync(password_actual, usuario_db.password_hash);
    if (!ok) {
      req.flash('error', 'La contraseña actual es incorrecta');
      return res.redirect('/perfil');
    }

    const nuevo_hash = bcrypt.hashSync(password_nuevo, 10);
    await query('UPDATE usuarios SET password_hash=? WHERE id=?', [nuevo_hash, req.session.usuario.id]);
    req.flash('success', 'Contraseña actualizada correctamente');
    res.redirect('/perfil');
  } catch (err) { next(err); }
});

module.exports = router;
