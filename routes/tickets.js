const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { requireAuth } = require('../controllers/authMiddleware');

const CATEGORIAS = {
  informatica:          'Informática',
  servicios_generales:  'Servicios Generales',
  recursos_materiales:  'Recursos Materiales',
  mantenimiento:        'Mantenimiento',
  otro:                 'Otro',
};

const PRIORIDADES = {
  baja:    { label: 'Baja',    color: '#6b7280' },
  media:   { label: 'Media',   color: '#d97706' },
  alta:    { label: 'Alta',    color: '#dc2626' },
  urgente: { label: 'Urgente', color: '#7c3aed' },
};

const ROLES_ADMIN = ['admin', 'director'];

function puedeAsignar(u) {
  return ROLES_ADMIN.includes(u.rol);
}
function puedeCambiarEstatus(u, ticket) {
  if (ROLES_ADMIN.includes(u.rol)) return true;
  if (u.rol === 'jefe_area') return ticket.area_asignada_id == u.area_id || ticket.area_solicitante_id == u.area_id;
  return false;
}
function puedeEditar(u, ticket) {
  if (ROLES_ADMIN.includes(u.rol)) return true;
  if (u.rol === 'jefe_area' && ['abierto','en_proceso'].includes(ticket.estatus))
    return ticket.area_asignada_id == u.area_id || ticket.area_solicitante_id == u.area_id;
  return false;
}

async function siguienteFolioTicket() {
  const anio = new Date().getFullYear();
  const [row] = await query('SELECT MAX(consecutivo) as max FROM tickets WHERE anio=?', [anio]);
  const siguiente = (row.max || 0) + 1;
  return { consecutivo: siguiente, anio, folio: `TKT/${anio}/${String(siguiente).padStart(4, '0')}` };
}

// ── Lista ────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { estatus, prioridad, categoria, area, buscar, page = 1 } = req.query;
    const limit = 15;
    const offset = (parseInt(page) - 1) * limit;
    const u = req.session.usuario;

    let where = '1=1';
    const params = [];

    // Restricción por rol
    if (!['admin','director'].includes(u.rol) && u.area_id) {
      where += ' AND (t.area_solicitante_id=? OR t.area_asignada_id=?)';
      params.push(u.area_id, u.area_id);
    }

    if (estatus)   { where += ' AND t.estatus=?';                           params.push(estatus); }
    if (prioridad) { where += ' AND t.prioridad=?';                         params.push(prioridad); }
    if (categoria) { where += ' AND t.categoria=?';                         params.push(categoria); }
    if (area)      { where += ' AND (t.area_solicitante_id=? OR t.area_asignada_id=?)'; params.push(area, area); }
    if (buscar)    {
      where += ' AND (t.folio LIKE ? OR t.titulo LIKE ?)';
      params.push(`%${buscar}%`, `%${buscar}%`);
    }

    const [totalRow] = await query(`SELECT COUNT(*) as c FROM tickets t WHERE ${where}`, params);
    const total = totalRow.c;

    const tickets = await query(`
      SELECT t.*,
             as1.nombre as area_sol_nombre, as2.nombre as area_asig_nombre,
             u.nombre as solicitante_nombre
      FROM tickets t
      LEFT JOIN areas as1 ON t.area_solicitante_id = as1.id
      LEFT JOIN areas as2 ON t.area_asignada_id = as2.id
      LEFT JOIN usuarios u ON t.usuario_solicitante_id = u.id
      WHERE ${where}
      ORDER BY FIELD(t.prioridad,'urgente','alta','media','baja'),
               FIELD(t.estatus,'abierto','en_proceso','resuelto','cerrado'),
               t.creado_en DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    // Estadísticas rápidas
    const [statsRows] = await Promise.all([
      query(`SELECT estatus, COUNT(*) as c FROM tickets t WHERE 1=1 ${!['admin','director'].includes(u.rol) && u.area_id ? 'AND (area_solicitante_id=? OR area_asignada_id=?)' : ''} GROUP BY estatus`,
        !['admin','director'].includes(u.rol) && u.area_id ? [u.area_id, u.area_id] : []),
    ]);

    const stats = { abierto:0, en_proceso:0, resuelto:0, cerrado:0 };
    statsRows.forEach(r => { stats[r.estatus] = r.c; });

    const areas = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');

    res.render('tickets/lista', {
      titulo: 'Tickets', tickets, areas, stats,
      CATEGORIAS, PRIORIDADES,
      filtros: { estatus, prioridad, categoria, area, buscar },
      paginacion: { page: parseInt(page), total, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

// ── Nuevo ────────────────────────────────────────────────────────
router.get('/nuevo', requireAuth, async (req, res, next) => {
  try {
    const u = req.session.usuario;
    const areas = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');
    const folio = await siguienteFolioTicket();
    res.render('tickets/form', {
      titulo: 'Nuevo Ticket', ticket: null, areas, folio, CATEGORIAS, PRIORIDADES,
      accion: '/tickets',
      canElegirAreas: puedeAsignar(u),
    });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const u = req.session.usuario;
    const { titulo, descripcion, categoria, prioridad, fecha_limite } = req.body;
    let { area_solicitante_id, area_asignada_id } = req.body;

    if (!puedeAsignar(u)) {
      area_solicitante_id = u.area_id || null;
      area_asignada_id = null;
    }

    const { consecutivo, anio, folio } = await siguienteFolioTicket();

    const result = await query(
      `INSERT INTO tickets (folio, consecutivo, anio, titulo, descripcion, categoria, prioridad,
       area_solicitante_id, area_asignada_id, usuario_solicitante_id, fecha_limite)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [folio, consecutivo, anio, titulo, descripcion, categoria, prioridad,
       area_solicitante_id || null, area_asignada_id || null,
       u.id, fecha_limite || null]
    );

    await query(
      `INSERT INTO ticket_comentarios (ticket_id, usuario_id, comentario, tipo) VALUES (?,?,?,?)`,
      [result.insertId, u.id, `Ticket creado con prioridad ${PRIORIDADES[prioridad].label}`, 'cambio_estado']
    );

    req.flash('success', `Ticket ${folio} creado correctamente`);
    res.redirect(`/tickets/${result.insertId}`);
  } catch (err) { next(err); }
});

