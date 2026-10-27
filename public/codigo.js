/* =========================================================
   ARCHIVO: codigo.js
   PAPEL:   Toda la lógica del navegador. Lo usan las DOS páginas:
              - registro.html → registrar al paciente
              - index.html    → iniciar sesión, bienvenida y recuperar contraseña
            Y también lo usa server.js (Node) para repetir las MISMAS
            reglas y validaciones en el servidor.
   IDEA CLAVE (Regla de oro de la guía):
     Toda validación se hace DOS veces.
       1) NAVEGADOR: avisa al instante mientras el usuario escribe.
       2) SERVIDOR: server.js repite TODAS las reglas, porque el
          navegador se puede saltar.
     REGISTRO, INICIO DE SESIÓN y RECUPERAR CONTRASEÑA: los hace server.js
       con pacientes.json. Aquí solo se valida y se envía.
     SESIÓN ABIERTA: se guarda en sessionStorage (se borra al cerrar la pestaña).
     La contraseña la cifra el servidor (PBKDF2); nunca se guarda tal cual.
   PENDIENTE: confirmar correo con enlace, Postman y autenticación en dos pasos (2FA).
   ORDEN DEL ARCHIVO:
     1. Configuración   2. Mensajes   3. Utilidades   4. Sesión abierta
     5. Cifrado (en el servidor)   6. Validaciones   7. Llamadas al servidor
     8. Página de registro   9. Página de inicio de sesión
     9B. Recuperar contraseña   10. Arranque
   ========================================================= */


/* =========================================================
   1. CONFIGURACIÓN (todas las reglas en un solo lugar)
   Si el profesor cambia una regla, se cambia SOLO aquí.
   ========================================================= */
const CLAVES = {
    sesion: "betaniaSesion"         // sessionStorage: sesión abierta (se borra al cerrar la pestaña)
};

const REGLAS = {
    nombre: { min: 2, max: 50 },                    // Guía: 2 a 50 caracteres
    usuario: { min: 3, max: 20 },                   // Guía: 3 a 20 caracteres
    correo: { max: 50 },                            // Guía: máximo 50 caracteres
    telefono: { digitos: 10, indicativo: "+57" },   // Guía: 10 dígitos, guardar como +57...
    documento: {
        min: 6, max: 10,                            // Guía: entre 6 y 10 dígitos
        tipos: ["CC", "TI", "CE", "PPT"],           // Guía: CC, TI, CE, PPT
        soloMenores: ["TI"],                        // TI solo para menores de 18
        soloMayores: ["CC"]                         // CC solo para mayores de 18
    },
    edad: { minima: 14, mayoria: 18, anioMinimo: 1900 },   // Guía: mínimo 14 años
    contrasena: {
        min: 8,                                     // Guía: mínimo 8
        max: 12,                                    // Guía: máximo 12
        prohibidos: ["<", ">", "´", "”", "\"", "'", "\\", "&"],   // Guía: no aceptar < > ´ ” \ &
        // Guía: rechazar contraseñas comunes. Se compara la parte de letras
        // ("Betania2026!" → "betania") y la contraseña completa.
        comunes: [
            "123456", "1234567", "12345678", "123456789", "1234567890", "111111", "000000",
            "password", "qwerty", "qwertyuiop", "abc", "abcdef", "admin", "administrador",
            "bienvenido", "welcome", "contrasena", "clave", "secreto", "usuario", "prueba",
            "test", "asdf", "asdfgh", "zxcv", "teamo", "iloveyou", "dragon", "monkey",
            "clinica", "betania", "clinicabetania", "veterinaria", "salud", "paciente",
            "medico", "doctor", "hospital", "cita", "colombia", "mascota", "perro", "gato",
            "gata", "michi", "peludito"
        ]
    },
    login: { intentosMaximos: 5, minutosBloqueo: 1 },        // Guía: tras 5 fallos esperar 1 minuto
    recuperacion: { digitos: 6, minutosVigencia: 30, intentosMaximos: 5 },   // Guía: código que expira (ej. 30 min)
    sesion: { minutosInactividad: 30, segundosAviso: 30 },   // demo en clase: poner minutosInactividad: 1
    cifrado: { iteraciones: 100000, bytesSal: 16 },          // lo usa server.js para cifrar la contraseña
    // LISTA BLANCA: el servidor ignora cualquier campo que no esté aquí (ej: "rol": "admin")
    camposRegistro: ["nombre", "usuario", "correo", "telefono", "fechaNacimiento", "tipoDocumento",
                     "documento", "contrasena", "confirmarContrasena", "terminos"]
};

// Servicios que se muestran en la bienvenida (se agregan o quitan aquí)
const SERVICIOS = [
    { icono: "🩺", nombre: "Consulta general", detalle: "Revisión completa y control de salud de tu mascota." },
    { icono: "💉", nombre: "Vacunación", detalle: "Plan de vacunas y carnet de vacunación digital." },
    { icono: "🪱", nombre: "Desparasitación", detalle: "Control interno y externo de parásitos." },
    { icono: "✂️", nombre: "Peluquería y baño", detalle: "Baño, corte y limpieza de oídos y uñas." },
    { icono: "🔬", nombre: "Laboratorio", detalle: "Exámenes de sangre, orina y diagnóstico." },
    { icono: "🚑", nombre: "Urgencias", detalle: "Atención inmediata cuando más lo necesitas." }
];


/* =========================================================
   2. MENSAJES (todos los textos que ve el usuario)
   Se arman con los valores de REGLAS: si cambia un límite,
   el mensaje se actualiza solo.
   ========================================================= */
