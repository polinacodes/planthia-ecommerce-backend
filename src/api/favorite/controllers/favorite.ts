
/**
 * favorite controller
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::favorite.favorite', ({ strapi }) => ({
  async create(ctx) {
    const { product } = ctx.request.body.data;
    const userId = ctx.state.user?.id;

    if (!product) {
      return ctx.badRequest('Product is required');
    }

    if (!userId) {
      return ctx.unauthorized('You must be logged in');
    }

    // Crear y publicar el favorito
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



//por las dudas
/**
 * favorite controller
 */

// import { factories } from '@strapi/strapi';

// export default factories.createCoreController('api::favorite.favorite', ({ strapi }) => ({
//   async create(ctx) {
//     const { product } = ctx.request.body.data;
//     const userId = ctx.state.user?.id;

//     if (!product) {
//       return ctx.badRequest('Product is required');
//     }

//     if (!userId) {
//       return ctx.unauthorized('You must be logged in');
//     }

//     // Buscar el documentId del producto si se envió un ID numérico
//     let productDocId = product;
//     if (typeof product === 'number' || !isNaN(Number(product))) {
//       const products = await strapi.documents('api::product.product').findMany({
//         filters: { id: Number(product) },
//       });
//       if (products.length > 0) {
//         productDocId = products[0].documentId;
//       } else {
//         return ctx.badRequest('Product not found');
//       }
//     }

//     // Crear y publicar el favorito
//     const favorite = await strapi.documents('api::favorite.favorite').create({
//       data: {
//         product: productDocId,
//         user: userId,
//         publishedAt: new Date(),
//       },
//       status: 'published',
//     });

//     // Devolver con populate
//     const populated = await strapi.documents('api::favorite.favorite').findOne({
//       documentId: favorite.documentId,
//       populate: ['product'],
//     });

//     return { data: populated };
//   },
// }));