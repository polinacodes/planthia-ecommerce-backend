import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default {
  async afterUpdate(event) {
    const { result } = event;

    const order_status = result.order_status;
    const id = result.id;

    // Necesitamos populate del user que no viene en result
    const order: any = await strapi.entityService.findOne('api::order.order', id, {
      populate: ['user']
    });

    if (!order) return;

    // ================================================
    // PAID
    // ================================================
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

      // --- EMAIL ---
      try {
        if (order.is_new_user) {
          const crypto = require('crypto');
          const resetCode = crypto.randomBytes(20).toString('hex');

          await strapi.db.query('plugin::users-permissions.user').update({
            where: { id: order.user.id },
            data: { resetPasswordToken: resetCode },
          });

          await resend.emails.send({
            from: 'Planthia <noreply@polinacodes.dev>',
            to: [order.customer_email],
            subject: '¡Gracias por tu compra! Configurá tu contraseña',
            template: {
              id: 'confirmacion-compra-nuevo-cliente',
              variables: {
                firstName: order.first_name || 'cliente',
                orderId: id,
                resetUrl: `${process.env.FRONTEND_URL}/set-password?code=${resetCode}`,
              }
            }
          });

          console.log(`✅ Email nuevo cliente enviado a ${order.customer_email}`);

        } else {
          await resend.emails.send({
            from: 'Planthia <noreply@polinacodes.dev>',
            to: [order.customer_email],
            subject: '¡Gracias por tu compra!',
            template: {
              id: 'confirmacion-compra-cliente-registrado',
              variables: {
                firstName: order.first_name || 'cliente',
                orderId: id,
                accountUrl: `${process.env.FRONTEND_URL}/account`,
              }
            }
          });

          console.log(`✅ Email cliente registrado enviado a ${order.customer_email}`);
        }
      } catch (emailError) {
        console.error('Error enviando email paid:', emailError);
      }

      // ================================================
      // SHIPPED
      // ================================================
    } else if (order_status === 'shipped') {
      try {
        await resend.emails.send({
          from: 'Planthia <noreply@polinacodes.dev>',
          to: [order.customer_email],
          subject: '¡Tu pedido está en camino!',
          template: {
            id: 'pedido-en-camino',
            variables: {
              firstName: order.first_name || 'cliente',
              orderId: id,
              accountUrl: `${process.env.FRONTEND_URL}/account`,
            }
          }
        });

        console.log(`✅ Email pedido en camino enviado a ${order.customer_email}`);

      } catch (emailError) {
        console.error('Error enviando email shipped:', emailError);
      }
    }
  }
};