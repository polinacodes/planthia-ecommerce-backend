import { factories } from '@strapi/strapi';
import { randomBytes } from 'crypto';
import { Resend } from 'resend';

const NEWSLETTER_UID = 'api::newsletter.newsletter';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISCOUNT_PERCENT = 10;

/** WELCOME10_ + 8 caracteres aleatorios (crypto, no Math.random) */
const generateDiscountCode = () =>
  `WELCOME${DISCOUNT_PERCENT}_${randomBytes(6).toString('base64url').replace(/[-_]/g, 'X').slice(0, 8).toUpperCase()}`;

/** Código secreto para el link de baja (no se usa el email, así nadie puede dar de baja a otro) */
const generateUnsubscribeToken = () => randomBytes(24).toString('base64url');

export default factories.createCoreController(NEWSLETTER_UID, ({ strapi }) => ({
  async subscribe(ctx) {
    const email = String(ctx.request.body?.data?.email ?? '').trim().toLowerCase();

    if (!EMAIL_REGEX.test(email)) {
      return ctx.badRequest('Ingresá un email válido');
    }

    const existing = await strapi.db.query(NEWSLETTER_UID).findOne({ where: { email } });
    if (existing) {
      // Si se había dado de baja, vuelve a suscribirse (sin un segundo código de descuento)
      if (existing.unsubscribed_at) {
        await strapi.db.query(NEWSLETTER_UID).update({
          where: { id: existing.id },
          data: {
            unsubscribed_at: null,
            unsubscribe_token: existing.unsubscribe_token || generateUnsubscribeToken(),
          },
        });
        return ctx.send({ success: true, message: '¡Qué bueno tenerte de vuelta! Ya estás suscripto de nuevo.' });
      }
      return ctx.badRequest('Este email ya está suscripto');
    }

    const discountCode = generateDiscountCode();
    const unsubscribeToken = generateUnsubscribeToken();
    const subscriber = await strapi.db.query(NEWSLETTER_UID).create({
      data: {
        email,
        discount_code: discountCode,
        discount_used: false,
        subscribed_at: new Date(),
        discount_sent: false,
        unsubscribe_token: unsubscribeToken,
        publishedAt: new Date(),
      },
    });

    try {
      const key = process.env.RESEND_API_KEY;
      if (!key) throw new Error('Falta RESEND_API_KEY');

      // Link de baja: la página de la tienda pide confirmar (los antivirus de los correos abren los links solos)
      const unsubscribeUrl = `${process.env.FRONTEND_URL}/newsletter/baja?token=${unsubscribeToken}`;
      // Baja de un clic para Gmail y otros clientes (RFC 8058): POST directo al backend
      const oneClickUrl = `${process.env.STRAPI_URL}/api/newsletter/unsubscribe?token=${unsubscribeToken}`;

      const { error } = await new Resend(key).emails.send({
        from: 'Planthia <noreply@polinacodes.dev>',
        to: [email],
        subject: 'Bienvenida a Planthia - ¡Te enviamos un regalo!',
        template: {
          id: 'bienvenida-planthia',
          variables: { discountCode, unsubscribeUrl },
        },
        headers: {
          'List-Unsubscribe': `<${oneClickUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });
      if (error) throw new Error(error.message);

      await strapi.db.query(NEWSLETTER_UID).update({
        where: { id: subscriber.id },
        data: { discount_sent: true },
      });
    } catch (error) {
      // Si el mail no salió, se borra la suscripción para que pueda volver a intentar
      strapi.log.error(`[newsletter] No se pudo enviar el mail de bienvenida (suscripción ${subscriber.id}): ${error}`);
      await strapi.db.query(NEWSLETTER_UID).delete({ where: { id: subscriber.id } });
      return ctx.internalServerError('No pudimos enviarte el mail. Probá de nuevo en unos minutos.');
    }

    // El código no se devuelve acá: llega solo por mail, así se confirma que el email es real
    return ctx.send({ success: true, message: '¡Suscripción exitosa! Revisá tu email.' });
  },

  async unsubscribe(ctx) {
    // El token llega en el body (página de baja) o en la URL (botón de Gmail)
    const token = String(ctx.request.body?.token ?? ctx.query?.token ?? '').trim();
    if (!token) return ctx.badRequest('Falta el código de baja');

    const subscriber = await strapi.db.query(NEWSLETTER_UID).findOne({ where: { unsubscribe_token: token } });
    if (!subscriber) return ctx.notFound('El link de baja no es válido');

    // No se borra el registro: así el código de descuento sigue valiendo y,
    // si vuelve a suscribirse, no recibe un segundo descuento
    if (!subscriber.unsubscribed_at) {
      await strapi.db.query(NEWSLETTER_UID).update({
        where: { id: subscriber.id },
        data: { unsubscribed_at: new Date() },
      });
    }

    return ctx.send({ success: true, message: 'Listo, ya no vas a recibir más emails de Planthia.' });
  },

  async validateDiscount(ctx) {
    // Al copiar y pegar el código suelen colarse espacios: los sacamos y pasamos a mayúsculas
    const code = String(ctx.request.body?.code ?? '').trim().toUpperCase();

    if (!code) return ctx.badRequest('Ingresá un código de descuento');

    const subscriber = await strapi.db.query(NEWSLETTER_UID).findOne({ where: { discount_code: code } });

    if (!subscriber) return ctx.notFound('El código no es válido');
    if (subscriber.discount_used) return ctx.badRequest('Este código ya fue utilizado');

    return ctx.send({
      valid: true,
      discountAmount: DISCOUNT_PERCENT,
      discountType: 'percentage',
      discountValue: DISCOUNT_PERCENT,
      message: 'Código aplicado correctamente',
    });
  },
}));
