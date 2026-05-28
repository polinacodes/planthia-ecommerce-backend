// // src/api/order/controllers/order.ts

import { factories } from '@strapi/strapi';
import { MercadoPagoConfig, Preference } from 'mercadopago';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default factories.createCoreController('api::order.order', ({ strapi }) => ({

  async createCheckout(ctx) {
    try {
      const {
        email, first_name, last_name, phone, address, city, zip_code,
        cart, payment_method, subtotal, shipping_cost,
        discount_code, discount_amount, total
      } = ctx.request.body;

      // 1. MANEJO DE USUARIO
      const existingUser = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { email: email.toLowerCase() },
      });

      let user;
      if (!existingUser) {
        user = await strapi.plugin('users-permissions').service('user').add({
          email: email.toLowerCase(),
          username: email.toLowerCase(),
          first_name,
          last_name,
          phone,
          address,
          city,
          zip_code,
          confirmed: true,
          role: 1,
        });
        console.log(`✅ Usuario creado: ${user.email}`);
      } else {
        user = await strapi.db.query('plugin::users-permissions.user').update({
          where: { id: existingUser.id },
          data: { first_name, last_name, phone, address, city, zip_code },
        });
        console.log(`✅ Usuario actualizado: ${user.email}`);
      }

      // 2. CREAR ORDEN
      const order = await strapi.entityService.create('api::order.order', {
        data: {
          user: user.id,
          customer_email: email,
          first_name,
          last_name,
          phone,
          address,
          city,
          zip_code,
          items: cart,
          subtotal,
          shipping_cost,
          discount_code,
          discount_amount,
          total,
          payment_method,
          order_status: 'pending',
          is_new_user: !existingUser, 
          publishedAt: new Date(),
        },
      });

      if (!order) throw new Error("No se pudo crear la orden");

      // 3. PROCESAR PAGO
      if (payment_method === 'mercadopago') {
        const client = new MercadoPagoConfig({
          accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || ''
        });
        const preference = new Preference(client);

        const items = cart.map((item: any) => ({
          title: item.name || item.title,
          quantity: Number(item.quantity),
          unit_price: Number(item.price),
          currency_id: 'ARS'
        }));

        if (discount_amount > 0) {
          items.push({
            title: 'Descuento',
            quantity: 1,
            unit_price: -Number(discount_amount),
            currency_id: 'ARS'
          });
        }

        const preferenceData: any = {
          items,
          payer: { email },
          back_urls: {
            success: `${process.env.FRONTEND_URL}/payment-status?status=success&order=${order.id}`,
            failure: `${process.env.FRONTEND_URL}/payment-status?status=failure&order=${order.id}`,
            pending: `${process.env.FRONTEND_URL}/payment-status?status=pending&order=${order.id}`
          },
          external_reference: order.id.toString(),
          notification_url: `${process.env.STRAPI_URL}/api/mercadopago/webhook`,
        };

        const isHttps = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.startsWith('https') : false;
        if (isHttps) {
          preferenceData.auto_return = 'approved';
        }

        const response = await preference.create({
          body: preferenceData
        });

        const mpUrl = process.env.NODE_ENV === 'production'
          ? response.init_point
          : response.sandbox_init_point;

        return ctx.send({ ok: true, orderId: order.id, mercadoPagoUrl: mpUrl });
      }

      if (payment_method === 'paypal') {
        const paypalController = strapi.controller('api::order.paypal') as any;
        const ppData = await paypalController.createOrder(ctx, { total, orderId: order.id });
        return ctx.send({ ok: true, orderId: order.id, paypalUrl: ppData.paypalUrl });
      }

      return ctx.send({ ok: true, orderId: order.id });

    } catch (error) {
      console.error("Error en checkout:", error);
      return ctx.internalServerError(error instanceof Error ? error.message : 'Error en checkout');
    }
  },

  // ACTUALIZAR ESTADO DE ORDEN
  async updateStatus(ctx) {
    const { id } = ctx.params;
    const { order_status } = ctx.request.body;

    try {
      const order: any = await strapi.entityService.findOne('api::order.order', id, {
        populate: ['user']
      });

      if (!order) return ctx.notFound('Orden no encontrada');

      // El lifecycle afterUpdate se dispara automáticamente
      await strapi.entityService.update('api::order.order', id, {
        data: { order_status }
      });

      return ctx.send({ ok: true, message: 'Orden actualizada' });

    } catch (error) {
      console.error('Error en updateStatus:', error);
      return ctx.internalServerError('Error actualizando orden');
    }
  },

  async findOne(ctx) {
    const entity = await strapi.entityService.findOne('api::order.order', ctx.params.id, {
      populate: '*'
    });
    if (!entity) return ctx.notFound('Orden no encontrada');
    return ctx.send({ data: entity });
  },

  async myOrders(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized('Debes iniciar sesión');
    }

    const orders = await strapi.entityService.findMany('api::order.order', {
      filters: {
        user: {
          id: user.id
        }
      },
      populate: '*',
      sort: { createdAt: 'desc' },
    });

    return { data: orders };
  },
}));