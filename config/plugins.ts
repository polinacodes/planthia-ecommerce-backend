import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => {
  console.log('🔧 Configurando strapi-cache...');
  console.log(`📦 Provider: ${env('NODE_ENV') === 'production' ? 'redis' : 'memory'}`);
  
  return {
    'strapi-cache': {
      enabled: true,
      config: {
        provider: env('NODE_ENV') === 'production' ? 'redis' : 'memory',
        redisConfig: {
          host: env('REDIS_HOST', '127.0.0.1'),
          port: env('REDIS_PORT', 6379),
        },
        cacheableRoutes: ['/api/products'],
        ttl: 1000 * 60 * 60,
        autoPurgeCache: true,
      },
    },
  };
};

export default config;