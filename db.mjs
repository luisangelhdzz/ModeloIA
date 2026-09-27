// Acceso a la base de datos MySQL.
// Todas las consultas usan "?" (consultas parametrizadas) para evitar inyección SQL.

import mysql from "mysql2/promise";

// En la nube la conexión viaja por internet, así que debe ir cifrada (SSL/TLS).
// DB_CA guarda el certificado del proveedor; sin él igual se cifra,
// pero sin verificar la identidad del servidor.
const ssl =
  process.env.DB_SSL === "true"
    ? process.env.DB_CA
      ? { ca: process.env.DB_CA.replace(/\\n/g, "\n") }
      : { rejectUnauthorized: false }
    : undefined;

// Un pool mantiene varias conexiones abiertas y las reparte entre las peticiones,
// en vez de abrir y cerrar una conexión cada vez (que sería lento).
const pool = mysql.createPool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PUERTO ?? 3306),
  user: process.env.DB_USUARIO,
  password: process.env.DB_CONTRASENA,
  database: process.env.DB_NOMBRE ?? "tutor",
  ssl,
  waitForConnections: true,
  connectionLimit: 10,
});

// Prueba la conexión al arrancar, para enterarnos de inmediato si algo falta
export async function probarConexion() {
  const conexion = await pool.getConnection();
  await conexion.ping();
  conexion.release(); // siempre hay que devolver la conexión al pool
}

// ---------- Usuarios ----------

export async function buscarPorCorreo(correo) {
  const [filas] = await pool.query("SELECT * FROM usuarios WHERE correo = ?", [correo]);
  return filas[0] ?? null; // query regresa [filas, info]
}

export async function buscarPorTokenVerificacion(token) {
  const [filas] = await pool.query(
    "SELECT * FROM usuarios WHERE token_verificacion = ?",
    [token]
  );
  return filas[0] ?? null;
}

export async function crearUsuario(correo, hash, tokenVerificacion) {
  const [resultado] = await pool.query(
    `INSERT INTO usuarios (correo, hash_contrasena, verificado, token_verificacion)
     VALUES (?, ?, FALSE, ?)`,
    [correo, hash, tokenVerificacion]
  );
  return resultado.insertId;
}

// Si alguien se registró pero nunca confirmó, le renovamos contraseña y token
export async function renovarRegistro(id, hash, tokenVerificacion) {
  await pool.query(
    "UPDATE usuarios SET hash_contrasena = ?, token_verificacion = ? WHERE id = ?",
    [hash, tokenVerificacion, id]
  );
}

export async function marcarVerificado(id) {
  await pool.query(
    "UPDATE usuarios SET verificado = TRUE, token_verificacion = NULL WHERE id = ?",
    [id]
  );
}

export async function guardarAssistant(id, assistantId) {
  await pool.query("UPDATE usuarios SET assistant_id = ? WHERE id = ?", [assistantId, id]);
}

// ---------- Conversaciones ----------

export async function crearConversacion(usuarioId, threadId, titulo) {
  const [resultado] = await pool.query(
    "INSERT INTO conversaciones (usuario_id, thread_id, titulo) VALUES (?, ?, ?)",
    [usuarioId, threadId, titulo]
  );
  return resultado.insertId;
}

export async function listarConversaciones(usuarioId, limite = 30) {
  const [filas] = await pool.query(
    `SELECT thread_id, titulo, creado_en
     FROM conversaciones
     WHERE usuario_id = ?
     ORDER BY creado_en DESC
     LIMIT ?`,
    [usuarioId, limite]
  );
  return filas;
}

// Comprueba que ese thread sí es del usuario (que nadie lea conversaciones ajenas)
// Regresa el id de la conversación, o null si no es suya
export async function idDeSuConversacion(usuarioId, threadId) {
  const [filas] = await pool.query(
    "SELECT id FROM conversaciones WHERE usuario_id = ? AND thread_id = ?",
    [usuarioId, threadId]
  );
  return filas[0]?.id ?? null;
}

export async function borrarConversacion(usuarioId, threadId) {
  const [resultado] = await pool.query(
    "DELETE FROM conversaciones WHERE usuario_id = ? AND thread_id = ?",
    [usuarioId, threadId]
  );
  return resultado.affectedRows > 0; // los mensajes se borran solos (ON DELETE CASCADE)
}

// ---------- Mensajes ----------

export async function guardarMensaje(conversacionId, rol, contenido) {
  await pool.query(
    "INSERT INTO mensajes (conversacion_id, rol, contenido) VALUES (?, ?, ?)",
    [conversacionId, rol, contenido]
  );
}

export async function listarMensajes(conversacionId) {
  const [filas] = await pool.query(
    "SELECT rol, contenido FROM mensajes WHERE conversacion_id = ? ORDER BY id",
    [conversacionId]
  );
  return filas;
}
