/* =========================================================
   ARCHIVO: server.js            (RAÍZ DEL PROYECTO)
   PAPEL:   El servidor. Muestra las páginas de la carpeta public
            y atiende las rutas /api.
   USA:     .env             → PORT, GMAIL_USUARIO, GMAIL_CLAVE_APLICACION
            public/codigo.js → REGLAS, MENSAJES y validaciones (las mismas del navegador)
            pacientes.json   → base de datos (se crea sola al primer registro)
   RUTAS:   GET  /api              → prueba
            POST /api/registro     → 201 / 400 / 409 / 500
            POST /api/login        → 200 / 400 / 401 / 429 / 500
            POST /api/recuperar    → 200 (siempre el mismo mensaje) / 400 / 500
            POST /api/restablecer  → 200 / 400 / 500
   SE INICIA CON: npm run dev   →   abrir http://localhost:3000
   ========================================================= */

require("dotenv").config();               // lee el .env y lo carga en process.env
const express = require("express");
const path = require("path");
const fs = require("fs");                 // leer y escribir pacientes.json
const crypto = require("crypto");         // cifrado PBKDF2 y código aleatorio (viene con Node)
const nodemailer = require("nodemailer"); // enviar el correo por Gmail

// Regla de oro: el servidor repite TODAS las reglas. Se toman de codigo.js para no copiarlas.
const { REGLAS, MENSAJES, limpiar, validarTodo, evaluarContrasena } = require("./public/codigo.js");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ARCHIVO_PACIENTES = path.join(__dirname, "pacientes.json");

app.use(express.json());                  // convierte el cuerpo JSON de la petición en req.body

// Muestra los archivos de la carpeta public (HTML, CSS, JS, imágenes).
// Lo que está FUERA de public (.env, server.js, pacientes.json) no se puede abrir desde el navegador.
app.use(express.static(path.join(__dirname, "public")));


/* ---------- BASE DE DATOS: pacientes.json ---------- */
function leerPacientes() {
    try {
        let lista = JSON.parse(fs.readFileSync(ARCHIVO_PACIENTES, "utf8"));
        return Array.isArray(lista) ? lista : [];
    } catch (error) {
        return [];                        // si el archivo no existe o está dañado, empieza vacío
    }
}
function guardarPacientes(lista) {
    fs.writeFileSync(ARCHIVO_PACIENTES, JSON.stringify(lista, null, 2));
}

// Datos que SÍ se pueden enviar al navegador (nunca la contraseña)
function perfilPublico(p) {
    return {
        nombre: p.nombre, usuario: p.usuario, correo: p.correo,
        telefono: p.telefono, tipoDocumento: p.tipoDocumento, documento: p.documento,
        fechaRegistro: p.fechaRegistro, ingresoAnterior: p.ingresoAnterior
    };
}


/* ---------- CIFRADO DE LA CONTRASEÑA (PBKDF2 + sal aleatoria) ---------- */
function cifrarContrasena(contrasena, salHex, iteraciones) {
    return crypto.pbkdf2Sync(contrasena, Buffer.from(salHex, "hex"), iteraciones, 32, "sha256").toString("hex");
}
function nuevaContrasenaCifrada(contrasena) {
    let sal = crypto.randomBytes(REGLAS.cifrado.bytesSal).toString("hex");
    return { sal: sal, hash: cifrarContrasena(contrasena, sal, REGLAS.cifrado.iteraciones), iteraciones: REGLAS.cifrado.iteraciones };
}


/* ---------- CORREO (Gmail) ---------- */
// Usa la CONTRASEÑA DE APLICACIÓN del .env, nunca la contraseña normal de Gmail.
const correoGmail = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USUARIO, pass: process.env.GMAIL_CLAVE_APLICACION }
});


/* ---------- DATOS EN MEMORIA ---------- */
// Si el servidor se reinicia, vuelven a cero.
const intentos = {};   // login:     { "correo": { fallos, bloqueadoHasta } }
const codigos = {};    // recuperar: { "correo": { codigo, venceEn, intentos } }


/* ---------- RUTAS ---------- */

// Prueba: confirma que la API responde
app.get("/api", function (req, res) {
    res.json({ mensaje: "API Clínica Betania funcionando" });
});