const R = REGLAS;
const MENSAJES = {
    obligatorio: "Este campo es obligatorio",
    errorServidor: "Ocurrió un error inesperado. Intenta de nuevo.",
    // Registro (mensajes sugeridos por la guía)
    nombre: "Escribe un nombre válido de " + R.nombre.min + " a " + R.nombre.max + " letras",
    correo: "Ingresa un correo válido, por ejemplo nombre@dominio.com",
    usuario: "Usa de " + R.usuario.min + " a " + R.usuario.max + " letras, números, - o _",
    soloNumeros: "Este campo solo acepta números",   // Celular y Documento: si se escribe una letra
    telefono: "Ingresa un número de " + R.telefono.digitos + " dígitos",
    fechaInvalida: "Ingresa una fecha de nacimiento real",
    fechaFutura: "La fecha de nacimiento no puede ser futura",
    edadMinima: "Debes tener al menos " + R.edad.minima + " años",
    tipoDocumento: "Selecciona un tipo de documento",
    documento: "El documento debe tener entre " + R.documento.min + " y " + R.documento.max + " dígitos",
    tiSiendoMayor: "Si tienes " + R.edad.mayoria + " años o más no puedes usar TI",
    ccSiendoMenor: "Si eres menor de " + R.edad.mayoria + " años no puedes usar CC (usa TI)",
    terminos: "Debes aceptar los términos para continuar",
    terminosBloqueados: "Primero crea una contraseña Fuerte y confírmala para poder aceptar los términos",
    datoRepetido: "Ya existe una cuenta con alguno de estos datos",
    registroExitoso: "¡Registro exitoso! Te llevamos a iniciar sesión...",
    // Contraseña
    clave: {
        espacios: "La contraseña no puede tener espacios en blanco",
        largoMaximo: "La contraseña puede tener máximo " + R.contrasena.max + " caracteres",
        prohibidos: "No uses estos caracteres: " + R.contrasena.prohibidos.join(" "),
        comun: "Esa contraseña es común o fácil de adivinar. Elige otra",
        datosPersonales: "La contraseña no puede contener tu nombre, usuario o correo",
        noPuedeSerFuerte: "No puede ser Fuerte: ",
        noCoinciden: "Las contraseñas no coinciden",
        niveles: ["", "Débil", "Media", "Aceptable", "Fuerte"],
        aceptada: "Fuerte ✓ Cumple todas las reglas",
        requisitos: {
            largo: "",   // se arma con el número exacto de caracteres que faltan
            minuscula: "una minúscula",
            mayuscula: "una mayúscula",
            numero: "un número",
            especial: "un carácter especial (ej: ! # $ % * ?)"
        }
    },
    // Inicio de sesión
    incorrecto: "Correo o contraseña incorrectos",   // Guía: nunca decir cuál de los dos falló
    bloqueado: function (seg) { return "Demasiados intentos fallidos. Espera " + seg + " segundos para intentarlo de nuevo."; },
    registrado: "¡Tu cuenta fue creada! Ya puedes iniciar sesión.",
    sesionVencida: "Tu sesión se cerró por inactividad. Inicia sesión de nuevo.",
    sesionCerrada: "Cerraste sesión correctamente. ¡Hasta pronto!",
    notaSesion: "Por seguridad, la sesión se cierra tras " + R.sesion.minutosInactividad + " minuto(s) sin actividad.",
    primerIngreso: "Este es tu primer ingreso",
    // Recuperar contraseña
    codigoEnviado: "Si el correo está registrado, recibirás un código de " + R.recuperacion.digitos + " dígitos. Revisa también Spam.",   // Guía: mismo mensaje exista o no
    codigoFormato: "Escribe el código de " + R.recuperacion.digitos + " dígitos que llegó a tu correo",
    codigoInvalido: "El código es incorrecto o ya venció. Pide uno nuevo si es necesario.",
    contrasenaCambiada: "¡Listo! Tu contraseña fue cambiada. Ya puedes iniciar sesión.",
    asuntoCorreo: "Código para recuperar tu contraseña - Clínica Veterinaria Betania"
};