// ── Detalle ──────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const [ticket] = await query(`
      SELECT t.*,
             as1.nombre as area_sol_nombre, as2.nombre as area_asig_nombre,
             us.nombre as solicitante_nombre,
             ua.nombre as asignado_nombre
      FROM tickets t
      LEFT JOIN areas as1 ON t.area_solicitante_id = as1.id
      LEFT JOIN areas as2 ON t.area_asignada_id = as2.id
      LEFT JOIN usuarios us ON t.usuario_solicitante_id = us.id
      LEFT JOIN usuarios ua ON t.usuario_asignado_id = ua.id
      WHERE t.id=?`, [req.params.id]
    );
    if (!ticket) { req.flash('error', 'Ticket no encontrado'); return res.redirect('/tickets'); }

    const comentarios = await query(`
      SELECT tc.*, u.nombre as usuario_nombre, u.rol as usuario_rol
      FROM ticket_comentarios tc
      JOIN usuarios u ON tc.usuario_id = u.id
      WHERE tc.ticket_id=?
      ORDER BY tc.creado_en ASC`, [req.params.id]
    );

    const areas    = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');
    const usuarios = await query('SELECT id, nombre, cargo FROM usuarios WHERE activo=1 ORDER BY nombre');
    const u = req.session.usuario;

    res.render('tickets/detalle', {
      titulo: `Ticket ${ticket.folio}`,
      ticket, comentarios, areas, usuarios, CATEGORIAS, PRIORIDADES,
      canAsignar: puedeAsignar(u),
      canCambiarEstatus: puedeCambiarEstatus(u, ticket),
      canEditar: puedeEditar(u, ticket),
    });
  } catch (err) { next(err); }
});

// ── Agregar comentario / cambiar estatus / asignar ───────────────
router.post('/:id/comentar', requireAuth, async (req, res, next) => {
  try {
    const { comentario } = req.body;
    if (!comentario || !comentario.trim()) return res.redirect(`/tickets/${req.params.id}`);
    await query(
      'INSERT INTO ticket_comentarios (ticket_id, usuario_id, comentario, tipo) VALUES (?,?,?,?)',
      [req.params.id, req.session.usuario.id, comentario, 'comentario']
    );
    res.redirect(`/tickets/${req.params.id}#comentarios`);
  } catch (err) { next(err); }
});

