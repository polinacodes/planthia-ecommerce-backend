// export default {
//   async afterUpdate(event) {
//     // Esto se dispara SIEMPRE que un producto cambie, sea por admin o por código
//     const cachePlugin = strapi.plugin('strapi-cache'); // O 'rest-cache' según tu package.json
//     if (cachePlugin) {
//       await cachePlugin.service('cacheStore').clearByUid('api::product.product');
//       console.log('✨ Stock actualizado: Caché de Planthia purgado.');
//     }
//   },
// };