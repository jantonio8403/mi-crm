const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { requireAuth } = require('../controllers/authMiddleware');

router.get('/', requireAuth, (req, res) => {
  const anio = new Date().getFullYear();

  const stats = {
    oficios_emitidos: db.prepare("SELECT COUNT(*) as c FROM documentos_salientes WHERE tipo='oficio' AND anio=?").get(anio).c,
    memorandums_emitidos: db.prepare("SELECT COUNT(*) as c FROM documentos_salientes WHERE tipo='memorandum' AND anio=?").get(anio).c,
    entrante_recibidos: db.prepare("SELECT COUNT(*) as c FROM correspondencia_entrante WHERE strftime('%Y', fecha_recepcion)=?").get(String(anio)).c,
    entrante_pendientes: db.prepare("SELECT COUNT(*) as c FROM correspondencia_entrante WHERE estatus IN ('recibido','en_proceso')").get().c,
    entrante_urgentes: db.prepare(`
      SELECT COUNT(*) as c FROM correspondencia_entrante
      WHERE requiere_respuesta=1 AND estatus NOT IN ('atendido','archivado')
      AND fecha_limite_respuesta IS NOT NULL AND fecha_limite_respuesta <= date('now','+3 days')
    `).get().c,
  };

  const recientes_salientes = db.prepare(`
    SELECT ds.*, a.nombre as area_nombre
    FROM documentos_salientes ds
    LEFT JOIN areas a ON ds.area_emisora_id = a.id
    ORDER BY ds.creado_en DESC LIMIT 5
  `).all();

  const recientes_entrantes = db.prepare(`
    SELECT ce.*, a.nombre as area_nombre
    FROM correspondencia_entrante ce
    LEFT JOIN areas a ON ce.area_destinataria_id = a.id
    ORDER BY ce.creado_en DESC LIMIT 5
  `).all();

  const urgentes = db.prepare(`
    SELECT ce.*, a.nombre as area_nombre
    FROM correspondencia_entrante ce
    LEFT JOIN areas a ON ce.area_destinataria_id = a.id
    WHERE ce.requiere_respuesta=1 AND ce.estatus NOT IN ('atendido','archivado')
    AND ce.fecha_limite_respuesta IS NOT NULL AND ce.fecha_limite_respuesta <= date('now','+3 days')
    ORDER BY ce.fecha_limite_respuesta ASC LIMIT 5
  `).all();

  res.render('dashboard/index', {
    titulo: 'Dashboard',
    stats,
    recientes_salientes,
    recientes_entrantes,
    urgentes,
  });
});

module.exports = router;