// Patrones (expresiones regulares) que definen qué es válido
const PATRONES = {
    nombre: /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:[ '\-][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*$/,  // Guía: tildes, ñ, espacio, guion, apóstrofo
    usuario: /^[A-Za-z0-9_-]+$/,                                            // Guía: letras, números, - y _
    correo: /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/,       // .com, .com.co, .edu.co, etc.
    soloDigitos: /^\d+$/,
    noNumerico: /[^\d\s.\-]/,       // algo que no es número, espacio, punto ni guion (ej: una letra)
    fecha: /^(\d{4})-(\d{2})-(\d{2})$/,
    espacios: /\s/
};


/* =========================================================
   3. UTILIDADES
   ========================================================= */
// Atajo para buscar elementos del HTML: $("#nombre")
const $ = function (selector) { return document.querySelector(selector); };

// Minúsculas y sin tildes, para comparar sin importar cómo se escribió
function normalizar(texto) {
    return String(texto).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Guía: "fecha real, no futura". Revisa que exista (no 31 de febrero) y calcula la edad.
function leerFecha(texto) {
    let partes = PATRONES.fecha.exec(texto || "");
    if (!partes) return null;
    let anio = Number(partes[1]), mes = Number(partes[2]), dia = Number(partes[3]);
    let fecha = new Date(anio, mes - 1, dia);
    // Si JavaScript "corrigió" la fecha (31 feb → 3 mar), no era real
    if (fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) return null;
    if (anio < R.edad.anioMinimo) return null;

    let hoy = new Date();
    let edad = hoy.getFullYear() - anio;
    if (hoy.getMonth() < mes - 1 || (hoy.getMonth() === mes - 1 && hoy.getDate() < dia)) edad--;
    return { edad: edad, futura: fecha > hoy };
}

// Guía: botón para ver u ocultar el texto de la contraseña
function activarBotonesVer() {
    document.querySelectorAll(".btnVer").forEach(function (boton) {
        boton.addEventListener("click", function () {
            let entrada = $("#" + boton.dataset.objetivo);
            let oculta = entrada.type === "password";
            entrada.type = oculta ? "text" : "password";
            boton.textContent = oculta ? "Ocultar" : "Ver";
        });
    });
}

// Muestra un mensaje general (tipo: "error", "exito", "info" o "" para ocultarlo)
function mostrarAlerta(idAlerta, tipo, mensaje) {
    let alerta = $("#" + idAlerta);
    alerta.className = "alerta " + (tipo || "");
    alerta.textContent = mensaje || "";
}

// Muestra el error de un campo y lo pinta en rojo (o verde si está bien)
function mostrarError(campo, mensaje) {
    let entrada = $("#" + campo);
    $("#error-" + campo).textContent = mensaje || "";
    entrada.classList.toggle("invalido", !!mensaje);
    entrada.classList.toggle("valido", !mensaje && entrada.type !== "checkbox" && entrada.value !== "");
}


/* =========================================================
   4. SESIÓN ABIERTA (sessionStorage)
   Los pacientes ya NO están en el navegador: están en pacientes.json (servidor).
   La lectura usa try/catch: si alguien daña el dato a mano,
   la página no se rompe.
   ========================================================= */
function leerJSON(almacen, clave, porDefecto) {
    try {
        let valor = JSON.parse(almacen.getItem(clave));
        return valor === null ? porDefecto : valor;
    } catch (e) { return porDefecto; }
}
function leerSesion() { return leerJSON(sessionStorage, CLAVES.sesion, null); }
function guardarSesion(s) { sessionStorage.setItem(CLAVES.sesion, JSON.stringify(s)); }
function borrarSesion() { sessionStorage.removeItem(CLAVES.sesion); }


/* =========================================================
   5. CIFRADO DE LA CONTRASEÑA
   Ahora lo hace server.js (PBKDF2 + sal aleatoria), nunca el navegador.
   La misma contraseña da un resultado distinto en cada paciente
   y no se puede "descifrar"; solo se puede comparar.
   ========================================================= */


/* =========================================================
   6. VALIDACIONES (las usan el navegador Y el servidor)
   ========================================================= */

// Guía: "cada campo se limpia primero y luego se valida".
// Deja solo los campos permitidos (lista blanca) y los limpia.
function limpiar(crudos) {
    let d = {};
    crudos = crudos || {};
    R.camposRegistro.forEach(function (campo) {
        let valor = crudos[campo];
        if (campo === "terminos") { d.terminos = valor; return; }   // debe llegar true exacto (no "true")
        if (typeof valor !== "string") { d[campo] = ""; return; }   // números, objetos, null → vacío
        // Guía: a la contraseña NUNCA se le quitan espacios (si los tiene, se RECHAZA)
        if (campo === "contrasena" || campo === "confirmarContrasena") { d[campo] = valor; return; }
        let v = valor.trim();
        if (campo === "nombre") v = v.replace(/\s+/g, " ");          // espacios repetidos → uno
        if (campo === "correo") v = v.toLowerCase();                  // Guía: convertir a minúsculas
        if (campo === "tipoDocumento") v = v.toUpperCase();
        if (campo === "documento" || campo === "telefono") v = v.replace(/[\s.\-]/g, "");  // 1.234.567 → 1234567
        d[campo] = v;
    });
    return d;
}

// ¿La contraseña contiene el nombre, el usuario o el correo? (Guía)
function contieneDatosPersonales(contrasena, d) {
    let clave = normalizar(contrasena);
    let piezas = [];
    if (d.nombre) piezas = piezas.concat(d.nombre.split(/[ '\-]/));   // cada palabra del nombre
    if (d.usuario) piezas.push(d.usuario);
    if (d.correo) piezas.push(d.correo.split("@")[0]);                // la parte antes de la @
    return piezas.map(normalizar)
                 .filter(function (p) { return p.length >= 3; })       // ignora "de", "la"
                 .some(function (p) { return clave.includes(p); });
}

/* ---------------------------------------------------------
   EVALUAR CONTRASEÑA: el corazón del medidor.
   REGLA IMPORTANTE: una contraseña SOLO puede ser "Fuerte"
   si cumple TODAS las reglas de la guía. Si rompe una sola
   (por ejemplo, contiene el nombre del usuario), se queda
   en "Débil" aunque tenga mayúsculas, números y símbolos.
   Devuelve:
     nivel   → 0 a 4 (0 vacío, 1 Débil, 2 Media, 3 Aceptable, 4 Fuerte)
     error   → "" si es válida, o el texto de lo que está mal
     ayuda   → lo que le falta (para el medidor)
   --------------------------------------------------------- */
function evaluarContrasena(v, d) {
    let C = R.contrasena, M = MENSAJES.clave;
    if (v === "") return { nivel: 0, error: MENSAJES.obligatorio, ayuda: "" };

    // A) Reglas de la guía que NUNCA se pueden romper → Débil y se explica por qué
    let roto = "";
    if (PATRONES.espacios.test(v)) roto = M.espacios;
    else if (C.prohibidos.some(function (c) { return v.includes(c); })) roto = M.prohibidos;
    else if (v.length > C.max) roto = M.largoMaximo;
    else if (C.comunes.includes(normalizar(v).replace(/[^a-z]/g, "")) || C.comunes.includes(normalizar(v))) roto = M.comun;
    else if (contieneDatosPersonales(v, d)) roto = M.datosPersonales;
    // El medidor dice "No puede ser Fuerte" y el mensaje rojo de abajo explica el porqué
    if (roto) return { nivel: 1, error: roto, ayuda: M.noPuedeSerFuerte.replace(": ", "") };

    // B) Complejidad: 4 requisitos (largo mínimo, minúscula/mayúscula, número, especial)
    let cumple = {
        minuscula: /[a-zñáéíóúü]/.test(v),
        mayuscula: /[A-ZÑÁÉÍÓÚÜ]/.test(v),
        numero: /\d/.test(v),
        especial: /[^A-Za-zÑñÁÉÍÓÚÜáéíóúü0-9]/.test(v)
    };
    let faltan = Object.keys(cumple).filter(function (k) { return !cumple[k]; })
                       .map(function (k) { return M.requisitos[k]; });
    let faltanCaracteres = Math.max(0, C.min - v.length);
    if (faltanCaracteres > 0) faltan.push(faltanCaracteres + (faltanCaracteres === 1 ? " carácter más" : " caracteres más"));

    // Cada requisito cumplido sube un nivel; con alguno pendiente nunca llega a 4
    let puntos = 4 - faltan.length;
    let nivel = Math.max(1, Math.min(3, puntos));
    if (faltan.length === 0) return { nivel: 4, error: "", ayuda: M.aceptada };

    let ayuda = "Te falta: " + faltan.join(", ") + ".";
    return { nivel: nivel, error: "La contraseña debe ser Fuerte", ayuda: ayuda };
}

// Valida UN campo. Devuelve "" si está bien o el mensaje de error.
function validarCampo(campo, d) {
    let v = d[campo];
    if (campo === "terminos") return v === true ? "" : MENSAJES.terminos;   // Guía: casilla marcada
    if (v === "" || v === undefined) return MENSAJES.obligatorio;

    switch (campo) {
        case "nombre":
            return (v.length >= R.nombre.min && v.length <= R.nombre.max && PATRONES.nombre.test(v)) ? "" : MENSAJES.nombre;
        case "usuario":
            return (v.length >= R.usuario.min && v.length <= R.usuario.max && PATRONES.usuario.test(v)) ? "" : MENSAJES.usuario;
        case "correo":
            // Además del patrón: sin punto al inicio, sin ".." y sin punto pegado a la @
            return (v.length <= R.correo.max && PATRONES.correo.test(v) && !/^\.|\.\.|\.@/.test(v)) ? "" : MENSAJES.correo;
        case "telefono":
            // Si tiene letras se avisa que solo acepta números, además del mensaje de longitud
            if (!PATRONES.soloDigitos.test(v)) return MENSAJES.soloNumeros + ". " + MENSAJES.telefono;
            return v.length === R.telefono.digitos ? "" : MENSAJES.telefono;
        case "fechaNacimiento": {
            let f = leerFecha(v);
            if (!f) return MENSAJES.fechaInvalida;
            if (f.futura) return MENSAJES.fechaFutura;
            if (f.edad < R.edad.minima) return MENSAJES.edadMinima;
            return "";
        }
        case "tipoDocumento": {
            if (!R.documento.tipos.includes(v)) return MENSAJES.tipoDocumento;
            // Validación cruzada: el tipo de documento debe cuadrar con la edad
            let f = leerFecha(d.fechaNacimiento);
            if (f && !f.futura) {
                if (f.edad >= R.edad.mayoria && R.documento.soloMenores.includes(v)) return MENSAJES.tiSiendoMayor;
                if (f.edad < R.edad.mayoria && R.documento.soloMayores.includes(v)) return MENSAJES.ccSiendoMenor;
            }
            return "";
        }
        case "documento":
            // Si tiene letras se avisa que solo acepta números, además del mensaje de longitud
            if (!PATRONES.soloDigitos.test(v)) return MENSAJES.soloNumeros + ". " + MENSAJES.documento;
            return (v.length >= R.documento.min && v.length <= R.documento.max) ? "" : MENSAJES.documento;
        case "contrasena":
            return evaluarContrasena(v, d).error;
        case "confirmarContrasena":
            return v === d.contrasena ? "" : MENSAJES.clave.noCoinciden;   // Guía: verificar que coincidan
    }
    return "";
}

// Valida todos los campos. Devuelve { campo: mensaje } solo con los que fallaron.
function validarTodo(d) {
    let errores = {};
    R.camposRegistro.forEach(function (campo) {
        let mensaje = validarCampo(campo, d);
        if (mensaje) errores[campo] = mensaje;
    });
    return errores;
}


/* =========================================================
   7. LLAMADAS AL SERVIDOR
   Regla de oro: el servidor NUNCA confía en lo que recibe.
   Prueba desde la consola del navegador (F12 → Console):
     servidorRegistrar({ nombre: "<script>", terminos: "true", rol: "admin" }).then(console.log)  → status 400
   ========================================================= */

// --- REGISTRO ---
// Lo hace el servidor (server.js → POST /api/registro).
// Se envían los datos CRUDOS: el servidor los limpia y valida todo otra vez.
async function servidorRegistrar(cuerpo) {
    try {
        let respuesta = await fetch("/api/registro", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cuerpo)
        });
        let datos = await respuesta.json();
        datos.status = respuesta.status;          // 201, 400, 409 o 500
        return datos;
    } catch (error) {
        console.error("Error en el registro:", error);   // ej: el servidor está apagado
        return { status: 500, mensaje: MENSAJES.errorServidor };
    }
}

// --- INICIO DE SESIÓN ---
// Lo hace el servidor (server.js → POST /api/login).
// Si es correcto, la sesión se abre aquí con los datos que devuelve el servidor.
async function servidorLogin(cuerpo) {
    try {
        let respuesta = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cuerpo)
        });
        let datos = await respuesta.json();
        datos.status = respuesta.status;          // 200, 400, 401, 429 o 500
        if (datos.status === 200) {
            guardarSesion({ correo: datos.paciente.correo, paciente: datos.paciente, ultimaActividad: Date.now() });
        }
        return datos;
    } catch (error) {
        console.error("Error en el inicio de sesión:", error);   // ej: el servidor está apagado
        return { status: 500, mensaje: MENSAJES.errorServidor };
    }
}

