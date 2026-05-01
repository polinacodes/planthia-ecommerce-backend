// src/api/order/controllers/order.ts
import { factories } from '@strapi/strapi';
import { MercadoPagoConfig, Preference } from 'mercadopago';

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async createCheckout(ctx) {
    try {
      const { email, first_name, last_name, phone, address, city, zip_code, cart, payment_method, subtotal, shipping_cost, discount_code, discount_amount, total } = ctx.request.body;

      // 1. BUSCAR USUARIO EXISTENTE
      let user = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { email: email.toLowerCase() }
      });

      const userData = {
        first_name,
        last_name,
        phone,
        address,
        city,
        zip_code,
        confirmed: true,
      };

      if (!user) {
        // 2. SI NO EXISTE, CREARLO CON TODOS LOS DATOS
        console.log("Creando nuevo usuario para:", email);
        user = await strapi.plugins['users-permissions'].services.user.add({
          ...userData,
          email: email.toLowerCase(),
          username: email.toLowerCase(),
          password: Math.random().toString(36).slice(-8),
          role: 1
        });
      } else {
        // 3. SI EXISTE, ACTUALIZAR SUS DATOS 
        console.log("Actualizando datos del usuario existente:", email);
        await strapi.plugins['users-permissions'].services.user.edit(user.id, userData);
      }

      // CREAR LA ORDEN
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

      //  PROCESAR PAGO SEGÚN MÉTODO
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
        try {
          const paypalController = strapi.controller('api::order.paypal') as any;
          const ppData = await paypalController.createOrder(ctx, {
            total,
            orderId: order.id
          });

          if (!ppData || !ppData.paypalUrl) {
            throw new Error("No se pudo crear la orden de PayPal");
          }

          return ctx.send({
            ok: true,
            orderId: order.id,
            paypalUrl: ppData.paypalUrl
          });
        } catch (paypalError) {
          console.error("Error creando orden PayPal:", paypalError);
          throw new Error("Error al crear la orden de PayPal");
        }
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
  },

  // async updateStatus(ctx) {
  //   const { id } = ctx.params;
  //   const { order_status } = ctx.request.body;

  //   try {
  //     await strapi.db.query('api::order.order').update({
  //       where: { id: id },
  //       data: { order_status }
  //     });

  //     return ctx.send({ ok: true, message: 'Orden actualizada' });
  //   } catch (error) {
  //     console.error('Error actualizando estado:', error);
  //     return ctx.internalServerError('Error actualizando orden');
  //   }
  // }

  // async updateStatus(ctx) {
  //   const { id } = ctx.params;
  //   const { order_status } = ctx.request.body;

  //   try {
  //     // 1. Obtener la orden antes de actualizar
  //     const order = await strapi.db.query('api::order.order').findOne({
  //       where: { id: id }
  //     });

  //     if (!order) {
  //       return ctx.notFound('Orden no encontrada');
  //     }

  //     // 2. Actualizar estado
  //     await strapi.db.query('api::order.order').update({
  //       where: { id: id },
  //       data: { order_status }
  //     });

  //     // 3. Si pasa a "paid", descontar stock
  //     if (order_status === 'paid' && order.items) {
  //       console.log(`📦 Descontando stock para orden #${id}`);

  //       for (const item of order.items) {
  //         if (item.productId) {
  //           const product = await strapi.db.query('api::product.product').findOne({
  //             where: { id: item.productId }
  //           });

  //           if (product) {
  //             const nuevoStock = Math.max(0, (product.stock || 0) - (item.quantity || 1));
  //             await strapi.db.query('api::product.product').update({
  //               where: { id: item.productId },
  //               data: { stock: nuevoStock }
  //             });
  //             console.log(`  ✅ Producto #${item.productId}: stock ${product.stock} → ${nuevoStock}`);
  //           }
  //         }
  //       }
  //     }

  //     return ctx.send({ ok: true, message: 'Orden actualizada' });
  //   } catch (error) {
  //     console.error('Error actualizando estado:', error);
  //     return ctx.internalServerError('Error actualizando orden');
  //   }
  // }

  async updateStatus(ctx) {
    const { id } = ctx.params;
    const { order_status } = ctx.request.body;

    try {
      const order = await strapi.db.query('api::order.order').findOne({
        where: { id: id }
      });

      if (!order) return ctx.notFound('Orden no encontrada');

      await strapi.db.query('api::order.order').update({
        where: { id: id },
        data: { order_status }
      });

      if (order_status === 'paid' && order.items) {
        for (const item of order.items) {
          const rawId = (item.productId || item.id).toString();
          const baseId = rawId.split('-')[0];

          const product = await strapi.db.query('api::product.product').findOne({
            where: { id: baseId },
            populate: ['variants']
          });

          if (product) {
            let dataToUpdate: any = {};
            const quantity = item.quantity || 1;

            if (rawId.includes('-') && product.variants?.length > 0) {
              const colorVariant = rawId.split('-')[1];
              dataToUpdate.variants = product.variants.map((v: any) =>
                v.color.toLowerCase() === colorVariant.toLowerCase()
                  ? { ...v, stock: Math.max(0, (v.stock || 0) - quantity) }
                  : v
              );
            } else {
              dataToUpdate.stock = Math.max(0, (product.stock || 0) - quantity);
            }

            await strapi.db.query('api::product.product').update({
              where: { id: baseId },
              data: dataToUpdate
            });
          }
        }
      }
      return ctx.send({ ok: true, message: 'Orden actualizada' });
    } catch (error) {
      return ctx.internalServerError('Error actualizando orden');
    }
  }
}));