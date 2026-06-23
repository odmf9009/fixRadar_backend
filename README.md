# FixRadar — Backend

API REST + WebSocket para la app FixRadar. Node.js / Express / MongoDB (Mongoose) con
autenticación por correo+contraseña (JWT) y por Google/Firebase (Firebase Admin).

## Arranque

```bash
npm install
npm start        # node server.js
```

Variables de entorno relevantes (`.env`):

| Variable | Descripción |
|----------|-------------|
| `PORT` | Puerto del servidor (default `3000`) |
| `NODE_ENV` | `development` / `production` |
| `MONGODB_URI` | Cadena de conexión a MongoDB |
| `JWT_SECRET` | Secreto para firmar los JWT (default inseguro `fixradar-secret`) |
| `JWT_EXPIRES_IN` | Expiración del JWT (default `30d`) |
| `TWILIO_ACCOUNT_SID` | SID de Twilio para enviar SMS de verificación de teléfono |
| `TWILIO_AUTH_TOKEN` | Token de Twilio |
| `TWILIO_PHONE_NUMBER` | Número emisor de Twilio (formato E.164, p. ej. `+1...`) |

> **Verificación de teléfono por SMS (Twilio):** si las variables `TWILIO_*` no
> están configuradas (o el paquete `twilio` no está instalado), `smsService` cae
> a un **fallback de desarrollo** que registra el código en consola
> (`[sms:dev] ...`), de modo que el flujo `POST /api/users/me/phone/send-code` →
> `POST /api/users/me/phone/verify` funciona de punta a punta sin proveedor real.
> El teléfono solo puede establecerse/cambiarse a través de este flujo verificado
> (`updateMe` ignora `phoneNumber`).

Al arrancar se genera/carga un par de claves RSA (`initRsaKeys`) usado para
desencriptar la contraseña que envía el cliente.

## Estructura

```
server.js                 # bootstrap (http + socket + DB)
src/
  app.js                  # Express app, middlewares y montaje de rutas
  routes/                 # auth, users, service-requests, quotes, chat, reviews, alerts
  controllers/            # lógica de cada recurso
  middleware/             # auth (JWT/Firebase), errorHandler
  entities/               # modelos Mongoose (User, VerificationCode, ...)
  utils/                  # rsaKeys, emailService, notifications, errorCodes, ...
  socket/                 # socketManager (tiempo real)
  config/                 # database, firebase
```

## Autenticación

- **Correo + contraseña:** `POST /api/auth/register` y `POST /api/auth/login`.
  La contraseña viaja cifrada con la clave pública RSA (`GET /api/auth/public-key`).
  El backend devuelve un **JWT** propio.
- **Google / Firebase:** el cliente obtiene el ID token de Firebase y llama a
  `POST /api/auth/sync` con `Authorization: Bearer <idToken>`.

El middleware `authenticate` (`src/middleware/auth.js`) acepta **ambos**: primero
intenta validar como ID token de Firebase y, si falla, como JWT propio.

> ⚠️ Endpoints autenticados (p. ej. `PUT /api/auth/fcm-token`, `POST /api/auth/sync`)
> **requieren** el header `Authorization: Bearer <token>`. Sin él la respuesta es
> `401 { "error": "Missing authorization token" }`. El cliente no debe llamarlos
> antes de tener sesión.

## Nomenclador de errores de autenticación

Definido en `src/utils/errorCodes.js`. Todas las respuestas de error de los
endpoints de auth devuelven la forma:

```json
{ "code": "02", "error": "<mensaje es>", "message": "<mensaje es>" }
```

El **`code`** es el identificador estable que el frontend usa para mostrar el
texto en el idioma del usuario (es / en). `message`/`error` quedan como fallback
legible en español.

| code | constante | status | Cuándo se devuelve |
|------|-----------|--------|--------------------|
| `01` | `INCORRECT_PASSWORD` | 401 | Login: usuario no existe o contraseña incorrecta |
| `02` | `EMAIL_REGISTERED_OTHER_PROVIDER` | 409 | Sync Google: el email ya está registrado con correo+contraseña |
| `03` | `GENERIC_LOGIN_ERROR` | 400 | Error de login genérico (contacta con soporte) |
| `04` | `MISSING_FIELDS` | 400 | Faltan campos obligatorios |
| `05` | `INVALID_EMAIL` | 400 | Email inválido |
| `06` | `EMAIL_ALREADY_REGISTERED` | 409 | Registro / envío de código: el email ya está registrado |
| `07` | `VERIFICATION_CODE_EXPIRED` | 400 | Código de verificación expirado |
| `08` | `VERIFICATION_CODE_INCORRECT` | 400 | Código de verificación incorrecto |
| `09` | `PASSWORD_PROCESSING_ERROR` | 400 | Error al desencriptar la contraseña |

Aplicación por endpoint:

| Endpoint | Códigos posibles |
|----------|------------------|
| `POST /api/auth/send-verification` | `05`, `06` |
| `POST /api/auth/register` | `04`, `06`, `07`, `08`, `09` |
| `POST /api/auth/login` | `01`, `04`, `09` |
| `POST /api/auth/sync` | `02` |

### Cómo añadir un nuevo error

1. Añade la entrada en `AUTH_ERRORS` de `src/utils/errorCodes.js` con el siguiente
   código libre (`10`, `11`, ...). **Nunca reutilices un código ya asignado.**
2. Úsalo en el controlador con `sendError(res, AUTH_ERRORS.MI_ERROR)`.
3. Documenta el nuevo código en esta tabla **y** en el mapa del frontend
   (`fixRadar_frontend/lib/core/utils/auth_error_mapper.dart` + su README).

### Despliegue y compatibilidad con el cliente

> ⚠️ Estos `code` solo llegan al cliente **después de desplegar** el backend
> (producción: `app.fixesradar.com`). Mientras no se redespliega, el servidor
> sigue devolviendo el formato viejo (p. ej. `{"error":"Email already exists"}`
> sin `code`). El frontend ya contempla esto: mapea mensajes legacy conocidos a
> su código (ver `AuthErrorMapper`), pero lo correcto es **redesplegar** para que
> todos los errores lleguen con `code`.
