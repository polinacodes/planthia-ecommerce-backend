// src/api/order/controllers/order.ts
import { factories } from '@strapi/strapi';
import { MercadoPagoConfig, Preference } from 'mercadopago';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

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

  async updateStatus(ctx) {
    const { id } = ctx.params;
    const { order_status } = ctx.request.body;

    try {
      // 1. Buscar la orden con el usuario populado
      const order = await strapi.db.query('api::order.order').findOne({
        where: { id: id },
        populate: ['user'] 
      });

      if (!order) return ctx.notFound('Orden no encontrada');

      // 2. Actualizar estado de la orden
      await strapi.db.query('api::order.order').update({
        where: { id: id },
        data: { order_status }
      });

      // 3. SI EL PAGO ES EXITOSO
      if (order_status === 'paid') {
        
        // --- LÓGICA DE STOCK (REVISAR) ---
        if (order.items) {
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
                // data: { dataToUpdate }
                data: dataToUpdate
              });
            }
          }
        }

        if (order.discount_code) {
          try {
            console.log(`🎟️ Intentando marcar cupón usado: ${order.discount_code}`);
            
            const newsletterEntry = await strapi.db.query('api::newsletter.newsletter').findOne({
              where: { discount_code: order.discount_code }
            });

            if (newsletterEntry) {
              await strapi.db.query('api::newsletter.newsletter').update({
                where: { id: newsletterEntry.id },
                data: { discount_used: true }
              });
              console.log(`✅ Cupón ${order.discount_code} marcado como usado.`);
            }
          } catch (couponError) {
            console.error('❌ Error actualizando estado del cupón:', couponError);
          }
        }


        // --- LÓGICA DE EMAIL DE BIENVENIDA ---
        try {
          const resetPasswordToken = await strapi.plugins['users-permissions'].services.jwt.issue({ 
            id: order.user.id 
          });
          
          const settingsUrl = `${process.env.FRONTEND_URL}/set-password?code=${resetPasswordToken}`;

          console.log(`📧 Enviando mail de bienvenida a: ${order.customer_email}`);

          await resend.emails.send({
            from: 'Planthia <delivered@resend.dev>', // Cambiar esto por dominio validado cuando lo tenga
            to: [order.customer_email],
            subject: '🌱 ¡Bienvenido a Planthia! Configura tu cuenta',
            html: `
              <div style="font-family: sans-serif; max-width: 600px; color: #333;">
                <h2>¡Gracias por tu compra, ${order.first_name}!</h2>
                <p>Tu pedido <strong>#${id}</strong> está siendo procesado.</p>
                <p>Para que puedas ver el historial de tus órdenes y gestionar tu perfil, hemos creado una cuenta para vos.</p>
                <div style="margin: 30px 0;">
                  <a href="${settingsUrl}" 
                     style="background: #2D5A27; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                     Configurar mi contraseña
                  </a>
                </div>
                <p style="font-size: 12px; color: #666;">
                  Si el botón no funciona, copiá este link: <br> ${settingsUrl}
                </p>
              </div>
            `,
          });
          
          console.log('✅ Mail enviado con éxito');
        } catch (emailError) {
          console.error('❌ Error enviando mail de bienvenida:', emailError);
        }
      }

      return ctx.send({ ok: true, message: 'Orden actualizada' });
    } catch (error) {
      console.error('Error en updateStatus:', error);
      return ctx.internalServerError('Error actualizando orden');
    }
  }
}));