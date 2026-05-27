// import type { Core } from '@strapi/strapi';

// const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => {
//   console.log('🔧 Configurando strapi-cache...');
//   console.log(`📦 Provider: ${env('NODE_ENV') === 'production' ? 'redis' : 'memory'}`);
  
//   return {
//     'strapi-cache': {
//       enabled: true,
//       config: {
//         provider: env('NODE_ENV') === 'production' ? 'redis' : 'memory',
//         redisConfig: {
//           host: env('REDIS_HOST', '127.0.0.1'),
//           port: env('REDIS_PORT', 6379),
//         },
//         cacheableRoutes: ['/api/products'],
//         ttl: 1000 * 60 * 60,
//         autoPurgeCache: true,
//       },
//     },

//     email: {
//       config: {
//         provider: 'sendmail', 
//         providerOptions: {},
//         settings: {
//           defaultFrom: 'Planthia <noreply@polinacodes.dev>',
//           defaultReplyTo: 'noreply@polinacodes.dev',
//         },
//       },
//     },
//   };
// };

// export default config;


import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => {
  console.log('🔧 Configurando strapi-cache...');
  
  return {
    'strapi-cache': {
      enabled: true,
      config: {
        provider: env('NODE_ENV') === 'production' ? 'redis' : 'memory',
        redisConfig: env('NODE_ENV') === 'production' 
          ? {
              // Cambiado a REDIS_URL para que coincida perfectamente con Render
              host: new URL(env('REDIS_URL')).hostname,
              port: parseInt(new URL(env('REDIS_URL')).port) || 6379,
              password: new URL(env('REDIS_URL')).password || undefined,
            }
          : {
              host: '127.0.0.1',
              port: 6379,
            },
        // Las rutas de tu API que querés que se guarden en caché
        cacheableRoutes: ['/api/products'], 
        ttl: 1000 * 60 * 60, // 1 hora de vida de caché
        autoPurgeCache: true,
      },
    },

    email: {
      config: {
        provider: 'sendmail', 
        providerOptions: {},
        settings: {
          defaultFrom: 'Planthia <noreply@polinacodes.dev>',
          defaultReplyTo: 'noreply@polinacodes.dev',
        },
      },
    },
  };
};

export default config;