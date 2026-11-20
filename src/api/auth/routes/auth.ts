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
    {
      method: 'POST',
      path: '/auth/custom-forgot-password',
      handler: 'api::auth.auth.customForgotPassword',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/auth/reset-code-status',
      handler: 'api::auth.auth.resetCodeStatus',
      config: { auth: false },
    },
    {
      // Requiere el permiso "updateProfile" (Auth) del rol Authenticated
      method: 'PUT',
      path: '/profile',
      handler: 'api::auth.auth.updateProfile',
    },
  ],
};