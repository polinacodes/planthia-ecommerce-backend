#  Planthia E-Commerce — Backend API & Headless CMS

API RESTful y headless CMS desarrollado a medida para **Planthia**, una plataforma de e-commerce de alto rendimiento especializada en la venta de plantas de interior, exterior y accesorios de cuidado botánico.

El proyecto está diseñado bajo una arquitectura desacoplada para garantizar una experiencia de usuario rápida, limpia y minimalista en la tienda digital, resolviendo de forma centralizada la gestión de inventario, la integridad del carrito de compras y las automatizaciones críticas del flujo post-venta.

---

##  Stack Tecnológico

* **Core Framework:** Strapi CMS (v5)
* **Base de Datos:** PostgreSQL (Relacional & Transaccional)
* **Servicio de Mailing:** Resend API
* **Runtime & Lenguaje:** Node.js (ES6+)
* **Despliegue & Seguridad:** Render / Node Server, CORS restringido, JWT, API Tokens

---

##  Desafíos Técnicos y Soluciones Implementadas

### 1. Control de Inventario y Prevención de Overselling
Modelado complejo de stock en PostgreSQL adaptado a las particularidades de la venta de productos vivos (plantas). La API procesa transacciones atómicas para verificar la disponibilidad real en el momento exacto del checkout, previniendo errores de sobreventa durante picos de tráfico.

### 2. Workflows de Mailing Automatizado via Webhooks (Strapi + Resend)
Sistema de comunicación post-venta desacoplado e inmediato utilizando la API de **Resend** y **Webhooks** personalizados de Strapi. Al procesarse o actualizarse una orden de compra, el servidor dispara de forma automática:
* Confirmaciones de compra dinámicas con el desglose del pedido.
* Notificaciones sobre el estado y detalles del envío.
* Suscripciones a newsletters y entrega de accesos o guías de cuidado.

### 3. Integridad Transaccional y Persistencia
Estructuración de base de datos relacional robusta en PostgreSQL para mantener la consistencia entre colecciones relacionadas (variantes de precio, categorías, inventario y órdenes).

### 4. Seguridad Server-Side y Aislamiento de Entorno
Aislamiento total de variables de entorno sensibles (claves de API de Resend, credenciales de PostgreSQL, tokens de firma) mediante llamadas estrictamente ejecutadas desde el lado del servidor, evitando la exposición de claves en el cliente.

---

##  Arquitectura del CMS y Modelado de Datos

El panel de Strapi fue configurado a medida para centralizar la gestión operativa de la tienda a través de las siguientes colecciones principales:

* **Plants / Products:** Catálogo de plantas (interior/exterior), descripción, consejos de cuidado botánico, imágenes y slug optimizado para SEO.
* **Categories:** Taxonomía de catálogo (Plantas de Interior, Exterior, Substratos, Macetas, Herramientas).
* **Price Variants & Stock:** Opciones por tamaño/presentación, precios y control numérico de unidades en inventario.
* **Orders:** Registro de transacciones, datos del cliente, estado del pago, ítems adquiridos y seguimiento de entrega.

---

##  Variables de Entorno (`.env`)

Crea un archivo `.env` en la raíz del proyecto basándote en las siguientes claves de configuración:

```env
# Server Configuration
HOST=0.0.0.0
PORT=1337
APP_KEYS=tu_app_key_1,tu_app_key_2
API_TOKEN_SALT=tu_api_token_salt
ADMIN_JWT_SECRET=tu_admin_jwt_secret
TRANSFER_TOKEN_SALT=tu_transfer_token_salt
JWT_SECRET=tu_jwt_secret

# Database Configuration (PostgreSQL)
DATABASE_CLIENT=postgres
DATABASE_HOST=127.0.0.1
DATABASE_PORT=5432
DATABASE_NAME=planthia_db
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=postgres
DATABASE_SSL=false

# Mailing Service (Resend)
RESEND_API_KEY=re_123456789_abcdef
RESEND_DEFAULT_FROM=hola@planthia.app
```

## Instalación y Desarrollo Local

1. Clonar repositorio:
```
git clone https://github.com/polinacodes/planthia-ecommerce-backend.git

cd planthia-backend
```
2. Instalar dependencias:
```
npm install
```
3. Ejecutar entorno de desarrollo:
```
npm run dev
```


## Scripts Disponibles

-   `npm run develop` — Inicia el servidor de desarrollo con recarga en caliente (Hot Reload).
    
-   `npm run build` — Compila el panel de administración y controladores para producción.
    
-   `npm run start` — Ejecuta la aplicación en modo producción (requiere build previo).
    
-   `npm run strapi` — Interfaz de línea de comandos de Strapi.
    

##  Integración con el Frontend

Este backend provee la API REST consumida por el frontend en **Next.js**, permitiendo el renderizado híbrido de fichas de producto, actualización instantánea de carritos e indexación SEO impecable del catálogo completo.
