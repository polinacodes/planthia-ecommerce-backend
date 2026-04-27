export default {
  routes: [
    {
      method: 'POST',
      path: '/paypal/webhook', 
      handler: 'paypal.webhook',
      config: {
        auth: false,
      },
    },
  ],
};