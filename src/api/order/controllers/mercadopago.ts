// src/api/order/controllers/mercadopago.ts
import { MercadoPagoConfig, Payment } from 'mercadopago';
import * as crypto from 'crypto';

export default {
  async webhook(ctx) {
    try {
      console.log("--- WEBHOOK RECIBIDO ---");
      console.log("Body:", JSON.stringify(ctx.request.body));

      // Validación de firma (flexible para desarrollo)
      const signature = ctx.request.headers['x-signature'] as string;
      const requestId = ctx.request.headers['x-request-id'] as string;
      const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;

      if (secret && signature && requestId) {
        try {
          const parts = signature.split(',');
          const ts = parts.find(part => part.startsWith('ts='))?.split('=')[1];
          const v1 = parts.find(part => part.startsWith('v1='))?.split('=')[1];
          const manifest = `id:${ctx.request.body.data?.id};request-id:${requestId};ts:${ts};`;
          const hmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

          if (hmac !== v1) {
            console.error('❌ Firma inválida');
            if (process.env.NODE_ENV === 'production') {
              return ctx.forbidden('Firma inválida');
            }
          } else {
            console.log('✅ Firma verificada');
          }
        } catch (err) {
          console.error('Error validando firma:', err);
        }
      } else {
        console.log('⚠️ Webhook sin firma - normal en desarrollo');
      }

      const { body } = ctx.request;
      const paymentId = body.data?.id;

      if (body.type === 'payment' && paymentId) {
        const client = new MercadoPagoConfig({
          accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || ''
        });
        const payment = new Payment(client);
        const paymentDetails = await payment.get({ id: paymentId });
        const orderId = paymentDetails.external_reference;

        if (!orderId) {
          console.error('❌ No se encontró external_reference');
          return ctx.badRequest('Referencia no encontrada');
        }

        let newStatus = 'pending';
        if (paymentDetails.status === 'approved') {
          newStatus = 'paid';
        } else if (['rejected', 'cancelled', 'voided'].includes(paymentDetails.status)) {
          newStatus = 'failure';
        }

        console.log(`Actualizando orden ${orderId} a estado: ${newStatus}`);

        // Actualizar orden
        //       const orderUpdated = await strapi.db.query('api::order.order').update({
        //         where: { id: orderId },
        //         data: {
        //           order_status: newStatus,
        //           payment_id: paymentId.toString()
        //         },
        //       });

        //       console.log('✅ Orden actualizada:', orderUpdated);

        //       if (newStatus === 'paid' && orderUpdated?.items) {
        //         console.log('📦 Descontando stock...');
        //         for (const item of orderUpdated.items) {
        //           if (item.productId) {
        //             const product = await strapi.db.query('api::product.product').findOne({
        //               where: { id: item.productId }
        //             });

        //             if (product) {
        //               const nuevoStock = Math.max(0, (product.stock || 0) - (item.quantity || 1));
        //               await strapi.db.query('api::product.product').update({
        //                 where: { id: item.productId },
        //                 data: { stock: nuevoStock }
        //               });
        //               console.log(`  ✅ Producto #${item.productId}: stock ${product.stock} → ${nuevoStock}`);
        //             }
        //           }
        //         }
        //       }
        //     }

        //     return ctx.send({ ok: true });
        //   } catch (err) {
        //     console.error('❌ Error en webhook:', err);
        //     return ctx.internalServerError('Error procesando webhook');
        //   }
        // }

        const orderUpdated = await strapi.db.query('api::order.order').update({
          where: { id: orderId },
          data: {
            order_status: newStatus,
            payment_id: paymentId.toString()
          },
        });

        console.log('✅ Orden actualizada:', orderUpdated.id);

        // --- NUEVA LÓGICA DE STOCK PARA VARIANTES ---
        // if (newStatus === 'paid' && orderUpdated?.items) {
        //   console.log('📦 Descontando stock...');
        //   for (const item of orderUpdated.items) {
        //     const rawId = (item.productId || item.id).toString();
        //     const baseId = rawId.split('-')[0];

        //     const product = await strapi.db.query('api::product.product').findOne({
        //       where: { id: baseId },
        //       populate: ['variants'] 
        //     });

        //     if (product) {
        //       let dataToUpdate: any = {};
        //       const quantity = item.quantity || 1;

        //       // Si es variante (contiene '-') y tiene el componente variants
        //       if (rawId.includes('-') && product.variants?.length > 0) {
        //         const colorVariant = rawId.split('-')[1];
        //         dataToUpdate.variants = product.variants.map((v: any) => 
        //           v.color.toLowerCase() === colorVariant.toLowerCase() 
        //           ? { ...v, stock: Math.max(0, (v.stock || 0) - quantity) } 
        //           : v
        //         );
        //       } else {
        //         // Stock simple
        //         dataToUpdate.stock = Math.max(0, (product.stock || 0) - quantity);
        //       }

        //       await strapi.db.query('api::product.product').update({
        //         where: { id: baseId },
        //         data: dataToUpdate
        //       });
        //       console.log(`✅ Producto #${baseId} stock actualizado.`);
        //     }
        //   }
        // }


        if (newStatus === 'paid' && orderUpdated?.items) {
          console.log('📦 Iniciando proceso de stock para Planthia...');

          for (const item of orderUpdated.items) {
      
            const rawId = (item.productId || item.id).toString();
            const baseId = rawId.split('-')[0];
            const quantity = Number(item.quantity) || 1;

            console.log(`🔍 Buscando producto ID: ${baseId} para restar ${quantity} unidades`);

            const product = await strapi.db.query('api::product.product').findOne({
           
              where: { id: Number(baseId) },
              populate: ['variants']
            });

            if (product) {
              let dataToUpdate: any = {};

              if (rawId.includes('-') && product.variants?.length > 0) {
                // Lógica de variantes (ej: 131-rojo)
                const colorVariant = rawId.split('-')[1];
                dataToUpdate.variants = product.variants.map((v: any) =>
                  v.color.toLowerCase() === colorVariant.toLowerCase()
                    ? { ...v, stock: Math.max(0, (Number(v.stock) || 0) - quantity) }
                    : v
                );
              } else {
                // Producto simple 
                const currentStock = Number(product.stock) || 0;
                dataToUpdate.stock = Math.max(0, currentStock - quantity);
                console.log(`📉 Stock anterior: ${currentStock} | Nuevo stock: ${dataToUpdate.stock}`);
              }

              await strapi.db.query('api::product.product').update({
                where: { id: Number(baseId) },
                data: dataToUpdate
              });

              console.log(`✅ Producto #${baseId} actualizado correctamente.`);
            } else {
              console.error(`❌ No se encontró el producto con ID ${baseId} en la base de datos.`);
            }
          }
        }
      }

      return ctx.send({ ok: true });
    } catch (err) {
      console.error('❌ Error en webhook:', err);
      return ctx.internalServerError('Error procesando webhook');
    }
  }
};