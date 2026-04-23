import { factories } from '@strapi/strapi';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default factories.createCoreController('api::newsletter.newsletter', ({ strapi }) => ({
  async subscribe(ctx) {
    const { email } = ctx.request.body.data;

    console.log('📧 Email recibido:', email);

    // 1. Validar email
    if (!email || !email.includes('@')) {
      console.log('❌ Email inválido');
      return ctx.badRequest('Email inválido');
    }

    // 2. Verificar si ya existe
    const existing = await strapi.db.query('api::newsletter.newsletter').findOne({
      where: { email }
    });

    if (existing) {
      console.log('❌ Email ya existe');
      return ctx.badRequest('Este email ya está suscripto');
    }

    // 3. Generar código de descuento
    const discountCode = `WELCOME10_${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    console.log('🎫 Código generado:', discountCode);

    // 4. Guardar en Strapi
    const subscriber = await strapi.db.query('api::newsletter.newsletter').create({
      data: {
        email,
        discount_code: discountCode,
        discount_used: false,
        subscribed_at: new Date(),
        discount_sent: false,
        publishedAt: new Date()
      }
    });
    console.log('💾 Guardado en DB:', subscriber);

    // 5. Enviar email usando Resend DIRECTAMENTE
    console.log('📧 Enviando email a:', email);
    
    try {
      const { data, error } = await resend.emails.send({
        from: 'Resend <delivered@resend.dev>',
        to: [email],
        subject: '🎁 Bienvenida a Planthia - Tu código de descuento',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <h2>¡Gracias por suscribirte! 🌱</h2>
            <p>Tu código de descuento del 10% es:</p>
            <div style="background: #f0f0f0; padding: 15px; text-align: center; margin: 20px 0;">
              <code style="font-size: 24px; letter-spacing: 2px;">${discountCode}</code>
            </div>
            <p>Usá este código en el checkout.</p>
            <p>¡Gracias por confiar en Planthia!</p>
          </div>
        `,
      });

      if (error) {
        console.error('❌ Error de Resend:', error);
        return ctx.badRequest('Error al enviar el email');
      }

      console.log('✅ Email enviado con Resend:', data);

      // Marcar que el email fue enviado exitosamente
      await strapi.db.query('api::newsletter.newsletter').update({
        where: { id: subscriber.id },
        data: { discount_sent: true }
      });

    } catch (error) {
      console.error('❌ Error en el bloque de envío:', error);
    }

    return ctx.send({
      success: true,
      message: '¡Suscripción exitosa! Revisa tu email.',
      discountCode
    });
  }
}));