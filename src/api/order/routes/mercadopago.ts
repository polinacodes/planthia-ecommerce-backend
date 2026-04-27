// //src/api/order/routes/mercadopago.ts
export default {
  routes: [
    {
      method: 'POST',
      path: '/mercadopago/webhook',
      handler: 'mercadopago.webhook',
      config: {
        auth: false,
      },
    },
  ],
};