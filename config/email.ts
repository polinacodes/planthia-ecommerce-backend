export default ({ env }) => ({
  config: {
    provider: 'strapi-provider-email-resend',
    providerOptions: {
      apiKey: env('RESEND_API_KEY'),
    },
    settings: {
      defaultFrom: env('RESEND_FROM_EMAIL', 'delivered@resend.dev'),
      defaultReplyTo: env('RESEND_FROM_EMAIL', 'delivered@resend.dev'),
    },
  },
});