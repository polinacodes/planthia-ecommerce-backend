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
import { MercadoPagoConfig, Payment } from 'mercadopago';

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

// Pasado este tiempo, un pedido que sigue pendiente se considera abandonado
const RECONCILE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 días

/**
 * Si el producto tiene variantes, su stock general pasa a ser la suma del
 * stock de las variantes. Se usa desde el lifecycle del producto y al
 * descontar stock en una compra.
 */
export async function syncVariantStock(productRowId: number) {
  const row: any = await strapi.db.query(PRODUCT_UID).findOne({
    where: { id: productRowId },
    populate: ['variants'],
  });
  if (!row || !Array.isArray(row.variants) || row.variants.length === 0) return;

  const total = row.variants.reduce((acc: number, v: any) => acc + (Number(v.stock) || 0), 0);
  if (Number(row.stock) !== total) {
    await strapi.db.query(PRODUCT_UID).update({ where: { id: row.id }, data: { stock: total } });
  }
}

/** Limpia la caché de /api/products para que la tienda muestre el stock nuevo. */
export async function purgeProductsCache() {
  try {
    const store = strapi.plugin('strapi-cache')?.service('service')?.getCacheInstance?.();
    await store?.clearByRegexp?.([/^.*:\/api\/products(\/.*)?(\?.*)?$/]);
  } catch (error) {
    strapi.log.warn(`[orders] No se pudo limpiar la caché de productos: ${error}`);
  }
}

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
      const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;

      if (hasVariants && !color) {
        throw new CheckoutError(`Elegí un color de ${product.name} antes de comprar`);
      }

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
          // El stock general de un producto con variantes es la suma de las variantes
          await syncVariantStock(row.id);
        } else {
          await strapi.db.query(PRODUCT_UID).update({
            where: { id: row.id },
            data: { stock: Math.max(0, (Number(row.stock) || 0) - quantity) },
          });
        }
      }
    }

    await purgeProductsCache();
  },

  /**
   * Revisa los pedidos que quedaron pendientes (por ejemplo, si se perdió un
   * aviso de Mercado Pago o la persona cerró la pestaña antes de volver de
   * PayPal) y los acomoda consultando directamente a cada pasarela.
   * Lo ejecuta una tarea programada (config/cron-tasks.ts).
   */
  async reconcilePendingOrders() {
    const now = Date.now();
    const pending: any[] = await strapi.db.query(ORDER_UID).findMany({
      where: {
        order_status: 'pending',
        // Le damos 10 minutos a los avisos normales antes de revisar
        createdAt: { $lt: new Date(now - 10 * 60 * 1000), $gt: new Date(now - RECONCILE_WINDOW_MS) },
      },
      limit: 50,
    });

    for (const order of pending) {
      try {
        if (order.payment_method === 'mercadopago') {
          await this.reconcileMercadoPagoOrder(order);
        } else if (order.payment_method === 'paypal' && order.payment_id) {
          await this.reconcilePaypalOrder(order);
        }
      } catch (error) {
        strapi.log.error(`[reconcile] Error revisando el pedido ${order.id}: ${error}`);
      }
    }

    // Los que siguen pendientes después de la ventana se cancelan
    const { count } = await strapi.db.query(ORDER_UID).updateMany({
      where: { order_status: 'pending', createdAt: { $lt: new Date(now - RECONCILE_WINDOW_MS) } },
      data: { order_status: 'failure' },
    });
    if (count) strapi.log.info(`[reconcile] ${count} pedido(s) pendiente(s) vencido(s) pasaron a cancelados`);
  },

  async reconcileMercadoPagoOrder(order: any) {
    const client = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || '' });
    const search: any = await new Payment(client).search({
      options: { external_reference: String(order.id), sort: 'date_created', criteria: 'desc' },
    });
    const payments: any[] = search?.results || [];
    const approved = payments.find((p) => p.status === 'approved');
    if (approved) {
      await this.processMercadoPagoPayment(approved);
    }
  },

  async reconcilePaypalOrder(order: any) {
    const paypal = strapi.service('api::order.paypal');
    const status = await paypal.getOrderStatus(order.payment_id);
    // APPROVED: la persona pagó pero no volvió al sitio, así que nadie capturó
    if (status === 'APPROVED' || status === 'COMPLETED') {
      const { completed } = await paypal.captureOrder(order.payment_id);
      if (completed) await this.markOrderPaid(order.id);
    }
  },

  /**
   * Aplica un pago de Mercado Pago ya consultado a la API (nunca un aviso sin verificar).
   */
  async processMercadoPagoPayment(payment: any) {
    const orderId = Number(payment?.external_reference);
    if (!Number.isInteger(orderId)) return;

    const order: any = await strapi.db.query(ORDER_UID).findOne({ where: { id: orderId } });
    if (!order || order.payment_method !== 'mercadopago') {
      strapi.log.warn(`[mercadopago] El pago ${payment?.id} apunta a un pedido inexistente (${orderId})`);
      return;
    }

    if (payment.status === 'approved') {
      // Según cómo informe MP el envío, puede venir dentro o aparte del monto
      const amount = Number(payment.transaction_amount) || 0;
      const shipping = Number(payment.shipping_amount) || 0;
      const expected = Number(order.total) || 0;
      const paid = Math.abs(amount - expected) <= 1 ? amount : amount + shipping;
      if (Math.abs(paid - expected) > 1) {
        strapi.log.error(
          `[mercadopago] Monto distinto en el pedido ${orderId}: cobrado ${paid}, esperado ${expected}. No se marca como pagado.`
        );
        return;
      }
      await this.markOrderPaid(orderId, { paymentId: String(payment.id) });
    } else if (['rejected', 'cancelled'].includes(payment.status) && order.order_status === 'pending') {
      await strapi.db.query(ORDER_UID).update({
        where: { id: orderId },
        data: { order_status: 'failure', payment_id: String(payment.id) },
      });
    }
  },

  async sendOrderPaidEmail(order: any) {
    const resend = getResend();
    if (!resend || !order?.customer_email) return;

    const frontendUrl = process.env.FRONTEND_URL;
    const firstName = order.first_name || 'cliente';

    if (order.is_new_user && order.user?.id) {
      const resetCode = randomBytes(32).toString('hex');
      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: order.user.id },
        data: {
          resetPasswordToken: resetCode,
          // El link del mail de primera compra dura 7 días
          resetPasswordTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
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
