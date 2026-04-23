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
      handler: 'api::newsletter.newsletter.subscribe',
      config: {
        auth: false,
      },
    },
  ],
};
