export default {
  routes: [
    {
      method: 'POST',
      path: '/auth/custom-register',
      handler: 'api::auth.auth.customRegister',
      config: {
        auth: false,
      },
    },
  ],
};