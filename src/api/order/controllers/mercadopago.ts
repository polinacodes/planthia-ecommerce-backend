// src/api/order/controllers/mercadopago.ts
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Valida la firma x-signature que manda Mercado Pago.
 * Formato del manifest según la documentación de MP:
 *   id:[data.id];request-id:[x-request-id];ts:[ts];
 * data.id sale del query string (?data.id=...) y va en minúsculas si es alfanumérico.
 */
function isValidSignature(ctx, secret: string): boolean {
  const signature = ctx.request.headers['x-signature'] as string | undefined;
  const requestId = ctx.request.headers['x-request-id'] as string | undefined;
  if (!signature) return false;

  const parts = Object.fromEntries(
    signature.split(',').map((part) => {
      const [key, ...rest] = part.trim().split('=');
      return [key, rest.join('=')];
    })
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const rawId = ctx.query?.['data.id'] ?? ctx.request.body?.data?.id;
  const dataId = rawId !== undefined ? String(rawId).toLowerCase() : '';

  let manifest = '';
  if (dataId) manifest += `id:${dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;

  const expected = createHmac('sha256', secret).update(manifest).digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default {
  /**
   * Mercado Pago manda dos formatos de aviso:
   * - Webhook: ?data.id=123&type=payment (con firma x-signature)
   * - IPN (viejo): ?id=123&topic=payment o topic=merchant_order (sin firma)
   *
   * La firma es una capa extra. Lo que realmente protege es que acá NUNCA se
   * confía en el aviso: se consulta el pago a la API de MP con nuestro token y
   * se controla el monto. Un aviso falso no puede inventar un pago aprobado.
   */
  async webhook(ctx) {
    const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    const query = ctx.query || {};
    const body = ctx.request.body || {};

    const type = body.type ?? query.type ?? query.topic;
    const paymentId = body.data?.id ?? query['data.id'] ?? (query.topic === 'payment' ? query.id : undefined);

    // Solo nos interesan los pagos (merchant_order y otros se ignoran)
    if (type !== 'payment' || !paymentId) {
      return ctx.send({ ok: true });
    }

    if (ctx.request.headers['x-signature']) {
      if (!secret || !isValidSignature(ctx, secret)) {
        strapi.log.warn(
          `[mercadopago] Firma inválida en el aviso del pago ${paymentId}; se verifica igual contra la API de MP. Revisá MERCADOPAGO_WEBHOOK_SECRET.`
        );
      }
    }

    const client = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || '' });

    let payment: any;
    try {
      payment = await new Payment(client).get({ id: paymentId });
    } catch (error: any) {
      // La "simulación" del panel de MP manda un id que no existe (ej: 123456)
      if (error?.status === 404 || error?.statusCode === 404) {
        strapi.log.info(`[mercadopago] Pago ${paymentId} no encontrado (simulación del panel), respondo 200`);
        return ctx.send({ ok: true });
      }
      strapi.log.error(`[mercadopago] Error consultando el pago ${paymentId}: ${error?.message || error}`);
      return ctx.internalServerError('Error al obtener el pago');
    }

    const orderId = Number(payment.external_reference);
    if (!Number.isInteger(orderId)) {
      strapi.log.warn(`[mercadopago] Pago ${paymentId} sin external_reference válido`);
      return ctx.send({ ok: true });
    }

    const order: any = await strapi.db.query('api::order.order').findOne({ where: { id: orderId } });
    if (!order || order.payment_method !== 'mercadopago') {
      strapi.log.warn(`[mercadopago] Pago ${paymentId} apunta a un pedido inexistente (${orderId})`);
      return ctx.send({ ok: true });
    }

    if (payment.status === 'approved') {
      // El monto cobrado tiene que coincidir con el total del pedido
      // Según cómo informe MP el envío, puede venir dentro o aparte del monto
      const amount = Number(payment.transaction_amount) || 0;
      const shipping = Number(payment.shipping_amount) || 0;
      const expected = Number(order.total) || 0;
      const paid = Math.abs(amount - expected) <= 1 ? amount : amount + shipping;
      if (Math.abs(paid - expected) > 1) {
        strapi.log.error(
          `[mercadopago] Monto distinto en el pedido ${orderId}: cobrado ${paid}, esperado ${expected}. No se marca como pagado.`
        );
        return ctx.send({ ok: true });
      }

      await strapi.service('api::order.order').markOrderPaid(orderId, { paymentId: String(paymentId) });
    } else if (['rejected', 'cancelled'].includes(payment.status) && order.order_status === 'pending') {
      await strapi.db.query('api::order.order').update({
        where: { id: orderId },
        data: { order_status: 'failure', payment_id: String(paymentId) },
      });
    }

    return ctx.send({ ok: true });
  },
};
