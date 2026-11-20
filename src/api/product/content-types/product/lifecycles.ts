/**
 * Stock de productos con variantes.
 *
 * Si un producto tiene variantes, el stock real vive en cada variante y el
 * stock general se calcula solo como la suma. No hace falta completarlo a mano:
 * si se escribe otro número, se corrige al guardar.
 */
import { syncVariantStock } from '../../../order/services/order';

export default {
  async afterCreate(event) {
    if (event.result?.id) await syncVariantStock(event.result.id);
  },

  async afterUpdate(event) {
    if (event.result?.id) await syncVariantStock(event.result.id);
  },
};
