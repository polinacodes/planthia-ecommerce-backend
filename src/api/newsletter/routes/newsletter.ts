/**
 * newsletter router
 */

// import { factories } from '@strapi/strapi';

// export default factories.createCoreRouter('api::newsletter.newsletter');

export default {
  routes: [
    {
      method: 'POST',
      path: '/newsletter/subscribe',
      handler: 'newsletter.subscribe',
      config: {
        auth: false,
      },
    },
    {
      // Baja del newsletter: desde la página /newsletter/baja o desde el botón
      // "Cancelar suscripción" de Gmail (List-Unsubscribe-Post, token en la URL)
      method: 'POST',
      path: '/newsletter/unsubscribe',
      handler: 'newsletter.unsubscribe',
      config: {
        auth: false,
      },
    },
     {
      method: 'POST',
      path: '/validate-discount',
      handler: 'api::newsletter.newsletter.validateDiscount',
      config: { auth: false },
    },
  ],
};
