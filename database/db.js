const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

const db = new Database(path.join(__dirname, 'hospital.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS areas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    responsable TEXT,
    activa INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    cargo TEXT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    area_id INTEGER,
    rol TEXT NOT NULL DEFAULT 'usuario',
    activo INTEGER DEFAULT 1,
    creado_en TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (area_id) REFERENCES areas(id)
  );

  CREATE TABLE IF NOT EXISTS documentos_salientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL CHECK(tipo IN ('oficio','memorandum')),
    numero_folio TEXT NOT NULL UNIQUE,
    consecutivo INTEGER NOT NULL,
    anio INTEGER NOT NULL,
    fecha_emision TEXT NOT NULL,
    asunto TEXT NOT NULL,
    destinatario TEXT NOT NULL,
    cargo_destinatario TEXT,
    institucion_destinatario TEXT,
    contenido TEXT NOT NULL,
    area_emisora_id INTEGER,
    elaborado_por_id INTEGER,
    estatus TEXT NOT NULL DEFAULT 'borrador' CHECK(estatus IN ('borrador','firmado','enviado','archivado')),
    ruta_pdf TEXT,
    creado_en TEXT DEFAULT (datetime('now','localtime')),
    actualizado_en TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (area_emisora_id) REFERENCES areas(id),
    FOREIGN KEY (elaborado_por_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS correspondencia_entrante (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folio_externo TEXT,
    tipo TEXT NOT NULL DEFAULT 'oficio' CHECK(tipo IN ('oficio','memorandum','circular','oficio-circular','dictamen','otro')),
    fecha_recepcion TEXT NOT NULL,
    fecha_documento TEXT,
    remitente_nombre TEXT NOT NULL,
    remitente_cargo TEXT,
    remitente_institucion TEXT NOT NULL,
    asunto TEXT NOT NULL,
    descripcion TEXT,
    area_destinataria_id INTEGER,
    estatus TEXT NOT NULL DEFAULT 'recibido' CHECK(estatus IN ('recibido','en_proceso','atendido','archivado')),
    requiere_respuesta INTEGER DEFAULT 0,
    fecha_limite_respuesta TEXT,
    ruta_archivo TEXT,
    notas TEXT,
    registrado_por_id INTEGER,
    creado_en TEXT DEFAULT (datetime('now','localtime')),
    actualizado_en TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (area_destinataria_id) REFERENCES areas(id),
    FOREIGN KEY (registrado_por_id) REFERENCES usuarios(id)
  );
`);

// Datos iniciales
function seedData() {
  const areasCount = db.prepare('SELECT COUNT(*) as c FROM areas').get().c;
  if (areasCount > 0) return;

  const insertArea = db.prepare('INSERT INTO areas (nombre, responsable) VALUES (?, ?)');
  const areas = [
    ['Dirección', 'Director General'],
    ['Administración', 'Administrador'],
    ['Enfermería', 'Jefe de Enfermeras'],
    ['Consulta Externa', 'Médico Responsable'],
    ['Urgencias', 'Médico de Urgencias'],
    ['Laboratorio', 'Químico Responsable'],
    ['Trabajo Social', 'Trabajadora Social'],
    ['Farmacia', 'Responsable de Farmacia'],
  ];
  areas.forEach(([nombre, responsable]) => insertArea.run(nombre, responsable));

  const dirArea = db.prepare("SELECT id FROM areas WHERE nombre = 'Dirección'").get();
  const hash = bcrypt.hashSync('Admin2026', 10);
  db.prepare(`
    INSERT INTO usuarios (nombre, cargo, username, password_hash, area_id, rol)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('Administrador del Sistema', 'Administrador', 'admin', hash, dirArea.id, 'admin');
}

seedData();

module.exports = db;
