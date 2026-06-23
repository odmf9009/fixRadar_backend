// ─── Nomenclador de errores de autenticación ─────────────────────────────────
//
// El backend devuelve siempre un `code` numérico estable. El frontend usa ese
// `code` para mostrar el texto en el idioma del usuario (es / en). El campo
// `message` se mantiene como fallback legible (es) por compatibilidad.
//
//   01 → Contraseña / credenciales incorrectas
//   02 → El email ya existe registrado con correo y contraseña (intento Google)
//   03 → Error de inicio de sesión genérico (contacta con soporte)
//   04 → Faltan campos obligatorios
//   05 → Email inválido
//   06 → El email ya está registrado (intento de registro duplicado)
//   07 → Código de verificación expirado
//   08 → Código de verificación incorrecto
//   09 → Error al procesar la contraseña
//
// Para añadir nuevos errores: usa el siguiente código libre (10, 11, ...) y
// nunca reutilices un código ya asignado.

const AUTH_ERRORS = {
  INCORRECT_PASSWORD: {
    code: '01',
    status: 401,
    message: 'Credenciales incorrectas',
  },
  EMAIL_REGISTERED_OTHER_PROVIDER: {
    code: '02',
    status: 409,
    message:
      'Este email ya está registrado con correo y contraseña. Inicia sesión con tu contraseña.',
  },
  GENERIC_LOGIN_ERROR: {
    code: '03',
    status: 400,
    message: 'Error de inicio de sesión. Contacta con soporte.',
  },
  MISSING_FIELDS: {
    code: '04',
    status: 400,
    message: 'Todos los campos son requeridos',
  },
  INVALID_EMAIL: {
    code: '05',
    status: 400,
    message: 'Email inválido',
  },
  EMAIL_ALREADY_REGISTERED: {
    code: '06',
    status: 409,
    message: 'Este email ya está registrado. Inicia sesión.',
  },
  VERIFICATION_CODE_EXPIRED: {
    code: '07',
    status: 400,
    message: 'Código expirado. Solicita uno nuevo.',
  },
  VERIFICATION_CODE_INCORRECT: {
    code: '08',
    status: 400,
    message: 'Código incorrecto',
  },
  PASSWORD_PROCESSING_ERROR: {
    code: '09',
    status: 400,
    message: 'Error al procesar la contraseña',
  },
};

// Envía una respuesta de error consistente con `code`, `error` y `message`.
// `overrides` permite ajustar status/message puntualmente sin perder el código.
function sendError(res, errorDef, overrides = {}) {
  const { code, status, message } = { ...errorDef, ...overrides };
  return res.status(status).json({ code, error: message, message });
}

module.exports = { AUTH_ERRORS, sendError };
