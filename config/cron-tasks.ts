/**
 * Tareas programadas de Strapi.
 *
 * Cada 30 minutos se revisan los pedidos pendientes: si un pago se acreditó
 * pero el aviso de la pasarela se perdió, el pedido se marca como pagado; si
 * pasaron 3 días sin pago, se cancela.
 *
 * En Render (plan gratis) el servidor se duerme sin tráfico; el cron-job.org
 * que llama a /api/health cada 10 minutos lo mantiene despierto.
 */
export default {
  reconcilePendingOrders: {
    task: async ({ strapi }) => {
      await strapi.service('api::order.order').reconcilePendingOrders();
    },
    options: {
      rule: '*/30 * * * *',
    },
  },
};
