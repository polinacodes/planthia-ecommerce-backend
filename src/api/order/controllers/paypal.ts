export default {
  /**
   * POST /api/paypal/capture
   * El front lo llama cuando la persona vuelve de PayPal. Recién acá se cobra.
   * Solo funciona si el token de PayPal coincide con el guardado en el pedido.
   */
  async capture(ctx) {
    const { orderId, token } = ctx.request.body || {};

    if (!orderId || !token) return ctx.badRequest('Faltan datos del pago');

    const order: any = await strapi.db.query('api::order.order').findOne({
      where: { id: Number(orderId) },
    });

    if (!order || order.payment_method !== 'paypal' || order.payment_id !== String(token)) {
      return ctx.badRequest('No se encontró el pago');
    }

    if (['paid', 'shipped', 'delivered'].includes(order.order_status)) {
      return ctx.send({ ok: true, status: 'paid' });
    }

    try {
      const { completed } = await strapi.service('api::order.paypal').captureOrder(String(token));

      if (!completed) {
        await strapi.db.query('api::order.order').update({
          where: { id: order.id },
          data: { order_status: 'failure' },
        });
        return ctx.send({ ok: false, status: 'failure' });
      }

      await strapi.service('api::order.order').markOrderPaid(order.id);
      return ctx.send({ ok: true, status: 'paid' });
    } catch (error) {
      strapi.log.error(`[paypal] Error en capture: ${error}`);
      return ctx.internalServerError('No se pudo confirmar el pago');
    }
  },

  /**
   * POST /api/paypal/cancel
   * El front lo llama cuando la persona cancela en PayPal. El pedido pasa a
   * "failure" (en el front se muestra como "Cancelado"). Solo funciona con el
   * token de PayPal de esa compra y si el pedido sigue pendiente.
   */
  async cancel(ctx) {
    const { orderId, token } = ctx.request.body || {};
    if (!orderId || !token) return ctx.badRequest('Faltan datos del pago');

    const { count } = await strapi.db.query('api::order.order').updateMany({
      where: {
        id: Number(orderId),
        payment_method: 'paypal',
        payment_id: String(token),
        order_status: 'pending',
      },
      data: { order_status: 'failure' },
    });

    return ctx.send({ ok: count > 0 });
  },

  /**
   * POST /api/paypal/webhook
   * Respaldo por si la persona cierra la pestaña antes de volver al sitio.
   */
  async webhook(ctx) {
    const event = ctx.request.body;
    if (!event?.event_type) return ctx.badRequest('Payload inválido');

    const valid = await strapi.service('api::order.paypal').verifyWebhookSignature(ctx.request.headers, event);
    if (!valid) {
      strapi.log.warn('[paypal] Webhook con firma inválida, se ignora');
      return ctx.unauthorized('Firma inválida');
    }

    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const orderId = event.resource?.custom_id;
      const order: any = orderId
        ? await strapi.db.query('api::order.order').findOne({ where: { id: Number(orderId) } })
        : null;

      if (order && order.payment_method === 'paypal') {
        await strapi.service('api::order.order').markOrderPaid(order.id);
      } else {
        strapi.log.warn(`[paypal] Webhook sin pedido válido (custom_id: ${orderId})`);
      }
    }

    return ctx.send({ ok: true });
  },
};
