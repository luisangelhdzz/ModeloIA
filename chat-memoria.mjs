// Fase 2 - Tutor con MEMORIA entre sesiones.
// Ejecutar con:  node --env-file=.env chat-memoria.mjs

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFile, writeFile } from "node:fs/promises";

const API_URL = "https://app.backboard.io/api/threads/messages";
const API_KEY = process.env.BACKBOARD_API_KEY;
const MODELO = process.env.MODELO ?? "gemini-3.6-flash";
const ARCHIVO_ESTADO = "estado.json"; // Aquí guardamos el assistant_id

const SYSTEM_PROMPT =
  "Eres un tutor paciente para un estudiante de Ingeniería en Sistemas. " +
  "Explicas en español, con ejemplos cortos y claros. " +
  "Usa lo que recuerdes del alumno (su nombre, temas difíciles, avances) " +
  "para personalizar tus explicaciones.";

if (!API_KEY) {
  console.error("Falta BACKBOARD_API_KEY en tu archivo .env");
  process.exit(1);
}

// ---------- Guardar / cargar el assistant_id en un archivo ----------

async function cargarAssistantId() {
  try {
    const datos = JSON.parse(await readFile(ARCHIVO_ESTADO, "utf8"));
    return datos.assistant_id ?? null;
  } catch {
    return null; // Primera vez: el archivo aún no existe
  }
}

async function guardarAssistantId(assistantId) {
  await writeFile(
    ARCHIVO_ESTADO,
    JSON.stringify({ assistant_id: assistantId }, null, 2)
  );
}

// ---------- Hablar con Backboard ----------

async function enviarMensaje(texto, { threadId, assistantId }) {
  const cuerpo = {
    content: texto,
    llm_provider: "google",
    model_name: MODELO,
    system_prompt: SYSTEM_PROMPT,
    memory: "Auto", // <- NUEVO: guarda y recupera recuerdos automáticamente
  };

  if (threadId) {
    // Ya hay conversación en esta sesión: la continuamos
    cuerpo.thread_id = threadId;
  } else if (assistantId) {
    // Sesión nueva, pero mismo asistente: hereda sus recuerdos
    cuerpo.assistant_id = assistantId;
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---------- Programa principal ----------

let assistantId = await cargarAssistantId();
let threadId = null; // Cada vez que abres el programa es un thread nuevo

console.log(`Tutor listo (modelo: ${MODELO}). Escribe 'salir' para terminar.`);
console.log(
  assistantId
    ? `Usando tu asistente guardado: ${assistantId}\n`
    : "Primera vez: se creará un asistente nuevo.\n"
);

const rl = readline.createInterface({ input, output });

while (true) {
  const texto = (await rl.question("Tú: ")).trim();
  if (["salir", "exit"].includes(texto.toLowerCase())) break;
  if (!texto) continue;

  try {
    const r = await enviarMensaje(texto, { threadId, assistantId });
    threadId = r.thread_id;

    // La primera vez, guardamos el asistente para las siguientes sesiones
    if (!assistantId && r.assistant_id) {
      assistantId = r.assistant_id;
      await guardarAssistantId(assistantId);
    }

    console.log(`\nTutor: ${r.content}`);

    // Para aprender: ver qué recuerdos usó en esta respuesta
    const recuerdos = r.retrieved_memories ?? [];
    if (recuerdos.length > 0) {
      console.log(`   (usó ${recuerdos.length} recuerdo(s) guardado(s))`);
    }
    console.log();
  } catch (error) {
    console.error(`\n[Error] ${error.message}\n`);
  }
}

rl.close();
