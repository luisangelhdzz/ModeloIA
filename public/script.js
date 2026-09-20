// ---------- Estado de la app ----------
let usuario = localStorage.getItem("usuario"); // se recuerda en este navegador
let threadId = null;                            // conversación actual

// ---------- Referencias a elementos del HTML ----------
const $mensajes = document.getElementById("mensajes");
const $scroll = document.getElementById("scroll");
const $formChat = document.getElementById("form-chat");
const $entrada = document.getElementById("entrada");
const $enviar = document.getElementById("enviar");
const $quien = document.getElementById("quien");
const $pantallaNombre = document.getElementById("pantalla-nombre");

// ---------- Pintar mensajes en pantalla ----------
function agregarMensaje(tipo, contenido) {
  const div = document.createElement("div");
  div.className = `mensaje ${tipo}`;
  if (tipo === "tutor") {
    // Markdown -> HTML -> limpiado con DOMPurify
    div.innerHTML = DOMPurify.sanitize(marked.parse(contenido));
  } else {
    div.textContent = contenido; // texto plano, nunca HTML
  }
  $mensajes.appendChild(div);
  $scroll.scrollTop = $scroll.scrollHeight;
  return div;
}

function mostrarVacio() {
  $mensajes.innerHTML = "";
  const p = document.createElement("p");
  p.className = "vacio";
  p.textContent = `Hola, ${usuario}. ¿Qué quieres repasar hoy?`;
  $mensajes.appendChild(p);
}

// ---------- Hablar con NUESTRO servidor (no con Backboard) ----------
async function enviar(texto) {
  const cuerpo = { usuario, mensaje: texto };
  if (threadId) cuerpo.thread_id = threadId;

  const res = await fetch("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  const datos = await res.json();
  if (!res.ok) throw new Error(datos.error ?? "Error desconocido");
  return datos;
}

$formChat.addEventListener("submit", async (e) => {
  e.preventDefault(); // evita que la página se recargue
  const texto = $entrada.value.trim();
  if (!texto) return;

  document.querySelector(".vacio")?.remove();
  agregarMensaje("alumno", texto);
  $entrada.value = "";
  $enviar.disabled = true;

  const pensando = agregarMensaje("pensando", "El tutor está pensando…");

  try {
    const datos = await enviar(texto);
    threadId = datos.thread_id; // guardamos la conversación para el siguiente mensaje
    pensando.remove();
    agregarMensaje("tutor", datos.respuesta);
  } catch (error) {
    pensando.remove();
    agregarMensaje("error", `No se pudo obtener respuesta: ${error.message}. Revisa la terminal del servidor.`);
  } finally {
    $enviar.disabled = false;
    $entrada.focus();
  }
});

// Enter envía; Shift + Enter hace salto de línea
$entrada.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $formChat.requestSubmit();
  }
});

// ---------- Botones del encabezado ----------
document.getElementById("nueva").addEventListener("click", () => {
  threadId = null; // conversación nueva, pero la memoria del usuario se conserva
  mostrarVacio();
});

document.getElementById("cambiar").addEventListener("click", () => {
  $pantallaNombre.hidden = false;
  document.getElementById("nombre").focus();
});

// ---------- Pantalla de nombre ----------
document.getElementById("form-nombre").addEventListener("submit", (e) => {
  e.preventDefault();
  const nombre = document.getElementById("nombre").value.trim().toLowerCase();
  if (!nombre) return;
  usuario = nombre;
  localStorage.setItem("usuario", usuario);
  threadId = null;
  iniciar();
});

function iniciar() {
  if (!usuario) {
    $pantallaNombre.hidden = false;
    document.getElementById("nombre").focus();
    return;
  }
  $pantallaNombre.hidden = true;
  $quien.textContent = `Usuario: ${usuario}`;
  mostrarVacio();
  $entrada.focus();
}

iniciar();
