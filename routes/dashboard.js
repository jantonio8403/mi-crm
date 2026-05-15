const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { requireAuth } = require('../controllers/authMiddleware');

router.get('/', requireAuth, async (req, res) => {
  try {
    const anio = new Date().getFullYear();

    const [
      [oficiosRow], [memoraRow], [entranteRow], [pendientesRow], [urgentesRow]
    ] = await Promise.all([
      query("SELECT COUNT(*) as c FROM documentos_salientes WHERE tipo='oficio' AND anio=?", [anio]),
      query("SELECT COUNT(*) as c FROM documentos_salientes WHERE tipo='memorandum' AND anio=?", [anio]),
      query("SELECT COUNT(*) as c FROM correspondencia_entrante WHERE YEAR(fecha_recepcion)=?", [anio]),
      query("SELECT COUNT(*) as c FROM correspondencia_entrante WHERE estatus IN ('recibido','en_proceso')"),
      query(`SELECT COUNT(*) as c FROM correspondencia_entrante
             WHERE requiere_respuesta=1 AND estatus NOT IN ('atendido','archivado')
             AND fecha_limite_respuesta IS NOT NULL
             AND fecha_limite_respuesta <= DATE_ADD(CURDATE(), INTERVAL 3 DAY)`),
    ]);

    const stats = {
      oficios_emitidos: oficiosRow.c,
      memorandums_emitidos: memoraRow.c,
      entrante_recibidos: entranteRow.c,
      entrante_pendientes: pendientesRow.c,
      entrante_urgentes: urgentesRow.c,
    };

    const [recientes_salientes, recientes_entrantes, urgentes] = await Promise.all([
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
    ]);

    res.render('dashboard/index', {
      titulo: 'Dashboard',
      stats,
      recientes_salientes,
      recientes_entrantes,
      urgentes,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
