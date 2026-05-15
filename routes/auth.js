const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../database/db');

router.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect('/dashboard');
  res.render('auth/login', { titulo: 'Iniciar Sesión' });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const usuario = db.prepare('SELECT * FROM usuarios WHERE username = ? AND activo = 1').get(username);

  if (!usuario || !bcrypt.compareSync(password, usuario.password_hash)) {
    req.flash('error', 'Usuario o contraseña incorrectos');
    return res.redirect('/login');
  }

  const area = usuario.area_id
    ? db.prepare('SELECT nombre FROM areas WHERE id = ?').get(usuario.area_id)
    : null;

  req.session.usuario = {
    id: usuario.id,
    nombre: usuario.nombre,
    cargo: usuario.cargo,
    username: usuario.username,
    rol: usuario.rol,
    area_id: usuario.area_id,
    area_nombre: area ? area.nombre : 'Sin área',
  };

  res.redirect('/dashboard');
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

module.exports = router;
