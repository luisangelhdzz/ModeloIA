// Fase 3 - Backend con Express.
// Ejecutar con:  node --env-file=.env servidor.mjs

import express from "express";
import { readFile, writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";          // para guardar contraseñas cifradas
import jwt from "jsonwebtoken";         // para los "pases" de sesión
import nodemailer from "nodemailer";    // para enviar correos
import { randomBytes } from "node:crypto";

const API_URL = "https://app.backboard.io/api/threads/messages";
const API_KEY = process.env.BACKBOARD_API_KEY;
const MODELO = process.env.MODELO ?? "gemini-3.6-flash";
const PUERTO = process.env.PUERTO ?? 3000;
const ARCHIVO_USUARIOS = "usuarios.json"; // { "luis": "assistant_id...", ... }

// ElevenLabs (voz)
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const VOZ_ID = process.env.VOZ_ID ?? "JBFqnCBsd6RMkjVDRZzb"; // voz predeterminada de ElevenLabs
const MODELO_VOZ = "eleven_flash_v2_5"; // rápido y habla español
const MAX_CARACTERES_VOZ = 1500; // cada carácter gasta 1 crédito: ponemos un tope

// Autenticación
const JWT_SECRET = process.env.JWT_SECRET;               // firma los tokens
const CODIGO_INVITACION = process.env.CODIGO_INVITACION; // para que no se registre cualquiera
const LIMITE_CHAT_HORA = 40;  // mensajes por usuario por hora
const LIMITE_VOZ_HORA = 15;   // audios por usuario por hora

// Correo (verificación de cuenta)
const SMTP_USER = process.env.SMTP_USER; // tu correo de Gmail
const SMTP_PASS = process.env.SMTP_PASS; // contraseña de aplicación de Google
const URL_BASE = process.env.URL_BASE ?? `http://localhost:${PUERTO}`;

const correo = SMTP_USER && SMTP_PASS
  ? nodemailer.createTransport({
      service: "gmail",
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null;

async function enviarVerificacion(destino, tokenVerificacion) {
  const liga = `${URL_BASE}/verificar?token=${tokenVerificacion}`;

  if (!correo) {
    // Sin SMTP configurado: mostramos la liga en la terminal para poder probar
    console.log(`\n[Verificación] Liga para ${destino}:\n${liga}\n`);
    return;
  }

  await correo.sendMail({
    from: `"Tutor de estudio" <${SMTP_USER}>`,
    to: destino,
    subject: "Confirma tu cuenta del Tutor de estudio",
    text: `Confirma tu cuenta abriendo esta liga:\n${liga}\n\nSi no fuiste tú, ignora este mensaje.`,
    html: `<p>Confirma tu cuenta dando clic en la siguiente liga:</p>
           <p><a href="${liga}">Confirmar mi cuenta</a></p>
           <p>Si no fuiste tú, ignora este mensaje.</p>`,
  });
}

if (!JWT_SECRET) {
  console.error("Falta JWT_SECRET en tu archivo .env");
  process.exit(1);
}

const SYSTEM_PROMPT =
  "Eres un tutor paciente para estudiantes de Ingeniería en Sistemas. " +
  "Explicas en español, con ejemplos cortos y claros. " +
  "Usa lo que recuerdes del alumno para personalizar tus explicaciones.";

if (!API_KEY) {
  console.error("Falta BACKBOARD_API_KEY en tu archivo .env");
  process.exit(1);
}

// ---------- "Base de datos" simple: un archivo JSON ----------

// Formato: { "luis": { "hash": "...", "assistant_id": "..." } }
async function leerUsuarios() {
  try {
    const datos = JSON.parse(await readFile(ARCHIVO_USUARIOS, "utf8"));
    // Compatibilidad con el formato viejo, donde el valor era solo el assistant_id
    for (const [nombre, valor] of Object.entries(datos)) {
      if (typeof valor === "string") datos[nombre] = { assistant_id: valor };
    }
    return datos;
  } catch {
    return {}; // Aún no existe el archivo
  }
}

async function guardarUsuarios(usuarios) {
  await writeFile(ARCHIVO_USUARIOS, JSON.stringify(usuarios, null, 2));
}

// ---------- Hablar con Backboard ----------

async function enviarABackboard(texto, { threadId, assistantId }) {
  const cuerpo = {
    content: texto,
    llm_provider: "google",
    model_name: MODELO,
    system_prompt: SYSTEM_PROMPT,
    memory: "Auto",
  };
  if (threadId) cuerpo.thread_id = threadId;
  else if (assistantId) cuerpo.assistant_id = assistantId;

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  if (!res.ok) throw new Error(`Backboard respondió ${res.status}: ${await res.text()}`);
  return res.json();
}

// ¿La "respuesta" en realidad es un error del modelo?
function esErrorDelLLM(r) {
  return typeof r.content === "string" && r.content.startsWith("LLM Error");
}

// Si Gemini falla, espera un poco y vuelve a intentar (hasta 2 veces más)
async function enviarConReintentos(texto, opciones) {
  const esperas = [1000, 3000]; // milisegundos
  let r = await enviarABackboard(texto, opciones);

  for (const ms of esperas) {
    if (!esErrorDelLLM(r)) return r;
    console.warn(`Gemini falló, reintentando en ${ms / 1000} s...`);
    await new Promise((resolver) => setTimeout(resolver, ms));
    r = await enviarABackboard(texto, opciones);
  }

  if (esErrorDelLLM(r)) throw new Error(r.content); // se rindió
  return r;
}

// ---------- Voz con ElevenLabs ----------

// Quita el formato Markdown para que la voz no lea "asterisco asterisco"
function limpiarParaVoz(texto) {
  return texto
    .replace(/```[\s\S]*?```/g, " (ver el código en pantalla) ") // bloques de código
    .replace(/`([^`]*)`/g, "$1")              // `código` en línea
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // [texto](link) -> texto
    .replace(/^\s*#{1,6}\s*/gm, "")           // ### títulos
    .replace(/^\s*>\s?/gm, "")                // > citas
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")        // --- separadores
    .replace(/^\s*\|?[\s:-]*\|[\s|:-]*$/gm, "") // |---|---| de tablas
    .replace(/\|/g, ", ")                      // | de tablas
    .replace(/(\*\*|__|\*)/g, "")              // negritas e itálicas
    .replace(/_/g, " ")                        // ID_Estudiante -> ID Estudiante
    .replace(/^\s*[-*+]\s+/gm, "")            // viñetas
    .replace(/\n{2,}/g, "\n")
    .trim();
}

async function textoAVoz(texto) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOZ_ID}`, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVEN_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({ text: texto, model_id: MODELO_VOZ }),
  });
  if (!res.ok) throw new Error(`ElevenLabs respondió ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer()); // el audio MP3 en bytes
}

// ---------- Autenticación ----------

function crearToken(usuario) {
  // El token dice "quien lo trae es este usuario", firmado con JWT_SECRET
  return jwt.sign({ usuario }, JWT_SECRET, { expiresIn: "7d" });
}

// Middleware: se ejecuta ANTES de las rutas protegidas
function autenticar(req, res, next) {
  const encabezado = req.get("Authorization") ?? "";
  const token = encabezado.startsWith("Bearer ") ? encabezado.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Falta iniciar sesión" });

  try {
    const datos = jwt.verify(token, JWT_SECRET); // falla si fue alterado o expiró
    req.usuario = datos.usuario;                 // el usuario sale del token, no del body
    next();                                      // continúa a la ruta
  } catch {
    return res.status(401).json({ error: "Sesión inválida o vencida" });
  }
}

// Límite simple de uso, en memoria: { "luis:chat": [tiempos...] }
const usos = new Map();
function dentroDelLimite(usuario, accion, limite) {
  const clave = `${usuario}:${accion}`;
  const ahora = Date.now();
  const recientes = (usos.get(clave) ?? []).filter((t) => ahora - t < 3600_000);
  if (recientes.length >= limite) return false;
  recientes.push(ahora);
  usos.set(clave, recientes);
  return true;
}

// ---------- El servidor ----------

const app = express();
app.use(express.json()); // Permite leer JSON en el body de las peticiones
app.use(express.static("public")); // NUEVO: sirve la página web de la carpeta public/

// Endpoint de prueba: ¿el servidor está vivo?  (antes era "/", ahora "/estado")
app.get("/estado", (req, res) => {
  res.json({ estado: "ok", mensaje: "Tutor API funcionando" });
});

// Crear cuenta
// Body: { "usuario": "luis", "contrasena": "...", "codigo": "..." }
app.post("/registro", async (req, res) => {
  const { usuario, contrasena, codigo } = req.body;

  if (CODIGO_INVITACION && codigo !== CODIGO_INVITACION) {
    return res.status(403).json({ error: "Código de invitación incorrecto" });
  }
  const correoUsuario = (usuario ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoUsuario) || correoUsuario.length > 60) {
    return res.status(400).json({ error: "Escribe un correo electrónico válido" });
  }
  if (!contrasena || contrasena.length < 8) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
  }

  const usuarios = await leerUsuarios();
  if (usuarios[correoUsuario]?.hash && usuarios[correoUsuario]?.verificado) {
    return res.status(409).json({ error: "Ese correo ya tiene cuenta" });
  }

  // bcrypt guarda un "hash": no se puede revertir para recuperar la contraseña
  const hash = await bcrypt.hash(contrasena, 10);
  const tokenVerificacion = randomBytes(24).toString("hex");

  usuarios[correoUsuario] = {
    ...(usuarios[correoUsuario] ?? {}),
    hash,
    verificado: false,
    token_verificacion: tokenVerificacion,
  };
  await guardarUsuarios(usuarios);

  try {
    await enviarVerificacion(correoUsuario, tokenVerificacion);
  } catch (error) {
    console.error(error);
    return res.status(502).json({ error: "No se pudo enviar el correo de confirmación" });
  }

  // No damos token todavía: primero hay que confirmar el correo
  res.json({ mensaje: "Te enviamos un correo. Ábrelo y confirma tu cuenta para entrar." });
});

// Confirmar la cuenta desde la liga del correo
app.get("/verificar", async (req, res) => {
  const { token: tokenVerificacion } = req.query;
  const usuarios = await leerUsuarios();

  const entrada = Object.entries(usuarios).find(
    ([, datos]) => datos.token_verificacion && datos.token_verificacion === tokenVerificacion
  );

  if (!entrada) {
    return res.status(400).send("<h1>Liga inválida o ya usada</h1><p><a href=\"/\">Ir al tutor</a></p>");
  }

  const [correoUsuario, datos] = entrada;
  delete datos.token_verificacion; // la liga solo sirve una vez
  datos.verificado = true;
  usuarios[correoUsuario] = datos;
  await guardarUsuarios(usuarios);

  res.send("<h1>¡Cuenta confirmada!</h1><p>Ya puedes <a href=\"/\">entrar al tutor</a>.</p>");
});

// Iniciar sesión
// Body: { "usuario": "luis", "contrasena": "..." }
app.post("/login", async (req, res) => {
  const { usuario, contrasena } = req.body;
  const correoUsuario = (usuario ?? "").trim().toLowerCase();
  const usuarios = await leerUsuarios();
  const registro = usuarios[correoUsuario];

  // Comparamos siempre, exista o no, y damos el mismo mensaje:
  // así nadie puede averiguar qué usuarios existen
  const ok = registro?.hash
    ? await bcrypt.compare(contrasena ?? "", registro.hash)
    : false;

  if (!ok) return res.status(401).json({ error: "Correo o contraseña incorrectos" });
  if (registro.verificado === false) {
    return res.status(403).json({ error: "Falta confirmar tu correo. Revisa tu bandeja." });
  }

  res.json({ token: crearToken(correoUsuario), usuario: correoUsuario });
});

// Endpoint principal: recibe un mensaje y responde con la IA
// Body esperado: { "mensaje": "hola", "thread_id": "(opcional)" }
app.post("/chat", autenticar, async (req, res) => {
  const usuario = req.usuario; // viene del token, no del body
  const { mensaje, thread_id } = req.body;

  // 1. Validar la entrada
  if (!mensaje) {
    return res.status(400).json({ error: "Falta 'mensaje'" });
  }
  if (!dentroDelLimite(usuario, "chat", LIMITE_CHAT_HORA)) {
    return res.status(429).json({ error: "Llegaste al límite de mensajes por hora" });
  }

  try {
    // 2. Buscar el asistente de ESTE usuario (cada quien tiene su memoria)
    const usuarios = await leerUsuarios();
    const assistantId = usuarios[usuario]?.assistant_id ?? null;

    // 3. Mandar el mensaje a Backboard
    const r = await enviarConReintentos(mensaje, { threadId: thread_id, assistantId });

    // 4. Si es un usuario nuevo, guardar su asistente
    if (!assistantId && r.assistant_id) {
      const actuales = await leerUsuarios();
      actuales[usuario] = { ...(actuales[usuario] ?? {}), assistant_id: r.assistant_id };
      await guardarUsuarios(actuales);
    }

    // 5. Responder al cliente
    res.json({
      respuesta: r.content,
      thread_id: r.thread_id,
      recuerdos_usados: (r.retrieved_memories ?? []).length,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al hablar con la IA" });
  }
});

// Endpoint de voz: recibe texto y regresa un MP3
// Body esperado: { "texto": "..." }
app.post("/voz", autenticar, async (req, res) => {
  if (!ELEVEN_KEY) {
    return res.status(500).json({ error: "Falta ELEVENLABS_API_KEY en el .env" });
  }
  const { texto } = req.body;
  if (!texto) return res.status(400).json({ error: "Falta 'texto'" });
  if (!dentroDelLimite(req.usuario, "voz", LIMITE_VOZ_HORA)) {
    return res.status(429).json({ error: "Llegaste al límite de audios por hora" });
  }

  let limpio = limpiarParaVoz(texto);
  if (limpio.length > MAX_CARACTERES_VOZ) {
    limpio = limpio.slice(0, MAX_CARACTERES_VOZ) + "... El resto está en pantalla.";
  }

  try {
    const audio = await textoAVoz(limpio);
    res.set("Content-Type", "audio/mpeg"); // le avisamos al navegador que es audio
    res.send(audio);
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: "No se pudo generar la voz" });
  }
});

app.listen(PUERTO, () => {
  console.log(`Servidor escuchando en http://localhost:${PUERTO}`);
});
