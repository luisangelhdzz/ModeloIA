// Fase 1 (versión Node) - Tutor de estudio en la terminal.
// Tu programa -> Backboard -> Gemini -> Backboard -> tu programa
// Ejecutar con:  node --env-file=.env chat.mjs

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const API_URL = "https://app.backboard.io/api/threads/messages";
const API_KEY = process.env.BACKBOARD_API_KEY;
const MODELO = process.env.MODELO ?? "gemini-2.5-flash";

// System prompt: define la personalidad y reglas del tutor
const SYSTEM_PROMPT =
  "Eres un tutor paciente para un estudiante de Ingeniería en Sistemas. " +
  "Explicas en español, con ejemplos cortos y claros. " +
  "Si el alumno te pide practicar, hazle una pregunta a la vez y " +
  "espera su respuesta antes de corregirlo.";

if (!API_KEY) {
  console.error("Falta BACKBOARD_API_KEY en tu archivo .env");
  process.exit(1);
}

// Envía un mensaje a Backboard y regresa la respuesta como objeto
async function enviarMensaje(texto, threadId) {
  const cuerpo = {
    content: texto,
    llm_provider: "google",
    model_name: MODELO,
    system_prompt: SYSTEM_PROMPT,
  };
  // Si ya existe conversación, la continuamos (así recuerda lo anterior)
  if (threadId) cuerpo.thread_id = threadId;

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cuerpo),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

const rl = readline.createInterface({ input, output });
let threadId = null; // Aún no hay conversación; Backboard la crea en el 1er mensaje

console.log(`Tutor listo (modelo: ${MODELO}). Escribe 'salir' para terminar.\n`);

while (true) {
  const texto = (await rl.question("Tú: ")).trim();
  if (["salir", "exit"].includes(texto.toLowerCase())) break;
  if (!texto) continue;

  try {
    const respuesta = await enviarMensaje(texto, threadId);
    threadId = respuesta.thread_id;
    console.log(`\nTutor: ${respuesta.content}`);
    console.log(`   (tokens usados: ${respuesta.total_tokens})\n`);
  } catch (error) {
    console.error(`\n[Error] ${error.message}\n`);
  }
}

rl.close();
