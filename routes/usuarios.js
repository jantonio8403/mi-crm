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

// Funcionarios internos disponibles para vinculación
async function funcionariosDisponibles(excluirUsuarioId = null) {
  const params = [];
  let condicion = "f.tipo='interno' AND f.activo=1 AND (f.usuario_id IS NULL";
  if (excluirUsuarioId) {
    condicion += ' OR f.usuario_id=?';
    params.push(excluirUsuarioId);
  }
  condicion += ')';
  return query(
    `SELECT f.id, f.nombre, f.cargo, f.area_id, a.nombre as area_nombre
     FROM funcionarios f
     LEFT JOIN areas a ON f.area_id = a.id
     WHERE ${condicion}
     ORDER BY f.nombre`,
    params
  );
}

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
      SELECT u.*, a.nombre as area_nombre,
             f.id as funcionario_id, f.nombre as funcionario_nombre
      FROM usuarios u
      LEFT JOIN areas a ON u.area_id = a.id
      LEFT JOIN funcionarios f ON f.usuario_id = u.id
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
    const areas            = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');
    const funcionariosDisp = await funcionariosDisponibles();
    res.render('usuarios/form', {
      titulo: 'Nuevo Usuario',
      usuarioEdit: null, areas, ROLES, funcionariosDisp,
      linkedFuncionarioId: null,
      accion: '/usuarios',
    });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { funcionario_id, nombre, cargo, username, password, rol, area_id } = req.body;

    if (!password || password.trim().length < 6) {
      req.flash('error', 'La contraseña debe tener al menos 6 caracteres');
      return res.redirect('/usuarios/nuevo');
    }

    const existe = await query('SELECT id FROM usuarios WHERE username=?', [username]);
    if (existe.length > 0) {
      req.flash('error', 'El nombre de usuario ya está en uso');
      return res.redirect('/usuarios/nuevo');
    }

    const funcId = funcionario_id ? parseInt(funcionario_id) : null;
    let nombreFinal = nombre;
    let cargoFinal  = cargo || null;
    let areaIdFinal = area_id ? parseInt(area_id) : null;

    if (funcId) {
      const [func] = await query(
        "SELECT nombre, cargo, area_id FROM funcionarios WHERE id=? AND tipo='interno' AND activo=1 LIMIT 1",
        [funcId]
      );
      if (!func) {
        req.flash('error', 'El funcionario seleccionado no existe o no está activo');
        return res.redirect('/usuarios/nuevo');
      }
      const [yaVinc] = await query(
        'SELECT id FROM usuarios WHERE id=(SELECT usuario_id FROM funcionarios WHERE id=? AND usuario_id IS NOT NULL LIMIT 1)',
        [funcId]
      );
      if (yaVinc) {
        req.flash('error', 'Ese funcionario ya tiene una cuenta vinculada');
        return res.redirect('/usuarios/nuevo');
      }
      nombreFinal = func.nombre;
      cargoFinal  = func.cargo || null;
      areaIdFinal = func.area_id || null;
    }

    const hash   = bcrypt.hashSync(password.trim(), 10);
    const result = await query(
      'INSERT INTO usuarios (nombre, cargo, username, password_hash, rol, area_id) VALUES (?,?,?,?,?,?)',
      [nombreFinal, cargoFinal, username, hash, rol, areaIdFinal]
    );

    if (funcId) {
      await query('UPDATE funcionarios SET usuario_id=? WHERE id=?', [result.insertId, funcId]);
    }

    req.flash('success', `Usuario "${username}" creado correctamente`);
    res.redirect('/usuarios');
  } catch (err) { next(err); }
});

// ── Editar ───────────────────────────────────────────────────────
router.get('/:id/editar', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [usuarioEdit] = await query('SELECT * FROM usuarios WHERE id=?', [req.params.id]);
    if (!usuarioEdit) { req.flash('error', 'Usuario no encontrado'); return res.redirect('/usuarios'); }

    const [linkedFunc] = await query(
      'SELECT id FROM funcionarios WHERE usuario_id=? LIMIT 1',
      [req.params.id]
    );
    const linkedFuncionarioId = linkedFunc ? linkedFunc.id : null;

    const areas            = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');
    const funcionariosDisp = await funcionariosDisponibles(parseInt(req.params.id));

    res.render('usuarios/form', {
      titulo: 'Editar Usuario',
      usuarioEdit, areas, ROLES, funcionariosDisp, linkedFuncionarioId,
      accion: `/usuarios/${usuarioEdit.id}`,
    });
  } catch (err) { next(err); }
});

router.post('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { funcionario_id, nombre, cargo, username, password, rol, area_id } = req.body;
    const id = req.params.id;

    const existe = await query('SELECT id FROM usuarios WHERE username=? AND id!=?', [username, id]);
    if (existe.length > 0) {
      req.flash('error', 'El nombre de usuario ya está en uso');
      return res.redirect(`/usuarios/${id}/editar`);
    }

    // Funcionario actualmente vinculado
    const [currentLinked] = await query(
      'SELECT id FROM funcionarios WHERE usuario_id=? LIMIT 1', [id]
    );
    const currentFuncId = currentLinked ? currentLinked.id : null;

    const funcId = funcionario_id ? parseInt(funcionario_id) : null;
    let nombreFinal = nombre;
    let cargoFinal  = cargo || null;
    let areaIdFinal = area_id ? parseInt(area_id) : null;

    if (funcId) {
      const [func] = await query(
        "SELECT nombre, cargo, area_id FROM funcionarios WHERE id=? AND tipo='interno' AND activo=1 LIMIT 1",
        [funcId]
      );
      if (!func) {
        req.flash('error', 'El funcionario seleccionado no existe o no está activo');
        return res.redirect(`/usuarios/${id}/editar`);
      }
      nombreFinal = func.nombre;
      cargoFinal  = func.cargo || null;
      areaIdFinal = func.area_id || null;
    }

    if (password && password.trim()) {
      if (password.trim().length < 6) {
        req.flash('error', 'La contraseña debe tener al menos 6 caracteres');
        return res.redirect(`/usuarios/${id}/editar`);
      }
      const hash = bcrypt.hashSync(password.trim(), 10);
      await query(
        'UPDATE usuarios SET nombre=?, cargo=?, username=?, password_hash=?, rol=?, area_id=? WHERE id=?',
        [nombreFinal, cargoFinal, username, hash, rol, areaIdFinal, id]
      );
    } else {
      await query(
        'UPDATE usuarios SET nombre=?, cargo=?, username=?, rol=?, area_id=? WHERE id=?',
        [nombreFinal, cargoFinal, username, rol, areaIdFinal, id]
      );
    }

    // Gestionar vínculo con funcionario
    if (currentFuncId && currentFuncId !== funcId) {
      await query('UPDATE funcionarios SET usuario_id=NULL WHERE id=?', [currentFuncId]);
    }
    if (funcId && funcId !== currentFuncId) {
      await query('UPDATE funcionarios SET usuario_id=? WHERE id=?', [id, funcId]);
    }
    if (!funcId && currentFuncId) {
      await query('UPDATE funcionarios SET usuario_id=NULL WHERE id=?', [currentFuncId]);
    }

    // Actualizar sesión si es el usuario actual
    if (String(req.session.usuario.id) === String(id)) {
      req.session.usuario.nombre  = nombreFinal;
      req.session.usuario.cargo   = cargoFinal;
      req.session.usuario.rol     = rol;
      req.session.usuario.area_id = areaIdFinal;
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
