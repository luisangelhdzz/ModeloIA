// Fase 3 - Backend con Express.
// Ejecutar con:  node --env-file=.env servidor.mjs

import express from "express";
import { readFile, writeFile } from "node:fs/promises";

const API_URL = "https://app.backboard.io/api/threads/messages";
const API_KEY = process.env.BACKBOARD_API_KEY;
const MODELO = process.env.MODELO ?? "gemini-3.6-flash";
const PUERTO = process.env.PUERTO ?? 3000;
const ARCHIVO_USUARIOS = "usuarios.json"; // { "luis": "assistant_id...", ... }

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
    const r = await enviarABackboard(mensaje, { threadId: thread_id, assistantId });

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

app.listen(PUERTO, () => {
  console.log(`Servidor escuchando en http://localhost:${PUERTO}`);
});
