'use strict';

const { randomBytes } = require('crypto');

/**
 * Genera el código de baja para los suscriptores que ya existían antes de la baja del newsletter.
 * Strapi corre las migraciones antes de sincronizar los campos, por eso acá se crean las columnas
 * si todavía no existen. Se ejecuta una sola vez (queda anotada en strapi_migrations).
 */
const TABLE = 'newsletters';

module.exports = {
  async up(knex) {
    if (!(await knex.schema.hasTable(TABLE))) return;

    if (!(await knex.schema.hasColumn(TABLE, 'unsubscribe_token'))) {
      await knex.schema.alterTable(TABLE, (table) => table.string('unsubscribe_token'));
    }
    if (!(await knex.schema.hasColumn(TABLE, 'unsubscribed_at'))) {
      await knex.schema.alterTable(TABLE, (table) => table.datetime('unsubscribed_at'));
    }

    const subscribers = await knex(TABLE).select('id').whereNull('unsubscribe_token');
    for (const { id } of subscribers) {
      await knex(TABLE).where({ id }).update({ unsubscribe_token: randomBytes(24).toString('base64url') });
    }
  },
};
