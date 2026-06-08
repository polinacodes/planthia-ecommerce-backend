export default {
  async check(ctx) {
    ctx.body = {
      status: 'up',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development'
    };
  },
};