// --- PERFIL: ¿la sesión sigue viva? Nunca devuelve la contraseña ---
function servidorPerfil() {
    let sesion = leerSesion();
    if (!sesion || typeof sesion.ultimaActividad !== "number") return { status: 401 };
    let limite = R.sesion.minutosInactividad * 60000;
    if (Date.now() - sesion.ultimaActividad > limite) { borrarSesion(); return { status: 401, vencida: true }; }

    let paciente = sesion.paciente;   // los datos que devolvió el servidor al iniciar sesión
    if (!paciente) { borrarSesion(); return { status: 401 }; }
    return {
        status: 200,
        paciente: {
            nombre: paciente.nombre, usuario: paciente.usuario, correo: paciente.correo,
            telefono: paciente.telefono, tipoDocumento: paciente.tipoDocumento, documento: paciente.documento,
            fechaRegistro: paciente.fechaRegistro, ingresoAnterior: paciente.ingresoAnterior
        },
        restanteMs: limite - (Date.now() - sesion.ultimaActividad)
    };
}


/* =========================================================
   8. PÁGINA DE REGISTRO (registro.html)
   ========================================================= */
function iniciarRegistro() {
    const tocados = {};      // un campo muestra error solo después de que el usuario lo tocó
    let enviando = false;    // evita el doble clic

    // Si cambia un campo, también se revisan los que dependen de él
    const DEPENDENCIAS = {
        nombre: ["contrasena"], usuario: ["contrasena"], correo: ["contrasena"],
        contrasena: ["confirmarContrasena"], fechaNacimiento: ["tipoDocumento"]
    };
    // Campos que cambian con "change" (lista y casilla) en vez de "input"
    const DE_SELECCION = ["tipoDocumento", "terminos"];
    // Campos numéricos: si se escribe una letra, el error sale AL INSTANTE
    const SOLO_NUMEROS = ["telefono", "documento"];

    function leerFormulario() {
        let datos = {};
        R.camposRegistro.forEach(function (c) {
            datos[c] = (c === "terminos") ? $("#terminos").checked : $("#" + c).value;
        });
        return datos;
    }

    function revisar(campo) {
        mostrarError(campo, validarCampo(campo, limpiar(leerFormulario())));
    }

    // MEDIDOR: colorea los segmentos y explica qué falta o qué regla se rompió
    function actualizarMedidor() {
        let datos = limpiar(leerFormulario());
        let r = evaluarContrasena(datos.contrasena, datos);
        let colores = ["", "var(--error)", "var(--naranja)", "var(--amarillo)", "var(--verde)"];
        document.querySelectorAll("#medidor span").forEach(function (segmento, i) {
            segmento.style.backgroundColor = i < r.nivel ? colores[r.nivel] : "";
        });
        let texto = $("#textoMedidor");
        if (r.nivel === 0) { texto.textContent = ""; return; }
        texto.textContent = r.nivel === 4 ? r.ayuda : MENSAJES.clave.niveles[r.nivel] + " · " + r.ayuda;
        texto.style.color = colores[r.nivel];
    }

    // TÉRMINOS: la casilla solo se puede marcar cuando la contraseña
    // es Fuerte (cumple todas las reglas) y la confirmación coincide.
    function actualizarTerminos() {
        let datos = limpiar(leerFormulario());
        let claveLista = validarCampo("contrasena", datos) === "" && validarCampo("confirmarContrasena", datos) === "";
        let casilla = $("#terminos");
        casilla.disabled = !claveLista;
        $("#cajaTerminos").classList.toggle("bloqueada", !claveLista);
        $("#ayudaTerminos").textContent = claveLista ? "" : MENSAJES.terminosBloqueados;
        if (!claveLista && casilla.checked) {     // si la contraseña deja de ser válida, se desmarca
            casilla.checked = false;
            if (tocados.terminos) revisar("terminos");
        }
    }

    async function enviar(evento) {
        evento.preventDefault();
        if (enviando) return;
        mostrarAlerta("alertaGeneral", "", "");

        // Capa 1: validación del navegador
        let crudos = leerFormulario();
        let errores = validarTodo(limpiar(crudos));
        R.camposRegistro.forEach(function (c) { tocados[c] = true; mostrarError(c, errores[c]); });
        let primero = Object.keys(errores)[0];
        if (primero) { $("#" + primero).focus(); return; }

        // Capa 2: se envían los datos CRUDOS al servidor, que revisa todo otra vez
        enviando = true;
        let boton = $("#botonRegistrar");
        boton.disabled = true;
        boton.textContent = "Registrando...";

        let respuesta = await servidorRegistrar(crudos);

        if (respuesta.status === 201) {
            mostrarAlerta("alertaGeneral", "exito", respuesta.mensaje);
            $("#formRegistro").reset();
            setTimeout(function () { location.href = "index.html?registrado=1"; }, 1800);
            return;
        }
        if (respuesta.status === 400) {
            Object.keys(respuesta.errores).forEach(function (c) { mostrarError(c, respuesta.errores[c]); });
        } else {
            mostrarAlerta("alertaGeneral", "error", respuesta.mensaje || MENSAJES.errorServidor);
        }
        enviando = false;
        boton.disabled = false;
        boton.textContent = "Confirmar registro";
    }

    // Límites del HTML tomados de REGLAS (nada escrito a mano)
    $("#nombre").maxLength = R.nombre.max;
    $("#usuario").maxLength = R.usuario.max;
    $("#correo").maxLength = R.correo.max;
    $("#telefono").maxLength = R.telefono.digitos + 4;   // deja escribir con espacios: 300 123 4567
    $("#documento").maxLength = R.documento.max + 4;     // deja escribir con puntos: 1.234.567
    let hoy = new Date();
    $("#fechaNacimiento").max = hoy.getFullYear() + "-" + String(hoy.getMonth() + 1).padStart(2, "0") + "-" + String(hoy.getDate()).padStart(2, "0");
    $("#fechaNacimiento").min = R.edad.anioMinimo + "-01-01";

    // Validación en vivo
    R.camposRegistro.forEach(function (campo) {
        let entrada = $("#" + campo);
        let esSeleccion = DE_SELECCION.includes(campo);
        entrada.addEventListener("blur", function () { tocados[campo] = true; revisar(campo); });
        entrada.addEventListener(esSeleccion ? "change" : "input", function () {
            if (esSeleccion) tocados[campo] = true;
            // Celular y Documento: si escribe una letra, se avisa sin esperar a que salga del campo
            if (SOLO_NUMEROS.includes(campo) && PATRONES.noNumerico.test(entrada.value)) tocados[campo] = true;
            if (tocados[campo]) revisar(campo);
            (DEPENDENCIAS[campo] || []).forEach(function (dep) { if (tocados[dep]) revisar(dep); });
            if (["nombre", "usuario", "correo", "contrasena"].includes(campo)) actualizarMedidor();
            if (["nombre", "usuario", "correo", "contrasena", "confirmarContrasena"].includes(campo)) actualizarTerminos();
        });
    });

    // Guía: PERMITIR pegar en las contraseñas (para los gestores de contraseñas).
    // Por eso no se bloquea "pegar" en ningún campo.

    activarBotonesVer();
    actualizarTerminos();   // al abrir la página la casilla empieza bloqueada
    $("#formRegistro").addEventListener("submit", enviar);
}


