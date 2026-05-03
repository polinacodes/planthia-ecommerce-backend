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
};