// // src/api/order/controllers/order.ts
// import { factories } from '@strapi/strapi';
// import { MercadoPagoConfig, Preference } from 'mercadopago';
// import { Resend } from 'resend';

// const resend = new Resend(process.env.RESEND_API_KEY);

// export default factories.createCoreController('api::order.order', ({ strapi }) => ({

//   async createCheckout(ctx) {
//     try {
//       const {
//         email, first_name, last_name, phone, address, city, zip_code,
//         cart, payment_method, subtotal, shipping_cost,
//         discount_code, discount_amount, total
//       } = ctx.request.body;

//       // 1. MANEJO DE USUARIO
//       let user = await strapi.db.query('plugin::users-permissions.user').findOne({
//         where: { email: email.toLowerCase() },
//       });

//       if (!user) {
//         // user = await strapi.db.query('plugin::users-permissions.user').create({
//         user = await strapi.plugin('users-permissions').service('user').add({
//           email: email.toLowerCase(),
//           username: email.toLowerCase(),
//           first_name,
//           last_name,
//           phone,
//           address,
//           city,
//           zip_code,
//           confirmed: true,
//           role: 1,
//         });
//         console.log(`✅ Usuario creado: ${user.email}`);
//       } else {
//         user = await strapi.db.query('plugin::users-permissions.user').update({
//           where: { id: user.id },
//           data: { first_name, last_name, phone, address, city, zip_code },
//         });
//         console.log(`✅ Usuario actualizado: ${user.email}`);
//       }

//       // 2. CREAR ORDEN
//       const order = await strapi.entityService.create('api::order.order', {
//         data: {
//           user: user.id,
//           customer_email: email,
//           first_name,
//           last_name,
//           phone,
//           address,
//           city,
//           zip_code,
//           items: cart,
//           subtotal,
//           shipping_cost,
//           discount_code,
//           discount_amount,
//           total,
//           payment_method,
//           order_status: 'pending',
//           publishedAt: new Date(),
//         },
//       });

//       if (!order) throw new Error("No se pudo crear la orden");

//       // 3. PROCESAR PAGO
//       if (payment_method === 'mercadopago') {
//         const client = new MercadoPagoConfig({
//           accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || ''
//         });
//         const preference = new Preference(client);

//         const items = cart.map((item: any) => ({
//           title: item.name || item.title,
//           quantity: Number(item.quantity),
//           unit_price: Number(item.price),
//           currency_id: 'ARS'
//         }));

//         if (discount_amount > 0) {
//           items.push({
//             title: 'Descuento',
//             quantity: 1,
//             unit_price: -Number(discount_amount),
//             currency_id: 'ARS'
//           });
//         }

//         const response = await preference.create({
//           body: {
//             items,
//             payer: { email },
//             back_urls: {
//               success: `${process.env.FRONTEND_URL}/payment-status?status=success&order=${order.id}`,
//               failure: `${process.env.FRONTEND_URL}/payment-status?status=failure&order=${order.id}`,
//               pending: `${process.env.FRONTEND_URL}/payment-status?status=pending&order=${order.id}`
//             },
//             external_reference: order.id.toString(),
//             notification_url: `${process.env.STRAPI_URL}/api/mercadopago/webhook`,
//           }
//         });

//         return ctx.send({ ok: true, orderId: order.id, mercadoPagoUrl: response.init_point });
//       }

//       if (payment_method === 'paypal') {
//         const paypalController = strapi.controller('api::order.paypal') as any;
//         const ppData = await paypalController.createOrder(ctx, { total, orderId: order.id });
//         return ctx.send({ ok: true, orderId: order.id, paypalUrl: ppData.paypalUrl });
//       }

//       return ctx.send({ ok: true, orderId: order.id });

//     } catch (error) {
//       console.error("Error en checkout:", error);
//       return ctx.internalServerError(error instanceof Error ? error.message : 'Error en checkout');
//     }
//   },

//   // ================================================
//   // ACTUALIZAR ESTADO DE ORDEN
//   // ================================================

//   async updateStatus(ctx) {
//     const { id } = ctx.params;
//     const { order_status } = ctx.request.body;

//     try {
//       const order: any = await strapi.entityService.findOne('api::order.order', id, {
//         populate: ['user']
//       });

//       if (!order) return ctx.notFound('Orden no encontrada');

//       await strapi.entityService.update('api::order.order', id, {
//         data: { order_status }
//       });

//       if (order_status === 'paid') {


//         // --- LÓGICA DE STOCK (REVISAR) ---
//         // if (order.items) {
//         //   for (const item of order.items) {
//         //     const rawId = (item.productId || item.id).toString();
//         //     const baseId = rawId.split('-')[0];

//         //     const product = await strapi.db.query('api::product.product').findOne({
//         //       where: { id: baseId },
//         //       populate: ['variants']
//         //     });

//         //     if (product) {
//         //       let dataToUpdate: any = {};
//         //       const quantity = item.quantity || 1;

//         //       if (rawId.includes('-') && product.variants?.length > 0) {
//         //         const colorVariant = rawId.split('-')[1];
//         //         dataToUpdate.variants = product.variants.map((v: any) =>
//         //           v.color.toLowerCase() === colorVariant.toLowerCase()
//         //             ? { ...v, stock: Math.max(0, (v.stock || 0) - quantity) }
//         //             : v
//         //         );
//         //       } else {
//         //         dataToUpdate.stock = Math.max(0, (product.stock || 0) - quantity);
//         //       }