/* =========================================================
   9. PÁGINA DE INICIO DE SESIÓN + BIENVENIDA (index.html)
   ========================================================= */
function iniciarLogin() {
    let enviando = false;
    let relojBloqueo = null;
    let relojSesion = null;
    let avisoVisible = false;
    let ultimaEscritura = 0;

    function mostrarVista(nombre) {
        $("#vistaLogin").hidden = (nombre !== "login");
        $("#vistaBienvenida").hidden = (nombre !== "bienvenida");
        $("#vistaRecuperar").hidden = (nombre !== "recuperar");
    }

    // Cuenta regresiva mientras el correo está bloqueado
    function iniciarBloqueo(segundos) {
        clearInterval(relojBloqueo);
        let boton = $("#botonIngresar");
        boton.disabled = true;
        let restante = segundos;
        mostrarAlerta("alertaLogin", "error", MENSAJES.bloqueado(restante));
        relojBloqueo = setInterval(function () {
            restante--;
            if (restante <= 0) {
                clearInterval(relojBloqueo);
                boton.disabled = false;
                mostrarAlerta("alertaLogin", "", "");
                return;
            }
            mostrarAlerta("alertaLogin", "error", MENSAJES.bloqueado(restante));
        }, 1000);
    }

    async function enviar(evento) {
        evento.preventDefault();
        if (enviando) return;
        mostrarAlerta("alertaLogin", "", "");

        let correo = $("#correo").value.trim();
        let contrasena = $("#contrasena").value;
        // Guía: no enviar si están vacíos
        mostrarError("correo", correo === "" ? MENSAJES.obligatorio : "");
        mostrarError("contrasena", contrasena === "" ? MENSAJES.obligatorio : "");
        if (correo === "" || contrasena === "") return;

        enviando = true;
        let boton = $("#botonIngresar");
        boton.disabled = true;
        boton.textContent = "Verificando...";

        let respuesta = await servidorLogin({ correo: correo, contrasena: contrasena });

        enviando = false;
        boton.disabled = false;
        boton.textContent = "Iniciar";
        $("#contrasena").value = "";                      // la contraseña no se deja escrita

        if (respuesta.status === 200) { $("#formLogin").reset(); mostrarAlerta("alertaLogin", "", ""); abrirBienvenida(); }
        else if (respuesta.status === 429) iniciarBloqueo(respuesta.segundos);
        else mostrarAlerta("alertaLogin", "error", respuesta.mensaje || MENSAJES.errorServidor);
    }

    function saludoSegunHora() {
        let hora = new Date().getHours();
        if (hora < 12) return "Buenos días";
        if (hora < 19) return "Buenas tardes";
        return "Buenas noches";
    }

    function formatoFecha(iso, conHora) {
        if (!iso) return MENSAJES.primerIngreso;
        let opciones = { day: "numeric", month: "long", year: "numeric" };
        if (conHora) { opciones.hour = "2-digit"; opciones.minute = "2-digit"; }
        return new Date(iso).toLocaleString("es-CO", opciones);
    }

    // Dibuja las tarjetas de servicios a partir de la lista SERVICIOS
    function pintarServicios() {
        let contenedor = $("#listaServicios");
        contenedor.innerHTML = "";
        SERVICIOS.forEach(function (s) {
            let tarjeta = document.createElement("div");
            tarjeta.className = "servicio";
            let icono = document.createElement("span");
            icono.className = "iconoServicio";
            icono.textContent = s.icono;
            let titulo = document.createElement("b");
            titulo.textContent = s.nombre;
            let detalle = document.createElement("p");
            detalle.textContent = s.detalle;
            tarjeta.append(icono, titulo, detalle);
            contenedor.appendChild(tarjeta);
        });
    }

    // Pinta la bienvenida. textContent (no innerHTML) evita que se inyecte código.
    function abrirBienvenida() {
        let respuesta = servidorPerfil();
        if (respuesta.status !== 200) { abrirLogin(respuesta.vencida ? "vencida" : ""); return; }
        let p = respuesta.paciente;
        let primerNombre = p.nombre.split(" ")[0];

        $("#saludoHora").textContent = saludoSegunHora();
        $("#tituloBienvenida").textContent = "¡Bienvenido, " + primerNombre + "!";
        $("#datoUsuario").textContent = "@" + p.usuario;
        $("#datoCorreo").textContent = p.correo;
        $("#datoTelefono").textContent = p.telefono;
        $("#datoDocumento").textContent = p.tipoDocumento + " •••• " + p.documento.slice(-4);  // documento oculto en pantalla
        $("#datoDesde").textContent = formatoFecha(p.fechaRegistro, false);
        $("#datoAnterior").textContent = formatoFecha(p.ingresoAnterior, true);
        $("#notaSesion").textContent = MENSAJES.notaSesion;
        pintarServicios();
        document.title = "Bienvenido, " + primerNombre + " - Clínica Veterinaria Betania";

        mostrarVista("bienvenida");
        clearInterval(relojSesion);
        relojSesion = setInterval(vigilarSesion, 1000);
        vigilarSesion();
    }

    function abrirLogin(motivo) {
        clearInterval(relojSesion);
        ocultarAviso();
        document.title = "Portal de Pacientes - Clínica Veterinaria Betania";
        if (motivo === "vencida") mostrarAlerta("alertaLogin", "info", MENSAJES.sesionVencida);
        if (motivo === "cerrada") mostrarAlerta("alertaLogin", "exito", MENSAJES.sesionCerrada);
        if (motivo === "cambiada") mostrarAlerta("alertaLogin", "exito", MENSAJES.contrasenaCambiada);
        mostrarVista("login");
    }

    function cerrarSesion(motivo) { borrarSesion(); abrirLogin(motivo); }

    // Cada segundo pregunta cuánto le queda a la sesión
    function vigilarSesion() {
        let respuesta = servidorPerfil();
        if (respuesta.status !== 200) { cerrarSesion("vencida"); return; }
        let segundos = Math.ceil(respuesta.restanteMs / 1000);
        if (segundos <= R.sesion.segundosAviso) {
            avisoVisible = true;
            $("#contadorAviso").textContent = segundos;
            $("#modalAviso").classList.add("visible");
        } else {
            ocultarAviso();
        }
    }
    function ocultarAviso() { avisoVisible = false; $("#modalAviso").classList.remove("visible"); }

    // Mover el mouse o teclear renueva la sesión; con el aviso abierto hay que pulsar "Continuar"
    function registrarActividad(forzar) {
        if ((avisoVisible && !forzar) || $("#vistaBienvenida").hidden) return;
        let sesion = leerSesion();
        if (!sesion) return;
        if (!forzar && Date.now() - ultimaEscritura < 1000) return;
        ultimaEscritura = Date.now();
        sesion.ultimaActividad = Date.now();
        guardarSesion(sesion);
    }

    // Eventos
    activarBotonesVer();
    $("#formLogin").addEventListener("submit", enviar);
    $("#correo").addEventListener("input", function () { mostrarError("correo", ""); });
    $("#contrasena").addEventListener("input", function () { mostrarError("contrasena", ""); });
    iniciarRecuperar(mostrarVista, abrirLogin);   // "¿Olvidaste tu contraseña?" y su vista
    $("#botonCerrarSesion").addEventListener("click", function () { cerrarSesion("cerrada"); });
    $("#botonSalirAviso").addEventListener("click", function () { cerrarSesion("cerrada"); });
    $("#botonContinuar").addEventListener("click", function () { registrarActividad(true); ocultarAviso(); });
    ["mousemove", "keydown", "click", "scroll", "touchstart"].forEach(function (ev) {
        document.addEventListener(ev, function () { registrarActividad(false); }, { passive: true });
    });

    // Si viene de registrarse, se avisa y se limpia la dirección
    if (new URLSearchParams(location.search).get("registrado") === "1") {
        mostrarAlerta("alertaLogin", "exito", MENSAJES.registrado);
        history.replaceState(null, "", location.pathname);
    }

    // Si ya hay una sesión viva, entra directo a la bienvenida
    let perfil = servidorPerfil();
    if (perfil.status === 200) abrirBienvenida();
    else abrirLogin(perfil.vencida ? "vencida" : "");
}


