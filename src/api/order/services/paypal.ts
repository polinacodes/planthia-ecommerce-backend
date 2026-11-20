/**
 * PayPal con la API REST v2 (sin el SDK @paypal/checkout-server-sdk, que
 * PayPal dejó de mantener).
 *
 * Flujo:
 * 1. createOrder: crea la orden en PayPal y devuelve el link para aprobar.
 * 2. La persona aprueba en PayPal y vuelve al front con ?token=<orden PayPal>.
 * 3. captureOrder: el front le pide al backend que capture. Recién ahí se cobra.
 * 4. El webhook PAYMENT.CAPTURE.COMPLETED (con firma verificada) es el respaldo
 *    si la persona cierra la pestaña antes de volver.
 */

const FALLBACK_ARS_TO_USD = 0.00083;

const baseUrl = () =>
  process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

async function getAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) throw new Error('Faltan PAYPAL_CLIENT_ID o PAYPAL_CLIENT_SECRET');

  const res = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) throw new Error(`PayPal OAuth respondió ${res.status}`);
  const data: any = await res.json();
  return data.access_token;
}

async function paypalFetch(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
  const body: any = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function getArsToUsdRate(): Promise<number> {
  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/ARS');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any = await res.json();
    const rate = Number(data?.rates?.USD);
    if (rate > 0) return rate;
  } catch (error) {
    strapi.log.warn(`[paypal] No se pudo obtener la cotización, uso la de respaldo: ${error}`);
  }
  return FALLBACK_ARS_TO_USD;
}

export default () => ({
  async createOrder({ orderId, totalArs }: { orderId: number; totalArs: number }) {
    const rate = await getArsToUsdRate();
    const totalUsd = (Number(totalArs) * rate).toFixed(2);

    if (Number(totalUsd) <= 0) throw new Error('El monto a cobrar debe ser mayor a 0');

    const frontendUrl = process.env.FRONTEND_URL;
    const { ok, status, body } = await paypalFetch('/v2/checkout/orders', {
      method: 'POST',
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: String(orderId),
            custom_id: String(orderId),
            description: `Pedido #${orderId} - Total original: ARS ${totalArs}`,
            amount: { currency_code: 'USD', value: totalUsd },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: 'Planthia',
              landing_page: 'LOGIN',
              user_action: 'PAY_NOW',
              shipping_preference: 'NO_SHIPPING',
              return_url: `${frontendUrl}/payment-status?status=success&order=${orderId}`,
              cancel_url: `${frontendUrl}/payment-status?status=failure&order=${orderId}`,
            },
          },
        },
      }),
    });

    if (!ok) {
      strapi.log.error(`[paypal] Error creando la orden (${status}): ${JSON.stringify(body)}`);
      throw new Error('No se pudo crear el pago con PayPal');
    }

    const approveLink = (body.links || []).find(
      (link: any) => link.rel === 'payer-action' || link.rel === 'approve'
    )?.href;

    if (!approveLink) throw new Error('PayPal no devolvió el link de aprobación');

    return { paypalOrderId: body.id as string, approveUrl: approveLink as string };
  },

  /**
   * Captura (cobra) una orden aprobada. Devuelve true si el pago quedó completo.
   * Si ya estaba capturada, también devuelve true.
   */
  async captureOrder(paypalOrderId: string): Promise<{ completed: boolean; captureId?: string }> {
    const capture = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
      method: 'POST',
      body: '{}',
    });

    let order = capture.body;

    if (!capture.ok) {
      const issue = capture.body?.details?.[0]?.issue;
      if (issue !== 'ORDER_ALREADY_CAPTURED') {
        strapi.log.error(`[paypal] Error capturando ${paypalOrderId} (${capture.status}): ${JSON.stringify(capture.body)}`);
        return { completed: false };
      }
      const current = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
      order = current.body;
    }

    const captureInfo = order?.purchase_units?.[0]?.payments?.captures?.[0];
    const completed = order?.status === 'COMPLETED' && captureInfo?.status === 'COMPLETED';
    return { completed, captureId: captureInfo?.id };
  },

  /** Verifica con PayPal que el webhook sea auténtico. */
  async verifyWebhookSignature(headers: Record<string, any>, event: any): Promise<boolean> {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
      strapi.log.error('[paypal] Falta PAYPAL_WEBHOOK_ID: no se puede verificar el webhook');
      return false;
    }

    try {
      const { ok, body } = await paypalFetch('/v1/notifications/verify-webhook-signature', {
        method: 'POST',
        body: JSON.stringify({
          auth_algo: headers['paypal-auth-algo'],
          cert_url: headers['paypal-cert-url'],
          transmission_id: headers['paypal-transmission-id'],
          transmission_sig: headers['paypal-transmission-sig'],
          transmission_time: headers['paypal-transmission-time'],
          webhook_id: webhookId,
          webhook_event: event,
        }),
      });
      return ok && body?.verification_status === 'SUCCESS';
    } catch (error) {
      strapi.log.error(`[paypal] No se pudo verificar el webhook: ${error}`);
      return false;
    }
  },
});
