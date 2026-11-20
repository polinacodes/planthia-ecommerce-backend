/**
 * favorite controller
 *
 * Cada persona ve, crea y borra solo SUS favoritos. Los productos se
 * identifican por documentId, que no cambia al republicar (el id numérico sí).
 */
import { factories } from '@strapi/strapi';

const FAVORITE_UID = 'api::favorite.favorite';
const PRODUCT_UID = 'api::product.product';

const toResponse = (fav: any) => ({
  documentId: fav.documentId,
  productDocumentId: fav.product?.documentId ?? null,
  product: fav.product ?? null,
});

export default factories.createCoreController(FAVORITE_UID, ({ strapi }) => ({
  async find(ctx) {
    const userId = ctx.state.user?.id;
    if (!userId) return ctx.unauthorized('Tenés que iniciar sesión');

    const favorites = await strapi.documents(FAVORITE_UID).findMany({
      filters: { user: { id: userId } },
      populate: { product: { fields: ['documentId', 'name', 'price', 'image', 'stock'] } },
      status: 'published',
    });

    // Si un producto se despublicó o se borró, el favorito no se muestra
    return { data: favorites.filter((fav: any) => fav.product).map(toResponse) };
  },

  async create(ctx) {
    const userId = ctx.state.user?.id;
    if (!userId) return ctx.unauthorized('Tenés que iniciar sesión');

    const productDocumentId = ctx.request.body?.data?.product ?? ctx.request.body?.product;
    if (!productDocumentId || typeof productDocumentId !== 'string') {
      return ctx.badRequest('Falta el producto');
    }

    const product = await strapi.documents(PRODUCT_UID).findOne({
      documentId: productDocumentId,
      status: 'published',
    });
    if (!product) return ctx.notFound('El producto no existe');

    // Si ya estaba en favoritos, se devuelve el mismo (no se duplica)
    const [existing] = await strapi.documents(FAVORITE_UID).findMany({
      filters: { user: { id: userId }, product: { documentId: productDocumentId } },
      populate: ['product'],
      status: 'published',
    });
    if (existing) return { data: toResponse(existing) };

    const created = await strapi.documents(FAVORITE_UID).create({
      data: { product: productDocumentId, user: userId },
      status: 'published',
      populate: ['product'],
    } as any);

    return { data: toResponse(created) };
  },

  async delete(ctx) {
    const userId = ctx.state.user?.id;
    if (!userId) return ctx.unauthorized('Tenés que iniciar sesión');

    const { id: documentId } = ctx.params;

    const [favorite] = await strapi.documents(FAVORITE_UID).findMany({
      filters: { documentId, user: { id: userId } },
      status: 'published',
    });

    // Si no es de quien lo pide, respondemos igual que si no existiera
    if (!favorite) return ctx.notFound('Favorito no encontrado');

    await strapi.documents(FAVORITE_UID).delete({ documentId });
    return { data: { documentId } };
  },
}));
