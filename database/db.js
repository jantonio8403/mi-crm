const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
});

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function initDB() {
  await query(`CREATE TABLE IF NOT EXISTS areas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    responsable VARCHAR(100),
    activa TINYINT(1) DEFAULT 1
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await query(`CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    cargo VARCHAR(100),
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    area_id INT,
    rol ENUM('admin','usuario') NOT NULL DEFAULT 'usuario',
    activo TINYINT(1) DEFAULT 1,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (area_id) REFERENCES areas(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await query(`CREATE TABLE IF NOT EXISTS documentos_salientes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tipo ENUM('oficio','memorandum') NOT NULL,
    numero_folio VARCHAR(30) NOT NULL UNIQUE,
    consecutivo INT NOT NULL,
    anio INT NOT NULL,
    fecha_emision DATE NOT NULL,
    asunto TEXT NOT NULL,
    destinatario VARCHAR(200) NOT NULL,
    cargo_destinatario VARCHAR(200),
    institucion_destinatario VARCHAR(200),
    contenido LONGTEXT NOT NULL,
    area_emisora_id INT,
    elaborado_por_id INT,
    estatus ENUM('borrador','firmado','enviado','archivado') NOT NULL DEFAULT 'borrador',
    ruta_pdf VARCHAR(255),
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (area_emisora_id) REFERENCES areas(id),
    FOREIGN KEY (elaborado_por_id) REFERENCES usuarios(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await query(`CREATE TABLE IF NOT EXISTS correspondencia_entrante (
    id INT AUTO_INCREMENT PRIMARY KEY,
    folio_externo VARCHAR(100),
    tipo ENUM('oficio','memorandum','circular','oficio-circular','dictamen','otro') NOT NULL DEFAULT 'oficio',
    fecha_recepcion DATE NOT NULL,
    fecha_documento DATE,
    remitente_nombre VARCHAR(200) NOT NULL,
    remitente_cargo VARCHAR(200),
    remitente_institucion VARCHAR(200) NOT NULL,
    asunto TEXT NOT NULL,
    descripcion TEXT,
    area_destinataria_id INT,
    estatus ENUM('recibido','en_proceso','atendido','archivado') NOT NULL DEFAULT 'recibido',
    requiere_respuesta TINYINT(1) DEFAULT 0,
    fecha_limite_respuesta DATE,
    ruta_archivo VARCHAR(255),
    notas TEXT,
    registrado_por_id INT,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (area_destinataria_id) REFERENCES areas(id),
    FOREIGN KEY (registrado_por_id) REFERENCES usuarios(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Datos iniciales solo si las tablas están vacías
  const [countRow] = await query('SELECT COUNT(*) as c FROM areas');
  if (countRow.c === 0) {
    const areasList = [
      ['Dirección', 'Director General'],
      ['Administración', 'Administrador'],
      ['Enfermería', 'Jefe de Enfermeras'],
      ['Consulta Externa', 'Médico Responsable'],
      ['Urgencias', 'Médico de Urgencias'],
      ['Laboratorio', 'Químico Responsable'],
      ['Trabajo Social', 'Trabajadora Social'],
      ['Farmacia', 'Responsable de Farmacia'],
    ];
    for (const [nombre, responsable] of areasList) {
      await query('INSERT INTO areas (nombre, responsable) VALUES (?, ?)', [nombre, responsable]);
    }
    const [dirArea] = await query("SELECT id FROM areas WHERE nombre = 'Dirección'");
    const hash = bcrypt.hashSync('Admin2026', 10);
    await query(
      'INSERT INTO usuarios (nombre, cargo, username, password_hash, area_id, rol) VALUES (?, ?, ?, ?, ?, ?)',
      ['Administrador del Sistema', 'Administrador', 'admin', hash, dirArea.id, 'admin']
    );
  }
}

module.exports = { query, initDB };
