// src/api/auth/controllers/auth.ts
import { randomBytes } from 'crypto';
import { Resend } from 'resend';

const USER_UID = 'plugin::users-permissions.user';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

// Vencimiento de los links para crear o cambiar la contraseña
export const RESET_LINK_TTL_MS = 60 * 60 * 1000; // "¿Olvidaste tu contraseña?": 1 hora
export const NEW_CUSTOMER_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // mail de primera compra: 7 días

// Mismo mensaje para mail inexistente y contraseña incorrecta: así no se puede
// averiguar qué mails están registrados.
const INVALID_CREDENTIALS =
  'Email o contraseña incorrectos. Si compraste sin crear una cuenta, usá "¿Olvidaste tu contraseña?".';

const PROFILE_FIELDS = ['first_name', 'last_name', 'phone', 'address', 'city', 'zip_code'] as const;

/** Datos del usuario que se pueden devolver al front (nunca contraseña ni tokens). */
const publicUser = (user: any) => ({
  id: user.id,
  documentId: user.documentId,
  username: user.username,
  email: user.email,
  first_name: user.first_name ?? null,
  last_name: user.last_name ?? null,
  phone: user.phone ?? null,
  address: user.address ?? null,
  city: user.city ?? null,
  zip_code: user.zip_code ?? null,
  createdAt: user.createdAt,
});

const issueJwt = (userId: number) =>
  strapi.plugin('users-permissions').service('jwt').issue({ id: userId });

async function getAuthenticatedRoleId(): Promise<number> {
  const role: any = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: 'authenticated' },
  });
  return role.id;
}

export default {
  async customRegister(ctx) {
    const body = ctx.request.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!EMAIL_REGEX.test(email)) return ctx.badRequest('El email no es válido');
    if (password.length < MIN_PASSWORD_LENGTH) {
      return ctx.badRequest(`La contraseña tiene que tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
    }

    const existingUser = await strapi.db.query(USER_UID).findOne({ where: { email } });
    if (existingUser) {
      return ctx.badRequest('Ya existe una cuenta con este email. Probá iniciar sesión o recuperar tu contraseña.');
    }

    // El formulario manda el nombre como "username"; también se aceptan los nombres de campo del perfil
    const firstName = String(body.first_name ?? body.nombre ?? body.username ?? '').trim();
    const lastName = String(body.last_name ?? body.apellido ?? '').trim();

    try {
      const user = await strapi.plugin('users-permissions').service('user').add({
        email,
        username: email,
        password,
        provider: 'local',
        confirmed: true,
        blocked: false,
        role: await getAuthenticatedRoleId(),
        first_name: firstName,
        last_name: lastName,
      });

      return ctx.send({ jwt: issueJwt(user.id), user: publicUser(user) });
    } catch (error) {
      strapi.log.error(`[auth] Error al crear usuario: ${error}`);
      return ctx.internalServerError('No pudimos crear la cuenta. Probá de nuevo en unos minutos.');
    }
  },

  async customLogin(ctx) {
    const email = String(ctx.request.body?.email || '').trim().toLowerCase();
    const password = String(ctx.request.body?.password || '');

    if (!email || !password) return ctx.badRequest('Completá el email y la contraseña');

    const user: any = await strapi.db.query(USER_UID).findOne({ where: { email } });

    const userService = strapi.plugin('users-permissions').service('user');
    const valid = !!user?.password && (await userService.validatePassword(password, user.password));

    if (!valid) return ctx.badRequest(INVALID_CREDENTIALS);
    if (user.blocked) return ctx.forbidden('Tu cuenta está bloqueada. Escribinos para resolverlo.');

    return ctx.send({ jwt: issueJwt(user.id), user: publicUser(user) });
  },

  async customForgotPassword(ctx) {
    const email = String(ctx.request.body?.email || '').trim().toLowerCase();
    if (!email) return ctx.badRequest('Email requerido');

    // Siempre la misma respuesta, exista o no el mail
    const genericResponse = { ok: true, message: 'Si el email está registrado, te enviamos un link.' };

    const user: any = await strapi.db.query(USER_UID).findOne({ where: { email } });
    if (!user || user.blocked) return ctx.send(genericResponse);

    const resetCode = randomBytes(32).toString('hex');
    await strapi.db.query(USER_UID).update({
      where: { id: user.id },
      data: {
        resetPasswordToken: resetCode,
        resetPasswordTokenExpiresAt: new Date(Date.now() + RESET_LINK_TTL_MS),
      },
    });

    try {
      const key = process.env.RESEND_API_KEY;
      if (key) {
        await new Resend(key).emails.send({
          from: 'Planthia <noreply@polinacodes.dev>',
          to: [email],
          subject: 'Restablecé tu contraseña - Planthia',
          template: {
            id: 'password-reset-1',
            variables: {
              firstName: user.first_name || 'cliente',
              resetUrl: `${process.env.FRONTEND_URL}/set-password?code=${resetCode}`,
            },
          },
        });
      }
    } catch (error) {
      strapi.log.error(`[auth] Error enviando el mail de recuperación: ${error}`);
    }

    return ctx.send(genericResponse);
  },

  async resetPasswordWithToken(ctx) {
    const { code, password, passwordConfirmation } = ctx.request.body || {};

    if (!code || !password || !passwordConfirmation) return ctx.badRequest('Faltan datos');
    if (password !== passwordConfirmation) return ctx.badRequest('Las contraseñas no coinciden');
    if (String(password).length < MIN_PASSWORD_LENGTH) {
      return ctx.badRequest(`La contraseña tiene que tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
    }

    const user: any = await strapi.db.query(USER_UID).findOne({
      where: { resetPasswordToken: String(code) },
    });

    const expiresAt = user?.resetPasswordTokenExpiresAt ? new Date(user.resetPasswordTokenExpiresAt).getTime() : 0;
    // Los links creados antes de este cambio no tienen vencimiento guardado: se aceptan una vez
    const expired = user?.resetPasswordTokenExpiresAt ? expiresAt < Date.now() : false;

    if (!user || expired) {
      return ctx.badRequest('El link venció o ya se usó. Pedí uno nuevo desde "¿Olvidaste tu contraseña?".');
    }
    if (user.blocked) return ctx.forbidden('Tu cuenta está bloqueada. Escribinos para resolverlo.');

    await strapi.plugin('users-permissions').service('user').edit(user.id, {
      password,
      resetPasswordToken: null,
      resetPasswordTokenExpiresAt: null,
    });

    return ctx.send({ jwt: issueJwt(user.id), user: publicUser(user) });
  },

  /**
   * PUT /api/profile
   * La persona logueada edita SUS datos. Reemplaza al PUT /users/:id del
   * plugin, que permitía editar a cualquier usuario.
   */
  async updateProfile(ctx) {
    const userId = ctx.state.user?.id;
    if (!userId) return ctx.unauthorized('Tenés que iniciar sesión');

    const body = ctx.request.body || {};
    const data: Record<string, string> = {};
    for (const field of PROFILE_FIELDS) {
      if (body[field] !== undefined) data[field] = String(body[field] ?? '').trim();
    }

    const updated = await strapi.db.query(USER_UID).update({ where: { id: userId }, data });
    return ctx.send(publicUser(updated));
  },
};
