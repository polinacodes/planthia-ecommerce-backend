// src/api/order/routes/order.ts
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
      method: 'GET',
      path: '/orders/:id',
      handler: 'order.findOne',
      config: {
        auth: false,
      },
    },
    {
      method: 'PUT',
      path: '/orders/:id/status',
      handler: 'order.updateStatus',
      config: {
        auth: false,
      },
    },
  ],
};