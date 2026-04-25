import { factories } from '@strapi/strapi';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async createCheckout(ctx) {
    try {
      console.log('🔍 1. Iniciando checkout...');
      const {
        email,
        nombre,
        apellido,
        telefono,
        direccion,
        ciudad,
        codigoPostal,
        cart,
        paymentMethod,
        subtotal,
        shippingCost,
        discountCode,
        discountAmount,
        total,
      } = ctx.request.body;

      console.log('📧 2. Email recibido:', email);
      console.log('🛒 3. Carrito:', cart?.length || 0, 'items');

      // 1. Validar datos mínimos
      if (!email || !cart || cart.length === 0) {
        console.log('❌ Datos incompletos');
        return ctx.badRequest('❌ Datos incompletos');
      }

      // 2. Generar contraseña temporal
      const tempPassword = Math.random().toString(36).slice(-8);
      console.log('🔑 4. Contraseña temporal generada');

      // 3. Buscar o crear usuario
      console.log('👤 5. Buscando usuario existente...');
      let user = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { email },
      });

      if (!user) {
        console.log('👤 6. Usuario no existe, creando...');
        try {
          user = await strapi.plugins['users-permissions'].services.user.add({
            email,
            username: email,
            password: tempPassword,
            confirmed: true,
            blocked: false,
            role: 1,
            nombre: nombre || '',
            apellido: apellido || '',
            telefono: telefono || '',
            direccion: direccion || '',
            ciudad: ciudad || '',
            codigo_postal: codigoPostal || '',
          });
          console.log('✅ Usuario creado:', user.id);
        } catch (userError) {
          console.error('❌ Error creando usuario:', userError);
          return ctx.badRequest('Error al crear el usuario');
        }
      } else {
        console.log('✅ Usuario existente:', user.id);
      }

      // 4. Crear la orden
      console.log('📦 7. Creando orden...');
      let order;
      try {
        order = await strapi.db.query('api::order.order').create({
          data: {
            user: user.id,
            email,
            nombre,
            apellido,
            telefono,
            direccion,
            ciudad,
            codigoPostal,
            items: cart,
            subtotal,
            shippingCost,
            discountCode: discountCode || null,
            discountAmount: discountAmount || 0,
            total,
            paymentMethod,
            order_status: 'pending',
            publishedAt: new Date(),
          },
        });
        console.log('✅ Orden creada:', order.id);
      } catch (orderError) {
        console.error('❌ Error creando orden:', orderError);
        return ctx.badRequest('Error al crear la orden');
      }

      // 5. Procesar Mercado Pago
      let preferenceId = null;
      let mercadoPagoUrl = null;

      if (paymentMethod === 'mercadopago') {
        console.log('💰 8. Procesando Mercado Pago...');
        try {
          const client = new MercadoPagoConfig({
            accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || '',
          });

          const preference = new Preference(client);

          const preferenceData = {
            items: cart.map(item => ({
              title: item.name,
              quantity: Number(item.quantity),
              unit_price: Number(item.price),
              currency_id: 'ARS',
            })),
            payer: { email },
            back_urls: {
              success: `${process.env.FRONTEND_URL}/payment-status`,
              failure: `${process.env.FRONTEND_URL}/payment-status`,
              pending: `${process.env.FRONTEND_URL}/payment-status`,
            },
            // auto_return: 'approved',
            binary_mode: true,
            external_reference: order.id.toString(),
          };

          if (discountAmount > 0) {
            preferenceData.items.push({
              title: 'Descuento',
              quantity: 1,
              unit_price: -Number(discountAmount),
              currency_id: 'ARS',
            });
          }

          const response = await preference.create({ body: preferenceData });
          preferenceId = response.id;
          mercadoPagoUrl = response.init_point;
          console.log('✅ Preferencia MP creada:', preferenceId);
        } catch (mpError) {
          console.error('❌ Error en Mercado Pago:', mpError);
          console.error('Detalle completo:', JSON.stringify(mpError, null, 2));
        }
      }

      // 6. Actualizar orden con preferenceId
      if (preferenceId) {
        await strapi.db.query('api::order.order').update({
          where: { id: order.id },
          data: { preference_id: preferenceId },
        });
      }

      // 7. Marcar cupón como usado
      if (discountCode) {
        console.log('🎫 9. Marcando cupón como usado...');
        const newsletterEntry = await strapi.db.query('api::newsletter.newsletter').findOne({
          where: { discount_code: discountCode },
        });
        if (newsletterEntry && !newsletterEntry.discount_used) {
          await strapi.db.query('api::newsletter.newsletter').update({
            where: { id: newsletterEntry.id },
            data: { discount_used: true },
          });
          console.log('✅ Cupón marcado como usado');
        }
      }

      console.log('🎉 10. Checkout completado exitosamente!');

      return ctx.send({
        ok: true,
        orderId: order.id,
        preferenceId,
        mercadoPagoUrl,
        isNewUser: !user.id,
        tempPassword: !user.id ? tempPassword : null,
      });
    } catch (error) {
      console.error('❌ ERROR GENERAL:', error);
      return ctx.internalServerError('Error al procesar el checkout');
    }
  },

  async findOne(ctx) {
    const { id } = ctx.params;
    const entity = await strapi.db.query('api::order.order').findOne({
      where: { id },
      populate: { '*': true }, 
    });

    console.log("ENTITY RECUPERADA DE DB:", entity);

    if (!entity) return ctx.notFound('Orden no encontrada');
    return entity;
  },

  async webhook(ctx) {
  console.log("🔥 Recibiendo petición en el webhook:", JSON.stringify(ctx.request.body));
  
  const { body } = ctx.request;
  const paymentId = body.data?.id;

  if (body.type === 'payment' && paymentId) {
    try {
      const client = new MercadoPagoConfig({
        accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || '',
      });
      const payment = new Payment(client);

      // 1. Obtener detalles completos desde Mercado Pago
      const paymentDetails = await payment.get({ id: paymentId });
      const orderId = paymentDetails.external_reference;

      // 2. Mapeo de estados de Mercado Pago a tus estados de Strapi
      // MP status: 'approved', 'pending', 'in_process', 'rejected', 'cancelled', 'refunded'
      let newStatus = 'pending'; // Por defecto

      if (paymentDetails.status === 'approved') newStatus = 'paid';
      else if (paymentDetails.status === 'rejected' || paymentDetails.status === 'cancelled') newStatus = 'failure';
      else if (paymentDetails.status === 'in_process' || paymentDetails.status === 'pending') newStatus = 'pending';

      const orderUpdated = await strapi.db.query('api::order.order').update({
        where: { id: orderId },
        data: { 
          order_status: newStatus,
          payment_id: paymentId 
        },
        populate: ['cart_items', 'cart_items.product'] 
      });

      if (newStatus === 'paid') {
        console.log(`📦 Descontando stock para la orden ${orderId}...`);
        
        for (const item of orderUpdated.cart_items) {
          const product = item.product; 
          const newStock = product.stock - item.quantity;

          await strapi.db.query('api::product.product').update({
            where: { id: product.id },
            data: { stock: newStock }
          });
          console.log(`✅ Stock de ${product.name} actualizado a: ${newStock}`);
        }
      }
      
      console.log(`✅ Orden ${orderId} actualizada a: ${newStatus}`);
    } catch (err) {
      console.error('❌ Error procesando el webhook:', err);
    }
  }

  return ctx.send('OK');
},
}));