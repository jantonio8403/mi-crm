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

    // Si el usuario está vinculado a un funcionario interno, sus datos
    // (nombre, cargo, área) se toman del directorio — fuente de verdad única
    const [funcVinculado] = await query(
      `SELECT f.nombre, f.cargo, f.area_id
       FROM funcionarios f
       WHERE f.usuario_id=? AND f.tipo='interno' AND f.activo=1 LIMIT 1`,
      [usuario.id]
    );

    const nombre  = funcVinculado ? funcVinculado.nombre  : usuario.nombre;
    const cargo   = funcVinculado ? funcVinculado.cargo   : usuario.cargo;
    const area_id = funcVinculado ? funcVinculado.area_id : usuario.area_id;

    const areas = area_id
      ? await query('SELECT nombre FROM areas WHERE id = ?', [area_id])
      : [];

    req.session.usuario = {
      id:          usuario.id,
      nombre,
      cargo,
      username:    usuario.username,
      rol:         usuario.rol,
      area_id,
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
