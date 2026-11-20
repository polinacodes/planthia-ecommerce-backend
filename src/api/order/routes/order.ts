/**
 * Rutas de pedidos.
 *
 * Se sacaron a propósito:
 * - GET /orders y GET /orders/:id: devolvían pedidos de cualquier cliente.
 * - POST/PUT/DELETE /orders: los pedidos se crean solo desde el checkout y se
 *   editan desde el admin de Strapi.
 * - PUT /orders/:id/status (pública): cualquiera podía marcar un pedido como pagado.
 *   Ahora el pago lo confirman los webhooks y la captura de PayPal.
 */
export default {
  routes: [
    {
      method: 'POST',
      path: '/orders/checkout',
      handler: 'order.createCheckout',
      config: {
        auth: false,
      },
    },
    {
      // Requiere el permiso "myOrders" del rol Authenticated
      method: 'GET',
      path: '/orders/my-orders',
      handler: 'order.myOrders',
    },
  ],
};
