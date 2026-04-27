// src/api/order/controllers/mercadopago.ts
import { MercadoPagoConfig, Payment } from 'mercadopago';
import * as crypto from 'crypto';

export default {
  async webhook(ctx) {
    try {
      console.log("--- WEBHOOK RECIBIDO ---");
      console.log("Body:", JSON.stringify(ctx.request.body));

      // Validación de firma (flexible para desarrollo)
      const signature = ctx.request.headers['x-signature'] as string;
      const requestId = ctx.request.headers['x-request-id'] as string;
      const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;

      if (secret && signature && requestId) {
        try {
          const parts = signature.split(',');
          const ts = parts.find(part => part.startsWith('ts='))?.split('=')[1];
          const v1 = parts.find(part => part.startsWith('v1='))?.split('=')[1];
          const manifest = `id:${ctx.request.body.data?.id};request-id:${requestId};ts:${ts};`;
          const hmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

          if (hmac !== v1) {
            console.error('❌ Firma inválida');
            if (process.env.NODE_ENV === 'production') {
              return ctx.forbidden('Firma inválida');
            }
          } else {
            console.log('✅ Firma verificada');
          }
        } catch (err) {
          console.error('Error validando firma:', err);
        }
      } else {
        console.log('⚠️ Webhook sin firma - normal en desarrollo');
      }

      const { body } = ctx.request;
      const paymentId = body.data?.id;

      if (body.type === 'payment' && paymentId) {
        const client = new MercadoPagoConfig({ 
          accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || '' 
        });
        const payment = new Payment(client);
        const paymentDetails = await payment.get({ id: paymentId });
        const orderId = paymentDetails.external_reference;

        if (!orderId) {
          console.error('❌ No se encontró external_reference');
          return ctx.badRequest('Referencia no encontrada');
        }

        let newStatus = 'pending';
        if (paymentDetails.status === 'approved') {
          newStatus = 'paid';
        } else if (['rejected', 'cancelled', 'voided'].includes(paymentDetails.status)) {
          newStatus = 'failure';
        }

        console.log(`Actualizando orden ${orderId} a estado: ${newStatus}`);

        // Actualizar orden
        const orderUpdated = await strapi.db.query('api::order.order').update({
          where: { id: orderId },
          data: { 
            order_status: newStatus, 
            payment_id: paymentId.toString() 
          },
        });

        console.log('✅ Orden actualizada:', orderUpdated);
      }

      return ctx.send({ ok: true });
    } catch (err) {
      console.error('❌ Error en webhook:', err);
      return ctx.internalServerError('Error procesando webhook');
    }
  }
};