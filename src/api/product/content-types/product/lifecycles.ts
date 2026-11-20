/**
 * Stock de productos con variantes.
 *
 * Si un producto tiene variantes, el stock real vive en cada variante y el
 * stock general se calcula solo como la suma. No hace falta completarlo a mano:
 * si se escribe otro número, se corrige al guardar.
 */
import { purgeProductsCache, syncVariantStock } from '../../../order/services/order';

/**
 * Además se limpia la caché de /api/products: el plugin no la limpia solo cuando
 * cambia un componente (como el stock de una variante), y la tienda seguía
 * mostrando el stock viejo.
 */
export default {
  async afterCreate(event) {
    if (event.result?.id) await syncVariantStock(event.result.id);
    await purgeProductsCache();
  },

  async afterUpdate(event) {
    if (event.result?.id) await syncVariantStock(event.result.id);
    await purgeProductsCache();
  },

  async afterDelete() {
    await purgeProductsCache();
  },
};
