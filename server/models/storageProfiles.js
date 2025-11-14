/* global WIKI */

const { Model } = require('objection')
const moment = require('moment')
const _ = require('lodash')
const { v4: uuid } = require('uuid')

module.exports = class StorageProfile extends Model {
  static get tableName() { return 'storageProfiles' }
  static get idColumn() { return 'id' }

  static get jsonSchema () {
    return {
      type: 'object',
      required: ['name', 'repoUrl', 'branch', 'localPath', 'authType', 'direction'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        createdAt: { type: ['string', 'null'], format: 'date-time' },
        updatedAt: { type: ['string', 'null'], format: 'date-time' },
        type: { type: 'string', enum: ['git'] },
        name: { type: 'string' },
        enabled: { type: 'boolean' },
        direction: { type: 'string', enum: ['PUSH_ONLY', 'PULL_ONLY', 'BIDIRECTIONAL'] },
        repoUrl: { type: 'string' },
        branch: { type: 'string' },
        localPath: { type: 'string' },
        verifySSL: { type: 'boolean' },
        authType: { type: 'string', enum: ['ssh', 'https_pat'] },
        sshKeyMode: { type: ['string', 'null'], enum: ['path', 'contents'] },
        sshKeyPath: { type: ['string', 'null'] },
        sshKeyContent: { type: ['string', 'null'] },
        username: { type: ['string', 'null'] },
        token: { type: ['string', 'null'] },
        defaultAuthorName: { type: ['string', 'null'] },
        defaultAuthorEmail: { type: ['string', 'null'] },
        committerName: { type: ['string', 'null'] },
        committerEmail: { type: ['string', 'null'] },
        scheduleCron: { type: ['string', 'null'] },
        webhookSecret: { type: ['string', 'null'] },
        alwaysNamespace: { type: ['boolean', 'null'] },
        gitBinaryPath: { type: ['string', 'null'] }
      }
    }
  }

  static get relationMappings () {
    return {
      runs: {
        relation: Model.HasManyRelation,
        modelClass: require('./storageProfileRuns'),
        join: {
          from: 'storageProfiles.id',
          to: 'storageProfileRuns.profileId'
        }
      }
    }
  }

  async $beforeInsert(context) {
    await super.$beforeInsert(context)

    if (!this.id) {
      this.id = uuid()
    }
    if (!this.type) {
      this.type = 'git'
    }
    if (!this.branch) {
      this.branch = 'main'
    }
    if (!this.direction) {
      this.direction = 'BIDIRECTIONAL'
    }
    if (!this.authType) {
      this.authType = 'ssh'
    }
    if (!this.sshKeyMode) {
      this.sshKeyMode = 'path'
    }
    if (_.isNil(this.enabled)) {
      this.enabled = true
    }
    if (_.isNil(this.verifySSL)) {
      this.verifySSL = true
    }
    if (_.isNil(this.alwaysNamespace)) {
      this.alwaysNamespace = false
    }
    const now = moment.utc().toISOString()
    this.createdAt = now
    this.updatedAt = now
  }

  async $beforeUpdate(opt, context) {
    await super.$beforeUpdate(opt, context)

    this.updatedAt = moment.utc().toISOString()
  }
}
