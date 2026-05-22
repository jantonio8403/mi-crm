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

  // Migrar: agregar columna descripcion a areas
  const [descCol] = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='areas' AND COLUMN_NAME='descripcion'`
  );
  if (!descCol) {
    await query(`ALTER TABLE areas ADD COLUMN descripcion VARCHAR(255) NULL AFTER nombre`);
  }

  // Migrar: agregar columna codigo a areas
  const [codigoCol] = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='areas' AND COLUMN_NAME='codigo'`
  );
  if (!codigoCol) {
    await query(`ALTER TABLE areas ADD COLUMN codigo VARCHAR(10) NULL AFTER nombre`);
    // Asignar códigos predeterminados a las áreas del hospital
    const codigosDefault = {
      'Dirección':        'DIR',
      'Administración':   'ADM',
      'Enfermería':       'ENF',
      'Consulta Externa': 'COE',
      'Urgencias':        'URG',
      'Laboratorio':      'LAB',
      'Trabajo Social':   'TRS',
      'Farmacia':         'FAR',
    };
    for (const [nombre, codigo] of Object.entries(codigosDefault)) {
      await query('UPDATE areas SET codigo=? WHERE nombre=? AND codigo IS NULL', [codigo, nombre]);
    }
  }

  // Migrar columna rol si aún tiene valores viejos
  const [colInfo] = await query(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'rol'`
  );
  if (colInfo && !colInfo.COLUMN_TYPE.includes('jefe_area')) {
    await query(`UPDATE usuarios SET rol='secretaria' WHERE rol NOT IN ('admin','director','jefe_area','secretaria','recepcion')`);
    await query(`ALTER TABLE usuarios MODIFY COLUMN rol ENUM('admin','director','jefe_area','secretaria','recepcion') NOT NULL DEFAULT 'secretaria'`);
  }

  // Migrar: agregar campos firmante y leido_en a documentos_salientes
  const [firmantCol] = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='documentos_salientes' AND COLUMN_NAME='firmante_nombre'`
  );
  if (!firmantCol) {
    await query(`ALTER TABLE documentos_salientes
      ADD COLUMN firmante_nombre VARCHAR(150) NULL AFTER contenido,
      ADD COLUMN firmante_cargo  VARCHAR(150) NULL AFTER firmante_nombre,
      ADD COLUMN leido_en        DATETIME     NULL AFTER firmante_cargo`);
  }

  // Tablas de tickets
  await query(`CREATE TABLE IF NOT EXISTS tickets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    folio VARCHAR(20) NOT NULL UNIQUE,
    consecutivo INT NOT NULL,
    anio INT NOT NULL,
    titulo VARCHAR(200) NOT NULL,
    descripcion TEXT NOT NULL,
    categoria ENUM('informatica','servicios_generales','recursos_materiales','mantenimiento','otro') NOT NULL,
    prioridad ENUM('baja','media','alta','urgente') NOT NULL DEFAULT 'media',
    estatus ENUM('abierto','en_proceso','resuelto','cerrado') NOT NULL DEFAULT 'abierto',
    area_solicitante_id INT,
    area_asignada_id INT,
    usuario_solicitante_id INT,
    usuario_asignado_id INT,
    fecha_limite DATE,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (area_solicitante_id) REFERENCES areas(id),
    FOREIGN KEY (area_asignada_id) REFERENCES areas(id),
    FOREIGN KEY (usuario_solicitante_id) REFERENCES usuarios(id),
    FOREIGN KEY (usuario_asignado_id) REFERENCES usuarios(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await query(`CREATE TABLE IF NOT EXISTS ticket_comentarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    usuario_id INT NOT NULL,
    comentario TEXT NOT NULL,
    tipo ENUM('comentario','cambio_estado','asignacion') NOT NULL DEFAULT 'comentario',
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Tabla de funcionarios (internos y externos)
  await query(`CREATE TABLE IF NOT EXISTS funcionarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    cargo VARCHAR(150),
    tipo ENUM('interno','externo') NOT NULL DEFAULT 'externo',
    institucion VARCHAR(200),
    area_id INT,
    email VARCHAR(100),
    telefono VARCHAR(30),
    activo TINYINT(1) DEFAULT 1,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (area_id) REFERENCES areas(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Migrar: agregar atencion_a y atencion_a_cargo en documentos_salientes
  const [atencionCol] = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='documentos_salientes' AND COLUMN_NAME='atencion_a'`
  );
  if (!atencionCol) {
    await query(`ALTER TABLE documentos_salientes ADD COLUMN atencion_a VARCHAR(200) NULL AFTER institucion_destinatario`);
  }
  const [atencionCargoCol] = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='documentos_salientes' AND COLUMN_NAME='atencion_a_cargo'`
  );
  if (!atencionCargoCol) {
    await query(`ALTER TABLE documentos_salientes ADD COLUMN atencion_a_cargo VARCHAR(200) NULL AFTER atencion_a`);
  }

  // Migrar: agregar Vo. Bo. y Elaboró en documentos_salientes
  const [vbCol] = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='documentos_salientes' AND COLUMN_NAME='vobo_nombre'`
  );
  if (!vbCol) {
    await query(`ALTER TABLE documentos_salientes
      ADD COLUMN vobo_nombre   VARCHAR(150) NULL AFTER firmante_cargo,
      ADD COLUMN vobo_cargo    VARCHAR(150) NULL AFTER vobo_nombre,
      ADD COLUMN elaboro_nombre VARCHAR(150) NULL AFTER vobo_cargo,
      ADD COLUMN elaboro_cargo  VARCHAR(150) NULL AFTER elaboro_nombre`);
  }

  // Tabla copias de documento (C.c.p.)
  await query(`CREATE TABLE IF NOT EXISTS documento_copias (
    id INT AUTO_INCREMENT PRIMARY KEY,
    documento_id INT NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    cargo VARCHAR(150),
    orden INT DEFAULT 0,
    FOREIGN KEY (documento_id) REFERENCES documentos_salientes(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Migrar: agregar usuario_id (FK a usuarios) en funcionarios
  const [usuIdCol] = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='funcionarios' AND COLUMN_NAME='usuario_id'`
  );
  if (!usuIdCol) {
    await query(`ALTER TABLE funcionarios ADD COLUMN usuario_id INT NULL UNIQUE AFTER area_id`);
    await query(`ALTER TABLE funcionarios ADD CONSTRAINT fk_funcionarios_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL`);
  }

  // Migrar: agregar responsable_id (FK a funcionarios) en areas
  const [respIdCol] = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='areas' AND COLUMN_NAME='responsable_id'`
  );
  if (!respIdCol) {
    await query(`ALTER TABLE areas ADD COLUMN responsable_id INT NULL AFTER responsable`);
    await query(`ALTER TABLE areas ADD CONSTRAINT fk_areas_responsable_id FOREIGN KEY (responsable_id) REFERENCES funcionarios(id) ON DELETE SET NULL`);
  }

  // Migrar: agregar respondido_con_id en correspondencia_entrante
  const [respConIdCol] = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='correspondencia_entrante' AND COLUMN_NAME='respondido_con_id'`
  );
  if (!respConIdCol) {
    await query(`ALTER TABLE correspondencia_entrante ADD COLUMN respondido_con_id INT NULL AFTER notas`);
    await query(`ALTER TABLE correspondencia_entrante ADD CONSTRAINT fk_entrante_respondido FOREIGN KEY (respondido_con_id) REFERENCES documentos_salientes(id) ON DELETE SET NULL`);
  }

  // Migrar: agregar 'circular' al ENUM tipo de documentos_salientes
  const [tipoEnumInfo] = await query(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='documentos_salientes' AND COLUMN_NAME='tipo'`
  );
  if (tipoEnumInfo && !tipoEnumInfo.COLUMN_TYPE.includes('circular')) {
    await query(`ALTER TABLE documentos_salientes
      MODIFY COLUMN tipo ENUM('oficio','memorandum','circular') NOT NULL`);
  }

  // Tablas de resguardos de inventario
  await query(`CREATE TABLE IF NOT EXISTS resguardos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    folio VARCHAR(20) NOT NULL UNIQUE,
    consecutivo INT NOT NULL,
    anio INT NOT NULL,
    resguardante VARCHAR(200) NOT NULL,
    estado ENUM('pendiente','firmado') NOT NULL DEFAULT 'pendiente',
    notas TEXT NULL,
    archivo_firmado VARCHAR(255) NULL,
    creado_por_id INT NOT NULL,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
    firmado_en DATETIME NULL,
    FOREIGN KEY (creado_por_id) REFERENCES usuarios(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await query(`CREATE TABLE IF NOT EXISTS resguardo_bienes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    resguardo_id INT NOT NULL,
    bien_id INT NOT NULL,
    numero_inventario VARCHAR(50) NOT NULL,
    nombre VARCHAR(200) NOT NULL,
    categoria VARCHAR(50) NOT NULL,
    area_nombre VARCHAR(100) NULL,
    marca VARCHAR(100) NULL,
    modelo VARCHAR(100) NULL,
    condicion VARCHAR(20) NOT NULL,
    FOREIGN KEY (resguardo_id) REFERENCES resguardos(id) ON DELETE CASCADE,
    FOREIGN KEY (bien_id) REFERENCES bienes(id)
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
