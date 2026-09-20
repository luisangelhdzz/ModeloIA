// Fase 3 - Backend con Express.
// Ejecutar con:  node --env-file=.env servidor.mjs

import express from "express";
import { readFile, writeFile } from "node:fs/promises";

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

const SYSTEM_PROMPT =
  "Eres un tutor paciente para estudiantes de Ingeniería en Sistemas. " +
  "Explicas en español, con ejemplos cortos y claros. " +
  "Usa lo que recuerdes del alumno para personalizar tus explicaciones.";

if (!API_KEY) {
  console.error("Falta BACKBOARD_API_KEY en tu archivo .env");
  process.exit(1);
}

// ---------- "Base de datos" simple: un archivo JSON ----------

async function leerUsuarios() {
  try {
    return JSON.parse(await readFile(ARCHIVO_USUARIOS, "utf8"));
  } catch {
    return {}; // Aún no existe el archivo
  }
}

async function guardarUsuario(usuario, assistantId) {
  const usuarios = await leerUsuarios();
  usuarios[usuario] = assistantId;
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

// ---------- El servidor ----------

const app = express();
app.use(express.json()); // Permite leer JSON en el body de las peticiones
app.use(express.static("public")); // NUEVO: sirve la página web de la carpeta public/

// Endpoint de prueba: ¿el servidor está vivo?  (antes era "/", ahora "/estado")
app.get("/estado", (req, res) => {
  res.json({ estado: "ok", mensaje: "Tutor API funcionando" });
});

// Endpoint principal: recibe un mensaje y responde con la IA
// Body esperado: { "usuario": "luis", "mensaje": "hola", "thread_id": "(opcional)" }
app.post("/chat", async (req, res) => {
  const { usuario, mensaje, thread_id } = req.body;

  // 1. Validar la entrada
  if (!usuario || !mensaje) {
    return res.status(400).json({ error: "Faltan 'usuario' o 'mensaje'" });
  }

  try {
    // 2. Buscar el asistente de ESTE usuario (cada quien tiene su memoria)
    const usuarios = await leerUsuarios();
    const assistantId = usuarios[usuario] ?? null;

    // 3. Mandar el mensaje a Backboard
    const r = await enviarConReintentos(mensaje, { threadId: thread_id, assistantId });

    // 4. Si es un usuario nuevo, guardar su asistente
    if (!assistantId && r.assistant_id) {
      await guardarUsuario(usuario, r.assistant_id);
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
app.post("/voz", async (req, res) => {
  if (!ELEVEN_KEY) {
    return res.status(500).json({ error: "Falta ELEVENLABS_API_KEY en el .env" });
  }
  const { texto } = req.body;
  if (!texto) return res.status(400).json({ error: "Falta 'texto'" });

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
