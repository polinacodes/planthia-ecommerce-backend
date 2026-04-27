// src/api/order/controllers/order.ts
import { factories } from '@strapi/strapi';
import { MercadoPagoConfig, Preference } from 'mercadopago';

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async createCheckout(ctx) {
    try {
      const { email, first_name, last_name, phone, address, city, zip_code, cart, payment_method, subtotal, shipping_cost, discount_code, discount_amount, total } = ctx.request.body;

      // 1. BUSCAR O CREAR USUARIO
      let user = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { email: email.toLowerCase() }
      });

      if (!user) {
        user = await strapi.plugins['users-permissions'].services.user.add({
          email: email.toLowerCase(),
          username: email.toLowerCase(),
          password: Math.random().toString(36).slice(-8),
          confirmed: true,
          role: 1
        });
      }

      // 2. CREAR LA ORDEN
      const order = await strapi.db.query('api::order.order').create({
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
          publishedAt: new Date()
        },
      });

      if (!order) {
        throw new Error("No se pudo crear la orden");
      }

      // 3. PROCESAR PAGO SEGÚN MÉTODO
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

        const preferenceData = {
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

        console.log('Creando preferencia MP:', JSON.stringify(preferenceData, null, 2));
        const response = await preference.create({ body: preferenceData });
        console.log('Respuesta MP:', { id: response.id, init_point: response.init_point });
        
        return ctx.send({ 
          ok: true, 
          orderId: order.id, 
          mercadoPagoUrl: response.init_point 
        });
      }

      if (payment_method === 'paypal') {
        // Aca iria la lógica de PayPal
        return ctx.send({ ok: true, orderId: order.id });
      }

      return ctx.send({ ok: true, orderId: order.id });
    } catch (error) {
      console.error("Error en checkout:", error);
      const errorMessage = error instanceof Error ? error.message : 'Error en checkout';
      return ctx.internalServerError(errorMessage);
    }
  },

  async findOne(ctx) {
    const { id } = ctx.params;
    const entity = await strapi.db.query('api::order.order').findOne({ 
      where: { id }, 
      populate: { '*': true } 
    });
    if (!entity) return ctx.notFound('Orden no encontrada');
    return entity;
  }
}));