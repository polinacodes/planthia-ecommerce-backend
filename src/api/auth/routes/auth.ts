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
    {
      method: 'POST',
      path: '/auth/custom-reset-password',
      handler: 'api::auth.auth.resetPasswordWithToken',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/auth/custom-login',
      handler: 'api::auth.auth.customLogin',
      config: { auth: false },
    },
  ],
};