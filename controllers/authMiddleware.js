function requireAuth(req, res, next) {
  if (!req.session.usuario) {
    req.flash('error', 'Debes iniciar sesión para acceder');
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.usuario || req.session.usuario.rol !== 'admin') {
    req.flash('error', 'No tienes permisos para esta acción');
    return res.redirect('/dashboard');
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