// REGISTRO
app.post("/api/registro", function (req, res) {
    try {
        let datos = limpiar(req.body);    // lista blanca: ignora campos extra como "rol"
        let errores = validarTodo(datos);
        if (Object.keys(errores).length > 0) return res.status(400).json({ errores: errores });

        // Guía: la unicidad siempre se verifica en el servidor. Mensaje único: no dice cuál dato existe.
        let pacientes = leerPacientes();
        let telefonoCompleto = REGLAS.telefono.indicativo + datos.telefono;
        let repetido = pacientes.some(function (p) {
            return p.correo === datos.correo || p.usuario.toLowerCase() === datos.usuario.toLowerCase() ||
                   p.documento === datos.documento || p.telefono === telefonoCompleto;
        });
        if (repetido) return res.status(409).json({ mensaje: MENSAJES.datoRepetido });

        let ahora = new Date().toISOString();
        pacientes.push({
            rol: "Paciente",                      // lo pone el servidor, nunca el usuario
            nombre: datos.nombre,
            usuario: datos.usuario,
            correo: datos.correo,
            telefono: telefonoCompleto,           // Guía: formato internacional +57...
            fechaNacimiento: datos.fechaNacimiento,
            tipoDocumento: datos.tipoDocumento,
            documento: datos.documento,
            contrasena: nuevaContrasenaCifrada(datos.contrasena),   // la original NO se guarda
            fechaRegistro: ahora,
            fechaAceptacionTerminos: ahora,       // Guía: guardar fecha y hora de aceptación
            ultimoIngreso: null,
            ingresoAnterior: null
        });
        guardarPacientes(pacientes);
        res.status(201).json({ mensaje: MENSAJES.registroExitoso });
    } catch (error) {
        console.error("Error en el registro:", error);   // el detalle técnico solo en la terminal
        res.status(500).json({ mensaje: MENSAJES.errorServidor });
    }
});

// INICIO DE SESIÓN
// Guía: revelar lo mínimo posible y resistir intentos repetidos.
app.post("/api/login", function (req, res) {
    try {
        let cuerpo = req.body || {};
        // Guía: quitar espacios al correo, pero NUNCA a la contraseña
        let correo = typeof cuerpo.correo === "string" ? cuerpo.correo.trim().toLowerCase() : "";
        let contrasena = typeof cuerpo.contrasena === "string" ? cuerpo.contrasena : "";
        if (correo === "" || contrasena === "") return res.status(400).json({ mensaje: MENSAJES.obligatorio });

        // ¿Está bloqueado ese correo por muchos intentos?
        let registro = intentos[correo] || { fallos: 0, bloqueadoHasta: 0 };
        let ahora = Date.now();
        if (registro.bloqueadoHasta > ahora) {
            return res.status(429).json({ segundos: Math.ceil((registro.bloqueadoHasta - ahora) / 1000) });
        }

        let pacientes = leerPacientes();
        let paciente = pacientes.find(function (p) { return p.correo === correo; });
        let correcta = false;
        if (paciente && paciente.contrasena) {
            let hash = cifrarContrasena(contrasena, paciente.contrasena.sal, paciente.contrasena.iteraciones);
            // Compara completo, sin "cortar" en la primera diferencia
            correcta = crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(paciente.contrasena.hash, "hex"));
        } else {
            // Si el correo no existe se cifra igual: tarda lo mismo y no delata que no existe
            cifrarContrasena(contrasena, "00".repeat(16), REGLAS.cifrado.iteraciones);
        }

        if (!correcta) {
            registro.fallos++;
            if (registro.fallos >= REGLAS.login.intentosMaximos) {
                registro.fallos = 0;
                registro.bloqueadoHasta = ahora + REGLAS.login.minutosBloqueo * 60000;
                intentos[correo] = registro;
                return res.status(429).json({ segundos: REGLAS.login.minutosBloqueo * 60 });
            }
            intentos[correo] = registro;
            return res.status(401).json({ mensaje: MENSAJES.incorrecto });
        }

        // Ingreso correcto: se borran los fallos y se anota la fecha
        delete intentos[correo];
        paciente.ingresoAnterior = paciente.ultimoIngreso;
        paciente.ultimoIngreso = new Date().toISOString();
        guardarPacientes(pacientes);
        res.json({ paciente: perfilPublico(paciente) });
    } catch (error) {
        console.error("Error en el inicio de sesión:", error);
        res.status(500).json({ mensaje: MENSAJES.errorServidor });
    }
});

