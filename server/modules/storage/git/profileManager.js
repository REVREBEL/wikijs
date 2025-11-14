/* global WIKI */

const _ = require('lodash')
const GitAdapter = require('./gitAdapter')

class GitProfileManager {
  constructor() {
    this.adapters = new Map()
    this.isReady = false
  }

  directionToMode(direction) {
    switch (direction) {
      case 'PUSH_ONLY':
        return 'push'
      case 'PULL_ONLY':
        return 'pull'
      default:
        return 'sync'
    }
  }

  supportsPush(direction) {
    return direction === 'PUSH_ONLY' || direction === 'BIDIRECTIONAL' || direction === 'sync'
  }

  supportsPull(direction) {
    return direction === 'PULL_ONLY' || direction === 'BIDIRECTIONAL' || direction === 'sync'
  }

  async init() {
    await this.reloadProfiles()
    this.isReady = true
  }

  async reloadProfiles() {
    const profiles = await WIKI.models.storageProfiles.query().where({
      type: 'git',
      enabled: true
    })

    const activeIds = new Set()

    for (const profile of profiles) {
      activeIds.add(profile.id)
      await this.ensureAdapter(profile)
    }

    for (const [profileId, entry] of this.adapters.entries()) {
      if (!activeIds.has(profileId)) {
        if (entry && entry.adapter && entry.adapter.git) {
          try {
            await entry.adapter.git.raw(['gc'])
          } catch (_) {
            // ignore cleanup errors
          }
        }
        this.adapters.delete(profileId)
      }
    }
  }

  async ensureAdapter(profile) {
    const existing = this.adapters.get(profile.id)
    const mode = this.directionToMode(profile.direction)

    if (existing) {
      const profileChanged = !_.isEqual(existing.profile, profile)
      if (!profileChanged) {
        existing.profile = profile
        existing.adapter.mode = mode
        return existing.adapter
      }
    }

    const adapter = new GitAdapter(profile, {
      mode,
      logger: WIKI.logger
    })
    await adapter.init()

    const entry = {
      profile,
      adapter
    }

    this.adapters.set(profile.id, entry)
    return adapter
  }

  getActiveEntries() {
    return Array.from(this.adapters.values())
  }

  getEntriesSupportingPush() {
    return this.getActiveEntries().filter(entry => this.supportsPush(entry.profile.direction))
  }

  getEntriesSupportingPull() {
    return this.getActiveEntries().filter(entry => this.supportsPull(entry.profile.direction))
  }

  async handlePageEvent(event, payload) {
    if (!this.isReady) {
      return
    }

    const methodName = {
      created: 'created',
      updated: 'updated',
      deleted: 'deleted',
      renamed: 'renamed'
    }[event]

    if (!methodName) {
      return
    }

    const entries = this.getEntriesSupportingPush()
    for (const { adapter } of entries) {
      if (typeof adapter[methodName] === 'function') {
        await adapter[methodName](payload)
      }
    }
  }

  async handleAssetEvent(event, payload) {
    if (!this.isReady) {
      return
    }

    const methodName = {
      uploaded: 'assetUploaded',
      deleted: 'assetDeleted',
      renamed: 'assetRenamed'
    }[event]

    if (!methodName) {
      return
    }

    const entries = this.getEntriesSupportingPush()
    for (const { adapter } of entries) {
      if (typeof adapter[methodName] === 'function') {
        await adapter[methodName](payload)
      }
    }
  }

  async syncProfile(profileId, { force = false } = {}) {
    const entry = this.adapters.get(profileId)
    if (!entry) {
      throw new Error('Profile is not active or does not exist.')
    }

    entry.adapter.mode = this.directionToMode(entry.profile.direction)

    if (force) {
      await entry.adapter.purge()
      entry.adapter.mode = this.directionToMode(entry.profile.direction)
      return entry.adapter.sync()
    }

    return entry.adapter.sync()
  }

  async syncAllPullProfiles() {
    const pullEntries = this.getEntriesSupportingPull()
    for (const entry of pullEntries) {
      entry.adapter.mode = this.directionToMode(entry.profile.direction)
      await entry.adapter.sync()
    }
  }
}

module.exports = new GitProfileManager()
