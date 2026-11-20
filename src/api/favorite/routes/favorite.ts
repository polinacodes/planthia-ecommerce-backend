/**
 * favorite router
 *
 * Solo listar, agregar y quitar. findOne y update no se usan.
 */
import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::favorite.favorite', {
  only: ['find', 'create', 'delete'],
});
