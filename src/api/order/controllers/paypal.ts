// //src/api/order/controllers/paypal.ts
import paypal from '@paypal/checkout-server-sdk';

const environment = new paypal.core.SandboxEnvironment(
  process.env.PAYPAL_CLIENT_ID!,
  process.env.PAYPAL_CLIENT_SECRET!
);
const client = new paypal.core.PayPalHttpClient(environment);

export default {
  async createOrder(ctx, data) {
    const { total, orderId } = data;

    // Cotización real ARS → USD
    let arsToUsdRate = 0.00083;

    try {
      console.log('💱 Obteniendo cotización ARS → USD...');
      const response = await fetch('https://api.exchangerate-api.com/v4/latest/ARS');

      if (!response.ok) {
        throw new Error(`Error HTTP: ${response.status}`);
      }

      const data: any = await response.json();
      arsToUsdRate = data.rates.USD;
      console.log(`💱 Cotización real: 1 ARS = ${arsToUsdRate} USD`);
    } catch (error) {
      console.warn('⚠️ No se pudo obtener cotización real, usando tasa por defecto:', error);
    }

    // Convertir ARS a USD
    const totalInUsd = (Number(total) * arsToUsdRate).toFixed(2);

    console.log(`💱 Convirtiendo: ARS $${total} → USD $${totalInUsd} (tasa: ${arsToUsdRate})`);

    if (Number(totalInUsd) <= 0) {
      throw new Error('El monto a cobrar debe ser mayor a 0');
    }

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: 'USD',
          value: totalInUsd
        },
        custom_id: orderId.toString(),
        description: `Orden #${orderId} - Total original: ARS $${total}`
      }],
      application_context: {
        brand_name: 'Planthia',
        landing_page: 'LOGIN',
        user_action: 'PAY_NOW',
        return_url: `${process.env.FRONTEND_URL}/payment-status?status=success&order=${orderId}`,
        cancel_url: `${process.env.FRONTEND_URL}/payment-status?status=failure&order=${orderId}`,
        shipping_preference: 'NO_SHIPPING'
      }
    });

    try {
      const response = await client.execute(request);
      console.log('✅ PayPal Order creada:', response.result.id);

      await strapi.db.query('api::order.order').update({
        where: { id: orderId },
        data: {
          payment_id: response.result.id
        }
      });

      const approveLink = response.result.links.find((link: any) => link.rel === 'approve')?.href;

      if (!approveLink) {
        throw new Error('No se encontró el link de aprobación');
      }

      console.log('🔗 Approve URL:', approveLink);
      return { paypalUrl: approveLink };
    } catch (error) {
      console.error('❌ Error creando orden PayPal:', error);
      throw error;
    }
  },

  async webhook(ctx) {
    const { body } = ctx.request;
    if (!body || !body.event_type) return ctx.badRequest('Payload inválido');

    if (body.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      try {
        const orderId = body.resource.custom_id;
        if (!orderId) throw new Error("ID de orden no encontrado");

        const orderUpdated = await strapi.db.query('api::order.order').update({
          where: { id: orderId },
          data: {
            order_status: 'paid',
            payment_id: body.resource.id
          }
        });

        // --- LÓGICA DE STOCK MEJORADA ---
        if (orderUpdated?.items) {
          console.log('📦 Procesando stock en PayPal...');
          for (const item of orderUpdated.items) {
        
            const rawId = (item.productId || item.id).toString();
            const baseId = rawId.split('-')[0];
            const quantity = Number(item.quantity) || 1;

            const product = await strapi.db.query('api::product.product').findOne({
              where: { id: Number(baseId) }, // Forzamos número
              populate: ['variants']
            });

            if (product) {
              let dataToUpdate: any = {};

              if (rawId.includes('-') && product.variants?.length > 0) {
                const colorVariant = rawId.split('-')[1];
                dataToUpdate.variants = product.variants.map((v: any) => 
                  v.color.toLowerCase() === colorVariant.toLowerCase() 
                  ? { ...v, stock: Math.max(0, (Number(v.stock) || 0) - quantity) } 
                  : v
                );
              } else {
                dataToUpdate.stock = Math.max(0, (Number(product.stock) || 0) - quantity);
              }

              await strapi.db.query('api::product.product').update({
                where: { id: Number(baseId) },
                data: dataToUpdate
              });
              console.log(`✅ Stock de producto #${baseId} restado.`);
            }
          }
        }
      } catch (err) {
        console.error('❌ Error en PayPal Webhook:', err);
        return ctx.internalServerError('Error en PayPal Webhook');
      }
    }
    return ctx.send('OK');
  }
};