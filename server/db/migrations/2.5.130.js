/* global WIKI */

exports.up = async knex => {
  const client = knex.client.config?.client || knex.client.dialect

  if (client === 'pg') {
    await knex.schema.raw('ALTER TABLE "storageProfileRuns" DROP CONSTRAINT IF EXISTS "storageProfileRuns_status_check"')
    await knex.schema.raw(`ALTER TABLE "storageProfileRuns" ADD CONSTRAINT "storageProfileRuns_status_check" CHECK (status IN ('pending','success','warning','error'))`)
  } else if (client === 'mysql' || client === 'mysql2' || client === 'mariadb') {
    await knex.schema.raw('ALTER TABLE `storageProfileRuns` MODIFY `status` ENUM(\'pending\',\'success\',\'warning\',\'error\') NULL')
  } else {
    WIKI.logger && WIKI.logger.warn('Skipping storageProfileRuns status constraint migration: unsupported client ' + client)
  }
}

exports.down = async knex => {
  const client = knex.client.config?.client || knex.client.dialect

  if (client === 'pg') {
    await knex.schema.raw('ALTER TABLE "storageProfileRuns" DROP CONSTRAINT IF EXISTS "storageProfileRuns_status_check"')
    await knex.schema.raw(`ALTER TABLE "storageProfileRuns" ADD CONSTRAINT "storageProfileRuns_status_check" CHECK (status IN ('success','warning','error'))`)
  } else if (client === 'mysql' || client === 'mysql2' || client === 'mariadb') {
    await knex.schema.raw('ALTER TABLE `storageProfileRuns` MODIFY `status` ENUM(\'success\',\'warning\',\'error\') NULL')
  } else {
    WIKI.logger && WIKI.logger.warn('Skipping storageProfileRuns status constraint rollback: unsupported client ' + client)
  }
}
