# Clinica Betania

Proyecto academico (CEOGET): registro de pacientes de la Clinica Betania, con validacion de datos en el navegador y en el servidor.

## Tecnologias

- Node.js
- Express
- dotenv
- nodemailer (envio de correos con Gmail)
- nodemon (desarrollo)
- HTML, CSS y JavaScript

## Instalacion

1. Clonar el repositorio:

   ```
      git clone https://github.com/Sintiqui/Clinica-Betania.git
   cd Clinica-Betania
   ```

2. Instalar dependencias:

   ```
   npm install
   ```

3. Crear el archivo `.env` a partir de la plantilla y llenar los valores:

   ```
   Copy-Item .env.example .env
   ```

4. Crear el archivo de datos `pacientes.json` en la raiz con este contenido:

   ```
   []
   ```

5. Iniciar el servidor:

   ```
   npm run dev
   ```

6. Abrir en el navegador: `http://localhost:3000`

## Estructura

```
├── public/
│   ├── imag/          imagenes
│   ├── codigo.js      logica del navegador
│   ├── estilos.css    estilos
│   ├── index.html     pagina principal
│   └── registro.html  formulario de registro
├── pacientes.json     datos (no se sube)
├── server.js          servidor
└── package.json
```