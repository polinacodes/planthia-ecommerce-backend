export default {
  routes: [
    {
      method: 'POST',
      path: '/paypal/capture',
      handler: 'paypal.capture',
      config: {
        auth: false,
      },
    },
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
