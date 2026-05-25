// src/api/order/routes/order.ts
// export default {
//   routes: [
//     {
//       method: 'POST',
//       path: '/orders/checkout',
//       handler: 'order.createCheckout',
//       config: {
//         auth: false,
//       },
//     },
//     {
//       method: 'GET',
//       path: '/orders/:id',
//       handler: 'order.findOne',
//       config: {
//         auth: false,
//       },
//     },
//     {
//       method: 'PUT',
//       path: '/orders/:id/status',
//       handler: 'order.updateStatus',
//       config: {
//         auth: false,
//       },
//     },
//   ],
// };


// src/api/order/routes/order.ts
// export default {
//   routes: [
//     {
//       method: 'GET',
//       path: '/orders',
//       handler: 'order.find',
//       config: {
//         auth: false,
//       },
//     },
//     {
//       method: 'GET',
//       path: '/orders/:id',
//       handler: 'order.findOne',
//       config: {
//         auth: false,
//       },
//     },
//     {
//       method: 'POST',
//       path: '/orders',
//       handler: 'order.create',
//       config: {
//         auth: false,
//       },
//     },
//     {
//       method: 'PUT',
//       path: '/orders/:id',
//       handler: 'order.update',
//       config: {
//         auth: false,
//       },
//     },
//     {
//       method: 'DELETE',
//       path: '/orders/:id',
//       handler: 'order.delete',
//       config: {
//         auth: false,
//       },
//     },
//     {
//       method: 'POST',
//       path: '/orders/checkout',
//       handler: 'order.createCheckout',
//       config: {
//         auth: false,
//       },
//     },
//     {
//       method: 'PUT',
//       path: '/orders/:id/status',
//       handler: 'order.updateStatus',
//       config: {
//         auth: false,
//       },
//     },
//   ],
// };

//RUTAS CON SEGURIDAD
// src/api/order/routes/order.ts
export default {
  routes: [
    // RUTAS PÚBLICAS 
    {
      method: 'POST',
      path: '/orders/checkout',
      handler: 'order.createCheckout',
      config: {
        auth: false,
      },
    },
    // RUTAS PROTEGIDAS - SOLO USUARIOS AUTENTICADOS CON PERMISOS
    {
      method: 'GET',
      path: '/orders/my-orders',
      handler: 'order.myOrders',
      config: {
        auth: {
          scope: ['api::order.order.find']
        }
      },
    },
    {
      method: 'GET',
      path: '/orders',
      handler: 'order.find',
      config: {
        auth: {
          scope: ['api::order.order.find']
        }
      },
    },
    {
      method: 'GET',
      path: '/orders/:id',
      handler: 'order.findOne',
      config: {
        auth: {
          scope: ['api::order.order.findOne']
        }
      },
    },
    {
      method: 'POST',
      path: '/orders',
      handler: 'order.create',
      config: {
        auth: {
          scope: ['api::order.order.create']
        }
      },
    },
    {
      method: 'PUT',
      path: '/orders/:id',
      handler: 'order.update',
      config: {
        auth: {
          scope: ['api::order.order.update']
        }
      },
    },
    {
      method: 'DELETE',
      path: '/orders/:id',
      handler: 'order.delete',
      config: {
        auth: {
          scope: ['api::order.order.delete']
        }
      },
    },
    {
      method: 'PUT',
      path: '/orders/:id/status',
      handler: 'order.updateStatus',
      config: {
        auth: false,
      },
    },
  ],
};