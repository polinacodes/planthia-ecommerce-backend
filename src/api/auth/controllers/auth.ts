// src/api/auth/controllers/auth.ts
export default {
  async customRegister(ctx) {
    const { email, password, nombre, apellido, telefono, direccion, ciudad, codigoPostal } = ctx.request.body;

    // Validaciones básicas
    if (!email || !password) {
      return ctx.badRequest('❌ Email y contraseña son requeridos');
    }

    // Verificar si el usuario ya existe
    const existingUser = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { email: email }
    });

    if (existingUser) {
      return ctx.badRequest('❌ Ya existe un usuario con este email');
    }

    try {
      // Crear el usuario usando el servicio nativo de Strapi
      const newUser = await strapi.plugins['users-permissions'].services.user.add({
        email: email,
        username: email,
        password: password,
        confirmed: true,
        blocked: false,
        role: 1, // Rol "Authenticated"
        nombre: nombre || '',
        apellido: apellido || '',
        telefono: telefono || '',
        direccion: direccion || '',
        ciudad: ciudad || '',
        codigo_postal: codigoPostal || '',
      });

      // Respuesta exitosa
      return ctx.send({
        ok: true,
        message: '✅ Usuario creado exitosamente',
        user: {
          id: newUser.id,
          email: newUser.email,
          nombre: newUser.nombre,
          apellido: newUser.apellido,
        },
      });
    } catch (error) {
      console.error('❌ Error al crear usuario:', error);
      return ctx.internalServerError('❌ Error interno al crear el usuario');
    }
  },

  async resetPasswordWithToken(ctx) {
    const { code, password, passwordConfirmation } = ctx.request.body;

    if (!code || !password || !passwordConfirmation) {
      return ctx.badRequest('Faltan datos');
    }

    if (password !== passwordConfirmation) {
      return ctx.badRequest('Las contraseñas no coinciden');
    }

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { resetPasswordToken: code },
    });

    if (!user) {
      return ctx.badRequest('Código inválido o expirado');
    }

    await strapi.plugin('users-permissions').service('user').edit(user.id, {
      password,
      resetPasswordToken: null,
    });

    const jwt = strapi.plugin('users-permissions').service('jwt').issue({
      id: user.id,
    });

    return ctx.send({
      jwt,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    });
  },
  async customLogin(ctx) {
  const { email, password } = ctx.request.body;

  if (!email || !password) {
    return ctx.badRequest('Email y contraseña requeridos');
  }

  // Buscar usuario
  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { email: email.toLowerCase() },
  });

  if (!user) {
    return ctx.badRequest('Usuario no encontrado');
  }

  // Verificar contraseña manualmente con bcrypt
  const bcrypt = require('bcryptjs');
  
  // Si no tiene password 
  if (!user.password) {
    return ctx.badRequest('Usuario no tiene contraseña configurada');
  }

  const valid = await bcrypt.compare(password, user.password);

  if (!valid) {
    return ctx.badRequest('Contraseña incorrecta');
  }

  // Generar JWT
  const jwt = strapi.plugin('users-permissions').service('jwt').issue({
    id: user.id,
  });

  return ctx.send({
    jwt,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
    },
  });
},
};