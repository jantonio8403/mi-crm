const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { requireAuth } = require('../controllers/authMiddleware');

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const anio = new Date().getFullYear();
    const u = req.session.usuario;

    // Filtro de tickets según rol
    const esGlobal = ['admin', 'director'].includes(u.rol);
    const ticketWhere = esGlobal ? '' : 'AND (area_solicitante_id=? OR area_asignada_id=?)';
    const ticketParams = esGlobal ? [] : [u.area_id, u.area_id];

    const [
      [oficiosRow], [memoraRow], [entranteRow], [pendientesRow], [corrUrgentesRow],
      [tkAbiertosRow], [tkProcRow], [tkUrgentesRow],
    ] = await Promise.all([
      query("SELECT COUNT(*) as c FROM documentos_salientes WHERE tipo='oficio' AND anio=?", [anio]),
      query("SELECT COUNT(*) as c FROM documentos_salientes WHERE tipo='memorandum' AND anio=?", [anio]),
      query("SELECT COUNT(*) as c FROM correspondencia_entrante WHERE YEAR(fecha_recepcion)=?", [anio]),
      query("SELECT COUNT(*) as c FROM correspondencia_entrante WHERE estatus IN ('recibido','en_proceso')"),
      query(`SELECT COUNT(*) as c FROM correspondencia_entrante
             WHERE requiere_respuesta=1 AND estatus NOT IN ('atendido','archivado')
             AND fecha_limite_respuesta IS NOT NULL
             AND fecha_limite_respuesta <= DATE_ADD(CURDATE(), INTERVAL 3 DAY)`),
      query(`SELECT COUNT(*) as c FROM tickets WHERE estatus='abierto' ${ticketWhere}`, ticketParams),
      query(`SELECT COUNT(*) as c FROM tickets WHERE estatus='en_proceso' ${ticketWhere}`, ticketParams),
      query(`SELECT COUNT(*) as c FROM tickets WHERE prioridad='urgente' AND estatus NOT IN ('resuelto','cerrado') ${ticketWhere}`, ticketParams),
    ]);

    const stats = {
      oficios_emitidos:     oficiosRow.c,
      memorandums_emitidos: memoraRow.c,
      entrante_recibidos:   entranteRow.c,
      entrante_pendientes:  pendientesRow.c,
      entrante_urgentes:    corrUrgentesRow.c,
      tickets_abiertos:     tkAbiertosRow.c,
      tickets_en_proceso:   tkProcRow.c,
      tickets_urgentes:     tkUrgentesRow.c,
    };

    const [recientes_salientes, recientes_entrantes, urgentes, tickets_recientes] = await Promise.all([
      query(`SELECT ds.*, a.nombre as area_nombre
             FROM documentos_salientes ds
             LEFT JOIN areas a ON ds.area_emisora_id = a.id
             ORDER BY ds.creado_en DESC LIMIT 5`),
      query(`SELECT ce.*, a.nombre as area_nombre
             FROM correspondencia_entrante ce
             LEFT JOIN areas a ON ce.area_destinataria_id = a.id
             ORDER BY ce.creado_en DESC LIMIT 5`),
      query(`SELECT ce.*, a.nombre as area_nombre
             FROM correspondencia_entrante ce
             LEFT JOIN areas a ON ce.area_destinataria_id = a.id
             WHERE ce.requiere_respuesta=1 AND ce.estatus NOT IN ('atendido','archivado')
             AND ce.fecha_limite_respuesta IS NOT NULL
             AND ce.fecha_limite_respuesta <= DATE_ADD(CURDATE(), INTERVAL 3 DAY)
             ORDER BY ce.fecha_limite_respuesta ASC LIMIT 5`),
      query(`SELECT t.*, as1.nombre as area_sol_nombre, as2.nombre as area_asig_nombre
             FROM tickets t
             LEFT JOIN areas as1 ON t.area_solicitante_id = as1.id
             LEFT JOIN areas as2 ON t.area_asignada_id = as2.id
             WHERE t.estatus IN ('abierto','en_proceso') ${ticketWhere}
             ORDER BY FIELD(t.prioridad,'urgente','alta','media','baja'), t.creado_en DESC
             LIMIT 5`, ticketParams),
    ]);

    res.render('dashboard/index', {
      titulo: 'Dashboard',
      stats,
      recientes_salientes,
      recientes_entrantes,
      urgentes,
      tickets_recientes,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
