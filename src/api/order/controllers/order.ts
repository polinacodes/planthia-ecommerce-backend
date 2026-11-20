// src/api/order/controllers/order.ts
import { factories } from '@strapi/strapi';
import { MercadoPagoConfig, Preference } from 'mercadopago';
import { CheckoutError } from '../services/order';

const PAYMENT_METHODS = ['mercadopago', 'paypal'];
const REQUIRED_FIELDS = ['email', 'first_name', 'last_name', 'phone', 'address', 'city', 'zip_code'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Devuelve el id del usuario logueado si el request trae un JWT válido. */
async function getLoggedUserId(ctx): Promise<number | null> {
  try {
    const payload: any = await strapi.plugin('users-permissions').service('jwt').getToken(ctx);
    return payload?.id ? Number(payload.id) : null;
  } catch {
    return null;
  }
}

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async createCheckout(ctx) {
    const body = ctx.request.body || {};

    // 1. VALIDACIONES
    for (const field of REQUIRED_FIELDS) {
      if (!body[field] || !String(body[field]).trim()) {
        return ctx.badRequest('Completá todos los datos de envío');
      }
    }

    const email = String(body.email).trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) return ctx.badRequest('El email no es válido');

    const paymentMethod = body.payment_method;
    if (!PAYMENT_METHODS.includes(paymentMethod)) return ctx.badRequest('Elegí un medio de pago');

    const customer = {
      first_name: String(body.first_name).trim(),
      last_name: String(body.last_name).trim(),
      phone: String(body.phone).trim(),
      address: String(body.address).trim(),
      city: String(body.city).trim(),
      zip_code: String(body.zip_code).trim(),
    };

    // 2. PRECIOS, STOCK Y DESCUENTO CALCULADOS EN EL BACKEND
    let summary;
    try {
      summary = await strapi.service('api::order.order').buildOrderFromCart(body.cart, body.discount_code);
    } catch (error) {
      if (error instanceof CheckoutError) return ctx.badRequest(error.message);
      throw error;
    }

    try {
      // 3. USUARIO
      const existingUser: any = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { email },
      });

      let user = existingUser;
      if (!existingUser) {
        user = await strapi.plugin('users-permissions').service('user').add({
          email,
          username: email,
          ...customer,
          confirmed: true,
          blocked: false,
          provider: 'local',
          role: await getAuthenticatedRoleId(),
        });
      } else {
        // Solo se actualizan los datos guardados si quien compra es la dueña de la cuenta.
        // Si no, cualquiera podría pisar la dirección de otra persona poniendo su email.
        const loggedUserId = await getLoggedUserId(ctx);
        if (loggedUserId === existingUser.id) {
          await strapi.db.query('plugin::users-permissions.user').update({
            where: { id: existingUser.id },
            data: customer,
          });
        }
      }

      // 4. PEDIDO
      const order: any = await strapi.db.query('api::order.order').create({
        data: {
          user: user.id,
          customer_email: email,
          ...customer,
          items: summary.items,
          subtotal: summary.subtotal,
          shipping_cost: summary.shippingCost,
          discount_code: summary.discountCode,
          discount_amount: summary.discountAmount,
          total: summary.total,
          payment_method: paymentMethod,
          order_status: 'pending',
          is_new_user: !existingUser,
        },
      });

      // 5. PAGO
      if (paymentMethod === 'mercadopago') {
        const mercadoPagoUrl = await createMercadoPagoPreference(order, summary, email);
        return ctx.send({ ok: true, orderId: order.id, mercadoPagoUrl });
      }

      const { paypalOrderId, approveUrl } = await strapi
        .service('api::order.paypal')
        .createOrder({ orderId: order.id, totalArs: summary.total });

      await strapi.db.query('api::order.order').update({
        where: { id: order.id },
        data: { payment_id: paypalOrderId },
      });

      return ctx.send({ ok: true, orderId: order.id, paypalUrl: approveUrl });
    } catch (error) {
      strapi.log.error(`[checkout] ${error}`);
      return ctx.internalServerError('No pudimos iniciar el pago. Probá de nuevo en unos minutos.');
    }
  },

  async myOrders(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('Debes iniciar sesión');

    const orders = await strapi.db.query('api::order.order').findMany({
      where: { user: { id: user.id } },
      orderBy: { createdAt: 'desc' },
    });

    return { data: orders };
  },
}));

async function getAuthenticatedRoleId(): Promise<number> {
  const role: any = await strapi.db
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'authenticated' } });
  return role.id;
}

async function createMercadoPagoPreference(order: any, summary: any, email: string) {
  const client = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || '' });

  // MP no acepta ítems con precio negativo: si hay descuento, se manda un
  // solo ítem con el total de productos ya descontado.
  const items =
    summary.discountAmount > 0
      ? [
          {
            id: `order-${order.id}`,
            title: `Compra en Planthia - Pedido #${order.id}`,
            quantity: 1,
            unit_price: Math.round((summary.subtotal - summary.discountAmount) * 100) / 100,
            currency_id: 'ARS',
          },
        ]
      : summary.items.map((item: any) => ({
          id: String(item.productId),
          title: item.color ? `${item.name} (${item.color})` : item.name,
          quantity: item.quantity,
          unit_price: item.price,
          currency_id: 'ARS',
        }));

  const frontendUrl = process.env.FRONTEND_URL;
  const preferenceData: any = {
    items,
    payer: { email },
    back_urls: {
      success: `${frontendUrl}/payment-status?status=success&order=${order.id}`,
      failure: `${frontendUrl}/payment-status?status=failure&order=${order.id}`,
      pending: `${frontendUrl}/payment-status?status=pending&order=${order.id}`,
    },
    external_reference: String(order.id),
    notification_url: `${process.env.STRAPI_URL}/api/mercadopago/webhook`,
  };

  // El envío antes no se cobraba en Mercado Pago
  if (summary.shippingCost > 0) {
    preferenceData.shipments = { cost: summary.shippingCost, mode: 'not_specified' };
  }

  if (frontendUrl?.startsWith('https')) {
    preferenceData.auto_return = 'approved';
  }

  const response = await new Preference(client).create({ body: preferenceData });

  return process.env.NODE_ENV === 'production' ? response.init_point : response.sandbox_init_point;
}
