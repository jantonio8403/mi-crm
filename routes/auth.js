const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query } = require('../database/db');

router.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect('/dashboard');
  res.render('auth/login', { titulo: 'Iniciar Sesión' });
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const usuarios = await query('SELECT * FROM usuarios WHERE username = ? AND activo = 1', [username]);
    const usuario = usuarios[0];

    if (!usuario || !bcrypt.compareSync(password, usuario.password_hash)) {
      req.flash('error', 'Usuario o contraseña incorrectos');
      return res.redirect('/login');
    }

    const areas = usuario.area_id
      ? await query('SELECT nombre FROM areas WHERE id = ?', [usuario.area_id])
      : [];

    req.session.usuario = {
      id: usuario.id,
      nombre: usuario.nombre,
      cargo: usuario.cargo,
      username: usuario.username,
      rol: usuario.rol,
      area_id: usuario.area_id,
      area_nombre: areas[0] ? areas[0].nombre : 'Sin área',
    };

    res.redirect('/dashboard');
  } catch (err) {
    req.flash('error', 'Error al iniciar sesión');
    res.redirect('/login');
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

module.exports = router;