/* =========================================================
   9B. RECUPERAR CONTRASEÑA (vista 3 de index.html)
   Guía: código de un solo uso que expira, y el mismo mensaje
   genérico aunque el correo no exista.
     Paso 1: escribe el correo → server.js envía el código al Gmail.
     Paso 2: escribe el código + la nueva contraseña → server.js la cambia.
   ========================================================= */
function iniciarRecuperar(mostrarVista, abrirLogin) {
    let enviando = false;   // evita el doble clic
    // Los errores del servidor llegan con estos nombres; aquí se dice en qué casilla se muestran
    const CASILLAS = { codigo: "recCodigo", contrasena: "recContrasena", confirmarContrasena: "recConfirmar" };

    async function llamarServidor(ruta, cuerpo) {
        try {
            let respuesta = await fetch(ruta, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(cuerpo)
            });
            let datos = await respuesta.json();
            datos.status = respuesta.status;
            return datos;
        } catch (error) {
            console.error("Error al recuperar la contraseña:", error);   // ej: el servidor está apagado
            return { status: 500, mensaje: MENSAJES.errorServidor };
        }
    }

    function mostrarErrores(errores) {
        Object.keys(CASILLAS).forEach(function (campo) { mostrarError(CASILLAS[campo], errores[campo] || ""); });
    }

    function mostrarPaso(paso) {
        $("#formPedirCodigo").hidden = (paso !== 1);
        $("#formRestablecer").hidden = (paso !== 2);
    }

    // Medidor, igual que en el registro. Aquí solo se conoce el correo;
    // el servidor revisa además el nombre y el usuario del paciente.
    function pintarMedidor() {
        let r = evaluarContrasena($("#recContrasena").value, { correo: $("#recCorreo").value.trim().toLowerCase() });
        let colores = ["", "var(--error)", "var(--naranja)", "var(--amarillo)", "var(--verde)"];
        document.querySelectorAll("#recMedidor span").forEach(function (segmento, i) {
            segmento.style.backgroundColor = i < r.nivel ? colores[r.nivel] : "";
        });
        let texto = $("#recTextoMedidor");
        if (r.nivel === 0) { texto.textContent = ""; return; }
        texto.textContent = r.nivel === 4 ? r.ayuda : MENSAJES.clave.niveles[r.nivel] + " · " + r.ayuda;
        texto.style.color = colores[r.nivel];
    }

    function abrirRecuperar() {
        $("#formPedirCodigo").reset();
        $("#formRestablecer").reset();
        mostrarError("recCorreo", "");
        mostrarErrores({});
        pintarMedidor();
        mostrarAlerta("alertaRecuperar", "", "");
        mostrarPaso(1);
        mostrarVista("recuperar");
        $("#recCorreo").focus();
    }

    // PASO 1: pedir el código
    async function pedirCodigo(evento) {
        evento.preventDefault();
        if (enviando) return;
        mostrarAlerta("alertaRecuperar", "", "");
        let correo = $("#recCorreo").value.trim();
        mostrarError("recCorreo", correo === "" ? MENSAJES.obligatorio : "");   // Guía: no enviar vacío
        if (correo === "") return;

        enviando = true;
        let boton = $("#botonPedirCodigo");
        boton.disabled = true;
        boton.textContent = "Enviando...";
        let respuesta = await llamarServidor("/api/recuperar", { correo: correo });
        enviando = false;
        boton.disabled = false;
        boton.textContent = "Enviar código";

        if (respuesta.status === 200) {
            mostrarAlerta("alertaRecuperar", "info", respuesta.mensaje);   // mismo mensaje exista o no
            mostrarPaso(2);
            $("#recCodigo").focus();
        } else {
            mostrarAlerta("alertaRecuperar", "error", respuesta.mensaje || MENSAJES.errorServidor);
        }
    }

    // PASO 2: código + nueva contraseña
    async function cambiarContrasena(evento) {
        evento.preventDefault();
        if (enviando) return;
        mostrarAlerta("alertaRecuperar", "", "");
        let cuerpo = {
            correo: $("#recCorreo").value.trim(),
            codigo: $("#recCodigo").value.trim(),
            contrasena: $("#recContrasena").value,               // a la contraseña NUNCA se le quitan espacios
            confirmarContrasena: $("#recConfirmar").value
        };

        // Capa 1: validación del navegador
        let errores = {};
        let formatoCodigo = new RegExp("^\\d{" + R.recuperacion.digitos + "}$");
        if (!formatoCodigo.test(cuerpo.codigo)) errores.codigo = MENSAJES.codigoFormato;
        let errorClave = evaluarContrasena(cuerpo.contrasena, { correo: cuerpo.correo.toLowerCase() }).error;
        if (errorClave) errores.contrasena = errorClave;
        if (cuerpo.confirmarContrasena !== cuerpo.contrasena) errores.confirmarContrasena = MENSAJES.clave.noCoinciden;
        mostrarErrores(errores);
        if (Object.keys(errores).length > 0) return;

        // Capa 2: el servidor revisa todo otra vez y guarda
        enviando = true;
        let boton = $("#botonCambiarClave");
        boton.disabled = true;
        boton.textContent = "Cambiando...";
        let respuesta = await llamarServidor("/api/restablecer", cuerpo);
        enviando = false;
        boton.disabled = false;
        boton.textContent = "Cambiar contraseña";

        if (respuesta.status === 200) { abrirLogin("cambiada"); return; }
        if (respuesta.errores) mostrarErrores(respuesta.errores);
        else mostrarAlerta("alertaRecuperar", "error", respuesta.mensaje || MENSAJES.errorServidor);
    }

    // Eventos
    $("#recCodigo").maxLength = R.recuperacion.digitos;
    $("#enlaceRecuperar").addEventListener("click", abrirRecuperar);
    $("#formPedirCodigo").addEventListener("submit", pedirCodigo);
    $("#formRestablecer").addEventListener("submit", cambiarContrasena);
    $("#recContrasena").addEventListener("input", pintarMedidor);
    $("#botonOtroCodigo").addEventListener("click", function () {
        mostrarAlerta("alertaRecuperar", "", "");
        mostrarPaso(1);
        $("#recCorreo").focus();
    });
    $("#botonVolverLogin").addEventListener("click", function () { abrirLogin(""); });
}


/* =========================================================
   10. ARRANQUE
   ========================================================= */
// En el NAVEGADOR: cada página activa solo su parte
if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", function () {
        if ($("#formRegistro")) iniciarRegistro();   // estamos en registro.html
        if ($("#formLogin")) iniciarLogin();         // estamos en index.html
    });
}

// En el SERVIDOR (Node): server.js usa estas mismas reglas, mensajes y validaciones
if (typeof module !== "undefined") {
    module.exports = { REGLAS, MENSAJES, limpiar, validarTodo, evaluarContrasena };
}