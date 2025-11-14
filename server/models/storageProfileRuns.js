const { Model } = require('objection')
const moment = require('moment')

module.exports = class StorageProfileRun extends Model {
  static get tableName() { return 'storageProfileRuns' }

  static get jsonSchema () {
    return {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        profileId: { type: 'string', format: 'uuid' },
        startedAt: { type: ['string', 'null'], format: 'date-time' },
        finishedAt: { type: ['string', 'null'], format: 'date-time' },
        status: { type: ['string', 'null'], enum: ['pending', 'success', 'warning', 'error', null] },
        action: { type: ['string', 'null'] },
        branch: { type: ['string', 'null'] },
        commitFrom: { type: ['string', 'null'] },
        commitTo: { type: ['string', 'null'] },
        filesChanged: { type: ['integer', 'null'] },
        message: { type: ['string', 'null'] }
      }
    }
  }

  static get relationMappings () {
    return {
      profile: {
        relation: Model.BelongsToOneRelation,
        modelClass: require('./storageProfiles'),
        join: {
          from: 'storageProfileRuns.profileId',
          to: 'storageProfiles.id'
        }
      }
    }
  }

  async $beforeInsert(context) {
    await super.$beforeInsert(context)

    if (!this.startedAt) {
      this.startedAt = moment.utc().toISOString()
    } else {
      this.startedAt = moment.utc(this.startedAt).toISOString()
    }

    if (this.finishedAt) {
      this.finishedAt = moment.utc(this.finishedAt).toISOString()
    }
  }

  async $beforeUpdate(opt, context) {
    await super.$beforeUpdate(opt, context)

    if (this.startedAt) {
      this.startedAt = moment.utc(this.startedAt).toISOString()
    }
    if (this.finishedAt) {
      this.finishedAt = moment.utc(this.finishedAt).toISOString()
    }
  }
}
