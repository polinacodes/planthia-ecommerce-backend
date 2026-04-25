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
    { method: 'GET', 
      path: '/orders/:id', 
      handler: 'order.findOne', 
      config: { 
        auth: false 
      } 
    },
    {
      method: 'POST',
      path: '/orders/webhook',
      handler: 'order.webhook',
      config: { auth: false },
    },
  ],
};
