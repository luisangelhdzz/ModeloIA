// ---------- Estado de la app ----------
let usuario = localStorage.getItem("usuario"); // se recuerda en este navegador
let token = localStorage.getItem("token");     // pase de sesión (JWT)
let threadId = null;                            // conversación actual
let modoRegistro = false;                       // ¿la pantalla está en "crear cuenta"?

// ---------- Referencias a elementos del HTML ----------
const $mensajes = document.getElementById("mensajes");
const $scroll = document.getElementById("scroll");
const $formChat = document.getElementById("form-chat");
const $entrada = document.getElementById("entrada");
const $enviar = document.getElementById("enviar");
const $quien = document.getElementById("quien");
const $pantallaAcceso = document.getElementById("pantalla-acceso");
const $formAcceso = document.getElementById("form-acceso");
const $accesoTitulo = document.getElementById("acceso-titulo");
const $accesoBoton = document.getElementById("acceso-boton");
const $accesoCambiar = document.getElementById("acceso-cambiar");
const $accesoError = document.getElementById("acceso-error");
const $campoCodigo = document.getElementById("campo-codigo");

// ---------- Pintar mensajes en pantalla ----------
function agregarMensaje(tipo, contenido) {
  const div = document.createElement("div");
  div.className = `mensaje ${tipo}`;
  if (tipo === "tutor") {
    // Markdown -> HTML -> limpiado con DOMPurify
    div.innerHTML = DOMPurify.sanitize(marked.parse(contenido));
    div.appendChild(crearBotonVoz(contenido));
  } else {
    div.textContent = contenido; // texto plano, nunca HTML
  }
  $mensajes.appendChild(div);
  $scroll.scrollTop = $scroll.scrollHeight;
  return div;
}

// ---------- Peticiones protegidas ----------
// Toda petición protegida lleva el token en el encabezado Authorization
function encabezados() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

function cerrarSesion() {
  token = null;
  usuario = null;
  localStorage.removeItem("token");
  localStorage.removeItem("usuario");
  threadId = null;
  iniciar();
}

// ---------- Voz (ElevenLabs a través de nuestro servidor) ----------
let audioActual = null; // para que solo suene una respuesta a la vez

function crearBotonVoz(texto) {
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "boton-voz";
  boton.textContent = "🔊 Escuchar";
  let audio = null; // se genera solo la primera vez

  boton.addEventListener("click", async () => {
    if (audio && !audio.paused) {
      audio.pause();
      return;
    }

    if (!audio) {
      boton.disabled = true;
      boton.textContent = "Generando voz…";
      try {
        const res = await fetch("/voz", {
          method: "POST",
          headers: encabezados(),
          body: JSON.stringify({ texto }),
        });
        if (res.status === 401) {
          cerrarSesion();
          throw new Error("sesión vencida");
        }
        if (!res.ok) {
          const datos = await res.json().catch(() => ({}));
          throw new Error(datos.error ?? `Error ${res.status}`);
        }
        const blob = await res.blob(); // el MP3 que mandó el servidor
        audio = new Audio(URL.createObjectURL(blob));
        audio.addEventListener("pause", () => (boton.textContent = "🔊 Escuchar"));
        audio.addEventListener("ended", () => (boton.textContent = "🔊 Escuchar"));
      } catch (error) {
        boton.textContent = `No se pudo generar la voz (${error.message})`;
        return;
      } finally {
        boton.disabled = false;
      }
    }

    if (audioActual && audioActual !== audio) audioActual.pause();
    audioActual = audio;

    await audio.play();
    boton.textContent = "⏸ Pausar";
  });

  return boton;
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
  const cuerpo = { mensaje: texto }; // el usuario ya va dentro del token
  if (threadId) cuerpo.thread_id = threadId;

  const res = await fetch("/chat", {
    method: "POST",
    headers: encabezados(),
    body: JSON.stringify(cuerpo),
  });
  if (res.status === 401) {
    cerrarSesion();
    throw new Error("Tu sesión venció, vuelve a entrar");
  }
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
    agregarMensaje("error", `No se pudo obtener respuesta: ${error.message}`);
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

document.getElementById("salir").addEventListener("click", cerrarSesion);

// ---------- Pantalla de acceso (entrar / crear cuenta) ----------
$accesoCambiar.addEventListener("click", () => {
  modoRegistro = !modoRegistro;
  pintarPantallaAcceso();
});

function pintarPantallaAcceso() {
  $accesoTitulo.textContent = modoRegistro ? "Crea tu cuenta" : "Entra a tu tutor";
  $accesoBoton.textContent = modoRegistro ? "Crear cuenta" : "Entrar";
  $accesoCambiar.textContent = modoRegistro ? "Ya tengo cuenta" : "Crear una cuenta";
  $campoCodigo.hidden = !modoRegistro; // el código solo se pide al registrarse
}

$formAcceso.addEventListener("submit", async (e) => {
  e.preventDefault();
  const nombre = document.getElementById("acceso-usuario").value.trim().toLowerCase();
  const contrasena = document.getElementById("acceso-contrasena").value;
  const codigo = document.getElementById("acceso-codigo").value.trim();

  $accesoError.className = "acceso-error";
  $accesoError.textContent = "";
  $accesoBoton.disabled = true;

  try {
    const res = await fetch(modoRegistro ? "/registro" : "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario: nombre, contrasena, codigo }),
    });
    const datos = await res.json();
    if (!res.ok) throw new Error(datos.error ?? "No se pudo entrar");

    // Al registrarse no hay token todavía: primero hay que confirmar el correo
    if (datos.mensaje) {
      modoRegistro = false;
      pintarPantallaAcceso();
      $accesoError.className = "acceso-aviso";
      $accesoError.textContent = datos.mensaje;
      return;
    }

    token = datos.token;
    usuario = datos.usuario;
    localStorage.setItem("token", token);
    localStorage.setItem("usuario", usuario);
    $formAcceso.reset();
    threadId = null;
    iniciar();
  } catch (error) {
    $accesoError.textContent = error.message;
  } finally {
    $accesoBoton.disabled = false;
  }
});

function iniciar() {
  if (!token || !usuario) {
    pintarPantallaAcceso();
    $pantallaAcceso.hidden = false;
    document.getElementById("acceso-usuario").focus();
    return;
  }
  $pantallaAcceso.hidden = true;
  $quien.textContent = `Usuario: ${usuario}`;
  mostrarVacio();
  $entrada.focus();
}

iniciar();
