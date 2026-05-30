
/**
 * favorite controller
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::favorite.favorite', ({ strapi }) => ({

  async find(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      return ctx.unauthorized('You must be logged in');
    }

    const favorites = await strapi.documents('api::favorite.favorite').findMany({
      filters: {
        user: { id: userId }
      },
      populate: ['product'],
      status: 'published',
    });

    return { data: favorites };
  },

  async create(ctx) {
    const { product } = ctx.request.body.data;
    const userId = ctx.state.user?.id;

    if (!product) {
      return ctx.badRequest('Product is required');
    }
    if (!userId) {
      return ctx.unauthorized('You must be logged in');
    }

    const favorite = await strapi.documents('api::favorite.favorite').create({
      data: {
        product,
        user: userId,
        publishedAt: new Date(),
      },
      status: 'published',
    });

    const populated = await strapi.documents('api::favorite.favorite').findOne({
      documentId: favorite.documentId,
      populate: ['product'],
    });

    return { data: populated };
  },
}));

