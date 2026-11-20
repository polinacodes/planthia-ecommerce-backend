/**
 * order service
 *
 * Toda la lógica de dinero vive acá: el backend recalcula precios, envío,
 * descuento y total desde la base de datos, y nunca confía en lo que manda
 * el navegador.
 */
import { factories } from '@strapi/strapi';
import { Resend } from 'resend';
import { randomBytes } from 'crypto';

// Reglas de envío (antes estaban solo en el front)
export const FREE_SHIPPING_FROM = 10000;
export const SHIPPING_COST = 1500;
export const NEWSLETTER_DISCOUNT_PERCENT = 10;
export const MAX_QUANTITY_PER_ITEM = 10;

const ORDER_UID = 'api::order.order';
const PRODUCT_UID = 'api::product.product';
const VARIANT_UID = 'product.variant';
const NEWSLETTER_UID = 'api::newsletter.newsletter';

const round2 = (value: number) => Math.round(value * 100) / 100;

export class CheckoutError extends Error {}

export interface CartLineInput {
  documentId?: string;
  productId?: string | number;
  id?: string | number;
  color?: string;
  quantity?: number | string;
}

export interface OrderItem {
  productId: number;
  documentId: string;
  name: string;
  color: string | null;
  price: number;
  quantity: number;
  image: string;
}

/**
 * El carrito identifica los productos como "123" o "123-color".
 * El color puede tener guiones ("verde-oscuro"), así que solo el primer
 * tramo es el id.
 */
const parseCartId = (line: CartLineInput) => {
  const raw = String(line.productId ?? line.id ?? '').trim();
  const [idPart, ...colorParts] = raw.split('-');
  const id = Number(idPart);
  const colorFromId = colorParts.length ? colorParts.join('-') : null;
  const color = (line.color || colorFromId || '').toString().trim().toLowerCase() || null;
  return { id, color };
};

const getResend = () => {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
};