// RECUPERAR CONTRASEÑA - PASO 1: enviar el código al correo
// Guía: el MISMO mensaje genérico aunque el correo no exista.
app.post("/api/recuperar", async function (req, res) {
    try {
        let cuerpo = req.body || {};
        let correo = typeof cuerpo.correo === "string" ? cuerpo.correo.trim().toLowerCase() : "";
        if (correo === "") return res.status(400).json({ mensaje: MENSAJES.obligatorio });

        let paciente = leerPacientes().find(function (p) { return p.correo === correo; });
        if (paciente) {
            let digitos = REGLAS.recuperacion.digitos;
            let minutos = REGLAS.recuperacion.minutosVigencia;
            // Código aleatorio de 6 dígitos (ej: 048213). Si pide otro, reemplaza al anterior.
            let codigo = String(crypto.randomInt(0, 10 ** digitos)).padStart(digitos, "0");
            codigos[correo] = { codigo: codigo, venceEn: Date.now() + minutos * 60000, intentos: 0 };

            try {
                await correoGmail.sendMail({
                    from: "Clínica Veterinaria Betania <" + process.env.GMAIL_USUARIO + ">",
                    to: correo,
                    subject: MENSAJES.asuntoCorreo,
                    text: "Hola " + paciente.nombre + ",\n\nTu código para recuperar la contraseña es: " + codigo +
                          "\n\nVence en " + minutos + " minutos y solo sirve una vez." +
                          "\nSi no lo pediste, ignora este correo.\n\nClínica Veterinaria Betania",
                    html: "<div style='font-family:Arial,sans-serif;max-width:420px;margin:auto;border:1px solid #D6DED3;border-radius:12px;overflow:hidden'>" +
                          "<div style='background:#3E5C32;color:#fff;padding:16px 20px;font-weight:bold'>Clínica Veterinaria Betania</div>" +
                          "<div style='padding:20px;color:#333'>" +
                          "<p>Hola <b>" + paciente.nombre + "</b>,</p>" +
                          "<p>Tu código para recuperar la contraseña es:</p>" +
                          "<p style='font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;color:#557A46;margin:16px 0'>" + codigo + "</p>" +
                          "<p>Vence en <b>" + minutos + " minutos</b> y solo sirve una vez.</p>" +
                          "<p style='color:#66705F;font-size:13px'>Si no lo pediste, ignora este correo. Tu contraseña no cambiará.</p>" +
                          "</div></div>"
                });
                console.log("Código de recuperación enviado a " + correo);
            } catch (error) {
                // El error se ve SOLO en la terminal; al usuario se le da el mismo mensaje de siempre
                console.error("No se pudo enviar el correo:", error.message);
            }
        }
        res.json({ mensaje: MENSAJES.codigoEnviado });
    } catch (error) {
        console.error("Error al recuperar la contraseña:", error);
        res.status(500).json({ mensaje: MENSAJES.errorServidor });
    }
});

// RECUPERAR CONTRASEÑA - PASO 2: revisar el código y guardar la nueva contraseña
// Guía: código de un solo uso que expira.
app.post("/api/restablecer", function (req, res) {
    try {
        let cuerpo = req.body || {};
        let correo = typeof cuerpo.correo === "string" ? cuerpo.correo.trim().toLowerCase() : "";
        let codigo = typeof cuerpo.codigo === "string" ? cuerpo.codigo.trim() : "";
        let contrasena = typeof cuerpo.contrasena === "string" ? cuerpo.contrasena : "";
        let confirmar = typeof cuerpo.confirmarContrasena === "string" ? cuerpo.confirmarContrasena : "";

        // 1) El código debe existir, no estar vencido y coincidir. Tras 5 fallos se borra.
        let guardado = codigos[correo];
        if (!guardado || guardado.venceEn < Date.now()) {
            delete codigos[correo];
            return res.status(400).json({ errores: { codigo: MENSAJES.codigoInvalido } });
        }
        if (codigo !== guardado.codigo) {
            guardado.intentos++;
            if (guardado.intentos >= REGLAS.recuperacion.intentosMaximos) delete codigos[correo];
            return res.status(400).json({ errores: { codigo: MENSAJES.codigoInvalido } });
        }

        let pacientes = leerPacientes();
        let paciente = pacientes.find(function (p) { return p.correo === correo; });
        if (!paciente) {
            delete codigos[correo];
            return res.status(400).json({ errores: { codigo: MENSAJES.codigoInvalido } });
        }

        // 2) La nueva contraseña cumple las MISMAS reglas del registro (Fuerte, sin nombre/usuario/correo)
        let errores = {};
        let errorClave = evaluarContrasena(contrasena, paciente).error;
        if (errorClave) errores.contrasena = errorClave;
        if (confirmar !== contrasena) errores.confirmarContrasena = MENSAJES.clave.noCoinciden;
        if (Object.keys(errores).length > 0) return res.status(400).json({ errores: errores });

        // 3) Se guarda cifrada y el código se borra (un solo uso)
        paciente.contrasena = nuevaContrasenaCifrada(contrasena);
        paciente.fechaCambioContrasena = new Date().toISOString();
        guardarPacientes(pacientes);
        delete codigos[correo];
        delete intentos[correo];          // si estaba bloqueado en el login, queda libre
        res.json({ mensaje: MENSAJES.contrasenaCambiada });
    } catch (error) {
        console.error("Error al cambiar la contraseña:", error);
        res.status(500).json({ mensaje: MENSAJES.errorServidor });
    }
});


app.listen(PORT, function () {
    console.log("Servidor disponible en http://localhost:" + PORT);
    if (!process.env.GMAIL_USUARIO || !process.env.GMAIL_CLAVE_APLICACION) {
        console.log("OJO: falta GMAIL_USUARIO o GMAIL_CLAVE_APLICACION en el .env (no se enviarán correos)");
    }
});