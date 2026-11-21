import type { Core } from '@strapi/strapi';
import { syncVariantStock } from './api/order/services/order';

export default {
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * Al arrancar, se recalcula el stock general de los productos con variantes
   * (suma de las variantes). Así los productos cargados antes de este cambio
   * quedan bien sin tener que guardarlos uno por uno.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    try {
      const products: any[] = await strapi.db.query('api::product.product').findMany({
        select: ['id'],
        populate: ['variants'],
      });
      for (const product of products) {
        if (product.variants?.length) await syncVariantStock(product.id);
      }
    } catch (error) {
      strapi.log.error(`[bootstrap] Error recalculando el stock de variantes: ${error}`);
    }

    // El blog es público: cualquiera puede listar y leer artículos (solo lectura).
    // Se da el permiso al arrancar para no tener que tildarlo a mano en cada entorno.
    try {
      const publicRole = await strapi.db
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: 'public' } });

      if (publicRole) {
        for (const action of ['api::article.article.find', 'api::article.article.findOne']) {
          const exists = await strapi.db
            .query('plugin::users-permissions.permission')
            .findOne({ where: { action, role: publicRole.id } });
          if (!exists) {
            await strapi.db
              .query('plugin::users-permissions.permission')
              .create({ data: { action, role: publicRole.id } });
          }
        }
      }
    } catch (error) {
      strapi.log.error(`[bootstrap] Error dando permisos públicos al blog: ${error}`);
    }
  },
};
