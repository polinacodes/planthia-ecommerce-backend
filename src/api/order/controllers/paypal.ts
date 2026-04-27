import paypal from '@paypal/checkout-server-sdk';

const environment = new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID!, process.env.PAYPAL_CLIENT_SECRET!);
const client = new paypal.core.PayPalHttpClient(environment);

export default {

  async createOrder(ctx, data) {
    const { total, orderId } = data;
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: 'USD', value: total.toFixed(2) }, custom_id: orderId.toString() }]
    });

    const response = await client.execute(request);
    const approveLink = response.result.links.find((link: any) => link.rel === 'approve').href;
    return { paypalUrl: approveLink };
  },

  async webhook(ctx) {
    const { body } = ctx.request;

    // 🛡️ FILTRO BÁSICO: Si no llega cuerpo, cortamos antes de procesar
    if (!body || !body.event_type) {
      return ctx.badRequest('Payload inválido');
    }

    const eventType = body.event_type;
    const resource = body.resource;
    console.log("🔥 Recibiendo webhook de PayPal:", eventType);

    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      try {
        const orderId = resource.custom_id || resource.supplementary_data?.related_ids?.order_id;

        if (!orderId) throw new Error("ID de orden no encontrado en el webhook");

        const orderUpdated = await strapi.db.query('api::order.order').update({
          where: { id: orderId },
          data: { order_status: 'paid', payment_id: resource.id },
          populate: ['cart_items', 'cart_items.product']
        });

        if (orderUpdated && orderUpdated.cart_items) {
          for (const item of orderUpdated.cart_items) {
            const product = item.product;
            await strapi.db.query('api::product.product').update({
              where: { id: product.id },
              data: { stock: product.stock - item.quantity }
            });
          }
        }
      } catch (err) {
        console.error('❌ Error procesando el webhook de PayPal:', err);
        return ctx.internalServerError('Error interno en procesamiento');
      }
    }
    return ctx.send('OK');
  }
};