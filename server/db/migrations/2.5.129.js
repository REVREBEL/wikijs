/* global WIKI */

const { v4: uuid } = require('uuid')
const path = require('path')

exports.up = knex => {
  const dbCompat = {
    charset: (WIKI.config.db.type === 'mysql' || WIKI.config.db.type === 'mariadb')
  }

  return knex.schema
    .createTable('storageProfiles', table => {
      if (dbCompat.charset) { table.charset('utf8mb4') }
      table.uuid('id').primary()
      table.timestamp('createdAt').notNullable().defaultTo(knex.fn.now())
      table.timestamp('updatedAt').notNullable().defaultTo(knex.fn.now())
      table.string('type').notNullable().defaultTo('git')
      table.string('name').notNullable()
      table.boolean('enabled').notNullable().defaultTo(true)
      table.enu('direction', ['PUSH_ONLY', 'PULL_ONLY', 'BIDIRECTIONAL']).notNullable().defaultTo('BIDIRECTIONAL')
      table.string('repoUrl').notNullable()
      table.string('branch').notNullable().defaultTo('main')
      table.string('localPath').notNullable()
      table.boolean('verifySSL').notNullable().defaultTo(true)
      table.enu('authType', ['ssh', 'https_pat']).notNullable().defaultTo('ssh')
      table.enu('sshKeyMode', ['path', 'contents']).defaultTo('path')
      table.string('sshKeyPath')
      table.text('sshKeyContent')
      table.string('username')
      table.text('token')
      table.string('defaultAuthorName')
      table.string('defaultAuthorEmail')
      table.string('committerName')
      table.string('committerEmail')
      table.string('scheduleCron')
      table.string('webhookSecret')
      table.boolean('alwaysNamespace').notNullable().defaultTo(false)
      table.string('gitBinaryPath')
      table.unique(['name'])
    })
    .createTable('storageProfileRuns', table => {
      if (dbCompat.charset) { table.charset('utf8mb4') }
      table.bigIncrements('id').primary()
      table.uuid('profileId').notNullable()
      table.timestamp('startedAt').notNullable().defaultTo(knex.fn.now())
      table.timestamp('finishedAt')
      table.enu('status', ['pending', 'success', 'warning', 'error'])
      table.string('action')
      table.string('branch')
      table.string('commitFrom')
      table.string('commitTo')
      table.integer('filesChanged')
      table.text('message')
      table.foreign('profileId').references('storageProfiles.id').onDelete('CASCADE')
    })
    .then(async () => {
      try {
        const existing = await knex('storage').where({ key: 'git' }).first()
        if (existing) {
          const config = existing.config || {}
          if (!config.repoUrl) {
            return
          }
          const now = new Date().toISOString()
          const directionMap = {
            push: 'PUSH_ONLY',
            pull: 'PULL_ONLY',
            sync: 'BIDIRECTIONAL'
          }
          const direction = directionMap[existing.mode] || 'BIDIRECTIONAL'
          const authType = config.authType === 'basic' ? 'https_pat' : 'ssh'
          const localPath = config.localRepoPath || path.join(WIKI.config.dataPath || './data', 'repo')

          const profile = {
            id: uuid(),
            createdAt: now,
            updatedAt: now,
            type: 'git',
            name: 'Default Git',
            enabled: existing.isEnabled !== false,
            direction,
            repoUrl: config.repoUrl || '',
            branch: config.branch || 'main',
            localPath,
            verifySSL: config.verifySSL !== false,
            authType,
            sshKeyMode: config.sshPrivateKeyMode || 'path',
            sshKeyPath: config.sshPrivateKeyPath || null,
            sshKeyContent: config.sshPrivateKeyContent || null,
            username: config.basicUsername || null,
            token: config.basicPassword || null,
            defaultAuthorName: config.defaultName || null,
            defaultAuthorEmail: config.defaultEmail || null,
            committerName: config.defaultName || null,
            committerEmail: config.defaultEmail || null,
            scheduleCron: existing.syncInterval && existing.syncInterval !== 'P0D' ? existing.syncInterval : null,
            webhookSecret: null,
            alwaysNamespace: config.alwaysNamespace === true,
            gitBinaryPath: config.gitBinaryPath || null
          }

          await knex('storageProfiles').insert(profile)
        }
      } catch (err) {
        WIKI.logger && WIKI.logger.warn(`Failed to migrate legacy git storage config: ${err.message}`)
      }
    })
}

exports.down = knex => {
  return knex.schema
    .dropTableIfExists('storageProfileRuns')
    .dropTableIfExists('storageProfiles')
}
