/**
 * Mails por cambios de estado hechos desde el admin de Strapi.
 *
 * El mail de "pagado" ya no sale de acá: lo manda markOrderPaid (services/order.ts)
 * una sola vez por pedido. Antes este lifecycle se disparaba en CADA guardado,
 * así que editar un pedido pagado desde el admin reenviaba el mail de compra.
 *
 * Ahora solo se manda un mail cuando el estado CAMBIA (por ejemplo, de "paid" a
 * "shipped"), comparando el estado anterior (beforeUpdate) con el nuevo (afterUpdate).
 */
import { Resend } from 'resend';

const ORDER_UID = 'api::order.order';

export default {
  async beforeUpdate(event) {
    const where = event.params?.where;
    if (!where?.id && !where?.documentId) return;

    const current: any = await strapi.db.query(ORDER_UID).findOne({
      where: where.id ? { id: where.id } : { documentId: where.documentId },
      select: ['order_status'],
    });
    event.state = { ...(event.state || {}), previousStatus: current?.order_status ?? null };
  },

  async afterUpdate(event) {
    const { result } = event;
    const previousStatus = event.state?.previousStatus;
    const newStatus = result?.order_status;

    // Si no pudimos leer el estado anterior, no mandamos nada (mejor eso que un mail repetido)
    if (!result || previousStatus === undefined || newStatus === previousStatus) return;

    if (newStatus === 'shipped') {
      const key = process.env.RESEND_API_KEY;
      if (!key || !result.customer_email) return;

      try {
        await new Resend(key).emails.send({
          from: 'Planthia <noreply@polinacodes.dev>',
          to: [result.customer_email],
          subject: '¡Tu pedido está en camino!',
          template: {
            id: 'pedido-en-camino',
            variables: {
              firstName: result.first_name || 'cliente',
              orderId: result.id,
              accountUrl: `${process.env.FRONTEND_URL}/account`,
            },
          },
        });
        strapi.log.info(`[orders] Mail "en camino" enviado (pedido ${result.id})`);
      } catch (error) {
        strapi.log.error(`[orders] Error enviando mail "en camino" (pedido ${result.id}): ${error}`);
      }
    }
  },
};