export default factories.createCoreService(ORDER_UID, ({ strapi }) => ({
  /**
   * Arma los ítems y los montos del pedido a partir de la base de datos.
   * Lanza CheckoutError con un mensaje para mostrar si algo no cierra
   * (producto inexistente, sin stock, cupón inválido...).
   */
  async buildOrderFromCart(cart: CartLineInput[], discountCode?: string | null) {
    if (!Array.isArray(cart) || cart.length === 0) {
      throw new CheckoutError('El carrito está vacío');
    }

    const items: OrderItem[] = [];

    for (const line of cart) {
      const { id, color } = parseCartId(line);
      const documentId = typeof line.documentId === 'string' && line.documentId.trim() ? line.documentId.trim() : null;
      const quantity = Number(line.quantity);

      if (!documentId && (!Number.isInteger(id) || id <= 0)) {
        throw new CheckoutError('Hay un producto inválido en el carrito');
      }
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_ITEM) {
        throw new CheckoutError('La cantidad de un producto no es válida');
      }

      // El documentId es fijo; el id numérico cambia cada vez que se republica
      // el producto, así que queda solo como respaldo para carritos viejos.
      const product: any = await strapi.db.query(PRODUCT_UID).findOne({
        where: documentId
          ? { documentId, publishedAt: { $notNull: true } }
          : { id, publishedAt: { $notNull: true } },
        populate: ['variants'],
      });

      if (!product) {
        throw new CheckoutError('Uno de los productos ya no está disponible');
      }

      let stock = Number(product.stock) || 0;
      let image = product.image || '';

      if (color) {
        const variant = (product.variants || []).find(
          (v: any) => (v.color || '').toString().trim().toLowerCase() === color
        );
        if (!variant) {
          throw new CheckoutError(`El color elegido de ${product.name} ya no está disponible`);
        }
        stock = Number(variant.stock) || 0;
        image = variant.image || image;
      }

      // Si el mismo producto aparece dos veces, sumamos las cantidades
      const existing = items.find((item) => item.productId === product.id && item.color === color);
      const totalQuantity = (existing?.quantity || 0) + quantity;

      if (totalQuantity > stock) {
        throw new CheckoutError(`No hay stock suficiente de ${product.name}`);
      }

      if (existing) {
        existing.quantity = totalQuantity;
      } else {
        items.push({
          productId: product.id,
          documentId: product.documentId,
          name: product.name,
          color,
          price: Number(product.price) || 0,
          quantity,
          image,
        });
      }
    }

    const subtotal = round2(items.reduce((acc, item) => acc + item.price * item.quantity, 0));
    const shippingCost = subtotal >= FREE_SHIPPING_FROM ? 0 : SHIPPING_COST;

    let validDiscountCode: string | null = null;
    let discountAmount = 0;

    if (discountCode && discountCode.trim()) {
      const code = discountCode.trim().toUpperCase();
      const subscriber: any = await strapi.db.query(NEWSLETTER_UID).findOne({
        where: { discount_code: code },
      });
      if (!subscriber || subscriber.discount_used) {
        throw new CheckoutError('El código de descuento no es válido o ya fue usado');
      }
      validDiscountCode = code;
      discountAmount = round2((subtotal * NEWSLETTER_DISCOUNT_PERCENT) / 100);
    }

    const total = round2(subtotal + shippingCost - discountAmount);

    return { items, subtotal, shippingCost, discountCode: validDiscountCode, discountAmount, total };
  },

  /**
   * Marca un pedido como pagado UNA sola vez. Si llegan dos avisos del mismo
   * pago (webhook repetido, webhook + captura), el segundo no hace nada:
   * no descuenta stock ni manda mails de nuevo.
   */
  async markOrderPaid(orderId: number | string, data: { paymentId?: string } = {}) {
    const id = Number(orderId);
    if (!Number.isInteger(id)) return { updated: false };

    const claimData: any = { order_status: 'paid' };
    if (data.paymentId) claimData.payment_id = data.paymentId;

    // Update atómico: solo cambia si todavía no estaba pagado
    const { count } = await strapi.db.query(ORDER_UID).updateMany({
      where: {
        id,
        $or: [{ order_status: { $notIn: ['paid', 'shipped', 'delivered'] } }, { order_status: { $null: true } }],
      },
      data: claimData,
    });

    if (!count) {
      strapi.log.info(`[orders] El pedido ${id} ya estaba pagado; se ignora el aviso repetido`);
      return { updated: false };
    }

    const order: any = await strapi.db.query(ORDER_UID).findOne({
      where: { id },
      populate: ['user'],
    });

    try {
      await this.decrementStock(order.items || []);
    } catch (error) {
      strapi.log.error(`[orders] Error descontando stock del pedido ${id}: ${error}`);
    }

    if (order.discount_code) {
      await strapi.db.query(NEWSLETTER_UID).updateMany({
        where: { discount_code: order.discount_code },
        data: { discount_used: true },
      });
    }

    try {
      await this.sendOrderPaidEmail(order);
    } catch (error) {
      strapi.log.error(`[orders] Error enviando el mail del pedido ${id}: ${error}`);
    }

    strapi.log.info(`[orders] Pedido ${id} marcado como pagado`);
    return { updated: true };
  },

  /**
   * Descuenta stock en TODAS las versiones del producto (borrador y
   * publicado). Si solo se actualiza una, al volver a publicar desde el
   * admin el stock vuelve al valor viejo.
   */
  async decrementStock(items: any[]) {
    for (const item of items) {
      const quantity = Number(item.quantity) || 0;
      if (!quantity) continue;

      // Pedidos viejos guardaban solo productId ("123" o "123-color")
      let documentId = item.documentId;
      let color = item.color ?? null;
      if (!documentId) {
        const parsed = parseCartId(item);
        const row: any = await strapi.db.query(PRODUCT_UID).findOne({ where: { id: parsed.id } });
        if (!row) continue;
        documentId = row.documentId;
        color = color ?? parsed.color;
      }

      const rows: any[] = await strapi.db.query(PRODUCT_UID).findMany({
        where: { documentId },
        populate: ['variants'],
      });

      for (const row of rows) {
        if (color) {
          const variant = (row.variants || []).find(
            (v: any) => (v.color || '').toString().trim().toLowerCase() === String(color).toLowerCase()
          );
          if (variant) {
            await strapi.db.query(VARIANT_UID).update({
              where: { id: variant.id },
              data: { stock: Math.max(0, (Number(variant.stock) || 0) - quantity) },
            });
          }
        } else {
          await strapi.db.query(PRODUCT_UID).update({
            where: { id: row.id },
            data: { stock: Math.max(0, (Number(row.stock) || 0) - quantity) },
          });
        }
      }
    }

    // Que la caché de /api/products no muestre el stock viejo
    try {
      const cache = strapi.plugin('strapi-cache');
      await cache?.service('cacheStore')?.clearByUid?.(PRODUCT_UID);
    } catch {
      // Si el plugin no expone ese método, la caché vence sola (1 hora)
    }
  },

  async sendOrderPaidEmail(order: any) {
    const resend = getResend();
    if (!resend || !order?.customer_email) return;

    const frontendUrl = process.env.FRONTEND_URL;
    const firstName = order.first_name || 'cliente';

    if (order.is_new_user && order.user?.id) {
      const resetCode = randomBytes(20).toString('hex');
      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: order.user.id },
        data: { resetPasswordToken: resetCode },
      });

      await resend.emails.send({
        from: 'Planthia <noreply@polinacodes.dev>',
        to: [order.customer_email],
        subject: '¡Gracias por tu compra! Configurá tu contraseña',
        template: {
          id: 'confirmacion-compra-nuevo-cliente',
          variables: {
            firstName,
            orderId: order.id,
            resetUrl: `${frontendUrl}/set-password?code=${resetCode}`,
          },
        },
      });
    } else {
      await resend.emails.send({
        from: 'Planthia <noreply@polinacodes.dev>',
        to: [order.customer_email],
        subject: '¡Gracias por tu compra!',
        template: {
          id: 'confirmacion-compra-cliente-registrado',
          variables: {
            firstName,
            orderId: order.id,
            accountUrl: `${frontendUrl}/account`,
          },
        },
      });
    }
  },
}));
