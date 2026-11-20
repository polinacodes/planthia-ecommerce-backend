'use strict';

/**
 * Agrega las casillas de luz (sombra, indirecta, sol) a la metadata de las plantas
 * y las marca a partir del texto que ya estaba cargado en "light".
 *
 * Strapi corre las migraciones antes de sincronizar los campos, por eso acá se crean
 * las columnas si todavía no existen. Se ejecuta una sola vez: Strapi la anota en la
 * tabla strapi_migrations.
 *
 * Ejemplos: "sol / indirecta" → sol + indirecta; "sombra a sol directo" → sombra + sol.
 */
const TABLE = 'components_product_plant_metadata';
const FLAGS = {
  light_shade: 'sombra',
  light_indirect: 'indirect',
  light_sun: 'sol',
};

module.exports = {
  async up(knex) {
    if (!(await knex.schema.hasTable(TABLE))) return;

    for (const column of Object.keys(FLAGS)) {
      if (!(await knex.schema.hasColumn(TABLE, column))) {
        await knex.schema.alterTable(TABLE, (table) => {
          table.boolean(column).defaultTo(false);
        });
      }
    }

    const updates = {};
    for (const [column, keyword] of Object.entries(FLAGS)) {
      updates[column] = knex.raw(`COALESCE(LOWER(light) LIKE ?, false)`, [`%${keyword}%`]);
    }
    await knex(TABLE).update(updates);
  },
};