//         //       await strapi.db.query('api::product.product').update({
//         //         where: { id: baseId },
//         //         // data: { dataToUpdate }
//         //         data: dataToUpdate
//         //       });
//         //     }
//         //   }
//         // }

//         // --- CUPÓN ---
//         if (order.discount_code) {
//           try {
//             const entry = await strapi.db.query('api::newsletter.newsletter').findOne({
//               where: { discount_code: order.discount_code }
//             });
//             if (entry) {
//               await strapi.entityService.update('api::newsletter.newsletter', entry.id, {
//                 data: { discount_used: true }
//               });
//             }
//           } catch (e) {
//             console.error('Error cupón:', e);
//           }
//         }

//         // ================================================
//         // EMAIL ÚNICO CON RESEND (TODO JUNTO)
//         // ================================================
//         try {
//           const crypto = require('crypto');
//           const resetCode = crypto.randomBytes(20).toString('hex');

//           // Guardar código en el usuario
//           await strapi.db.query('plugin::users-permissions.user').update({
//             where: { id: order.user.id },
//             data: { resetPasswordToken: resetCode },
//           });

//           const resetUrl = `${process.env.FRONTEND_URL}/set-password?code=${resetCode}`;

//           await resend.emails.send({
//             from: 'Planthia <noreply@polinacodes.dev>',
//             to: [order.customer_email],
//             subject: '¡Gracias por tu compra! Configurá tu contraseña',
//             template: {
//               id: 'confirmacion-compra-nuevo-cliente',
//               variables: {
//                 firstName: order.first_name || 'cliente',
//                 orderId: id,
//                 resetUrl: resetUrl
//               }
//             }
//           });

//           console.log(`✅ Email enviado a ${order.customer_email}`);
//           console.log(`🔑 Código de reset: ${resetCode}`);

//         } catch (emailError) {
//           console.error('Error enviando email:', emailError);
//         }
//       }

//       return ctx.send({ ok: true, message: 'Orden actualizada' });

//     } catch (error) {
//       console.error('Error en updateStatus:', error);
//       return ctx.internalServerError('Error actualizando orden');
//     }
//   },

//   async findOne(ctx) {
//     const entity = await strapi.entityService.findOne('api::order.order', ctx.params.id, {
//       populate: '*'
//     });
//     if (!entity) return ctx.notFound('Orden no encontrada');
//     return ctx.send({ data: entity });
//   },

//   async myOrders(ctx) {
//     const user = ctx.state.user;

//     if (!user) {
//       return ctx.unauthorized('Debes iniciar sesión');
//     }

//     const orders = await strapi.entityService.findMany('api::order.order', {
//       filters: {
//         user: {
//           id: user.id
//         }
//       },
//       populate: '*',
//       sort: { createdAt: 'desc' },
//     });

//     return { data: orders };
//   },
// }));

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
      let user = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { email: email.toLowerCase() },
      });

      if (!user) {
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
          where: { id: user.id },
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

        // Armamos el objeto de configuración base
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

        // === EL TRUCO ADAPTADO DE FERIAPP ===
        // Si FRONTEND_URL empieza con https (producción), metemos auto_return. Si es localhost (http), lo omitimos.
        const isHttps = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.startsWith('https') : false;
        if (isHttps) {
          preferenceData.auto_return = 'approved';
        }

        const response = await preference.create({
          body: preferenceData
        });

        return ctx.send({ ok: true, orderId: order.id, mercadoPagoUrl: response.init_point });
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

  // ================================================
  // ACTUALIZAR ESTADO DE ORDEN
  // ================================================

  async updateStatus(ctx) {
    const { id } = ctx.params;
    const { order_status } = ctx.request.body;

    try {
      const order: any = await strapi.entityService.findOne('api::order.order', id, {
        populate: ['user']
      });

      if (!order) return ctx.notFound('Orden no encontrada');

      await strapi.entityService.update('api::order.order', id, {
        data: { order_status }
      });

      if (order_status === 'paid') {
        // --- CUPÓN ---
        if (order.discount_code) {
          try {
            const entry = await strapi.db.query('api::newsletter.newsletter').findOne({
              where: { discount_code: order.discount_code }
            });
            if (entry) {
              await strapi.entityService.update('api::newsletter.newsletter', entry.id, {
                data: { discount_used: true }
              });
            }
          } catch (e) {
            console.error('Error cupón:', e);
          }
        }

        // ================================================
        // EMAIL ÚNICO CON RESEND (TODO JUNTO)
        // ================================================
        try {
          const crypto = require('crypto');
          const resetCode = crypto.randomBytes(20).toString('hex');

          // Guardar código en el usuario
          await strapi.db.query('plugin::users-permissions.user').update({
            where: { id: order.user.id },
            data: { resetPasswordToken: resetCode },
          });

          const resetUrl = `${process.env.FRONTEND_URL}/set-password?code=${resetCode}`;

          await resend.emails.send({
            from: 'Planthia <noreply@polinacodes.dev>',
            to: [order.customer_email],
            subject: '¡Gracias por tu compra! Configurá tu contraseña',
            template: {
              id: 'confirmacion-compra-nuevo-cliente',
              variables: {
                firstName: order.first_name || 'cliente',
                orderId: id,
                resetUrl: resetUrl
              }
            }
          });

          console.log(`✅ Email enviado a ${order.customer_email}`);
          console.log(`🔑 Código de reset: ${resetCode}`);

        } catch (emailError) {
          console.error('Error enviando email:', emailError);
        }
      }

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