router.post('/:id/estatus', requireAuth, async (req, res, next) => {
  try {
    const u = req.session.usuario;
    const [ticket] = await query('SELECT * FROM tickets WHERE id=?', [req.params.id]);
    if (!ticket) return res.redirect('/tickets');
    if (!puedeCambiarEstatus(u, ticket)) {
      req.flash('error', 'No tienes permiso para cambiar el estatus de este ticket');
      return res.redirect(`/tickets/${req.params.id}`);
    }
    const { estatus } = req.body;
    await query('UPDATE tickets SET estatus=? WHERE id=?', [estatus, req.params.id]);
    await query(
      'INSERT INTO ticket_comentarios (ticket_id, usuario_id, comentario, tipo) VALUES (?,?,?,?)',
      [req.params.id, u.id, `Estatus cambiado de "${ticket.estatus}" a "${estatus}"`, 'cambio_estado']
    );
    req.flash('success', 'Estatus actualizado');
    res.redirect(`/tickets/${req.params.id}`);
  } catch (err) { next(err); }
});

router.post('/:id/asignar', requireAuth, async (req, res, next) => {
  try {
    if (!puedeAsignar(req.session.usuario)) {
      req.flash('error', 'No tienes permiso para asignar tickets');
      return res.redirect(`/tickets/${req.params.id}`);
    }
    const { area_asignada_id, usuario_asignado_id } = req.body;
    await query(
      'UPDATE tickets SET area_asignada_id=?, usuario_asignado_id=? WHERE id=?',
      [area_asignada_id || null, usuario_asignado_id || null, req.params.id]
    );
    const [area] = area_asignada_id
      ? await query('SELECT nombre FROM areas WHERE id=?', [area_asignada_id])
      : [null];
    await query(
      'INSERT INTO ticket_comentarios (ticket_id, usuario_id, comentario, tipo) VALUES (?,?,?,?)',
      [req.params.id, req.session.usuario.id,
       `Ticket asignado al área: ${area ? area.nombre : 'Sin área'}`, 'asignacion']
    );
    req.flash('success', 'Ticket asignado correctamente');
    res.redirect(`/tickets/${req.params.id}`);
  } catch (err) { next(err); }
});

// ── Editar ticket ────────────────────────────────────────────────
router.get('/:id/editar', requireAuth, async (req, res, next) => {
  try {
    const u = req.session.usuario;
    const [ticket] = await query('SELECT * FROM tickets WHERE id=?', [req.params.id]);
    if (!ticket) { req.flash('error', 'Ticket no encontrado'); return res.redirect('/tickets'); }
    if (!puedeEditar(u, ticket)) {
      req.flash('error', 'No tienes permiso para editar este ticket');
      return res.redirect(`/tickets/${req.params.id}`);
    }
    const areas = await query('SELECT * FROM areas WHERE activa=1 ORDER BY nombre');
    res.render('tickets/edit', {
      titulo: `Editar Ticket ${ticket.folio}`,
      ticket, areas, CATEGORIAS, PRIORIDADES,
      canElegirAreas: puedeAsignar(u),
    });
  } catch (err) { next(err); }
});

router.post('/:id/editar', requireAuth, async (req, res, next) => {
  try {
    const u = req.session.usuario;
    const [ticket] = await query('SELECT * FROM tickets WHERE id=?', [req.params.id]);
    if (!ticket || !puedeEditar(u, ticket)) {
      req.flash('error', 'No tienes permiso para editar este ticket');
      return res.redirect('/tickets');
    }
    const { titulo, descripcion, categoria, prioridad, area_solicitante_id, area_asignada_id, fecha_limite } = req.body;
    const [before] = await query('SELECT titulo, prioridad FROM tickets WHERE id=?', [req.params.id]);
    await query(
      `UPDATE tickets SET titulo=?, descripcion=?, categoria=?, prioridad=?,
       area_solicitante_id=?, area_asignada_id=?, fecha_limite=? WHERE id=?`,
      [titulo, descripcion, categoria, prioridad,
       area_solicitante_id || null, area_asignada_id || null,
       fecha_limite || null, req.params.id]
    );
    const cambios = [];
    if (before.titulo !== titulo) cambios.push(`título cambiado`);
    if (before.prioridad !== prioridad) cambios.push(`prioridad: ${before.prioridad} → ${prioridad}`);
    if (cambios.length) {
      await query(
        'INSERT INTO ticket_comentarios (ticket_id, usuario_id, comentario, tipo) VALUES (?,?,?,?)',
        [req.params.id, req.session.usuario.id, `Ticket editado: ${cambios.join(', ')}`, 'cambio_estado']
      );
    }
    req.flash('success', 'Ticket actualizado correctamente');
    res.redirect(`/tickets/${req.params.id}`);
  } catch (err) { next(err); }
});

module.exports = router;
