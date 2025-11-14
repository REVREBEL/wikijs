/* global WIKI */

const path = require('path')
const GitAdapter = require('./gitAdapter')

const ensureAdapter = (ctx) => {
  if (!ctx.adapter) {
    throw new Error('Git adapter is not initialized')
  }
  return ctx.adapter
}

module.exports = {
  adapter: null,
  get repoPath() {
    return this.adapter
      ? this.adapter.repoPath
      : path.resolve(WIKI.ROOTPATH, WIKI.config.dataPath, 'repo')
  },
  async activated() {
    // not used
  },
  async deactivated() {
    // not used
  },
  async init() {
    this.adapter = new GitAdapter({
      ...this.config,
      mode: this.mode
    }, {
      mode: this.mode,
      logger: WIKI.logger
    })
    await this.adapter.init()
  },
  async sync() {
    const adapter = ensureAdapter(this)
    adapter.mode = this.mode
    return adapter.sync()
  },
  async created(page) {
    return ensureAdapter(this).created(page)
  },
  async updated(page) {
    return ensureAdapter(this).updated(page)
  },
  async deleted(page) {
    return ensureAdapter(this).deleted(page)
  },
  async renamed(page) {
    return ensureAdapter(this).renamed(page)
  },
  async assetUploaded(asset) {
    return ensureAdapter(this).assetUploaded(asset)
  },
  async assetDeleted(asset) {
    return ensureAdapter(this).assetDeleted(asset)
  },
  async assetRenamed(asset) {
    return ensureAdapter(this).assetRenamed(asset)
  },
  async getLocalLocation(asset) {
    return ensureAdapter(this).getLocalLocation(asset)
  },
  async importAll() {
    return ensureAdapter(this).importAll()
  },
  async syncUntracked() {
    return ensureAdapter(this).syncUntracked()
  },
  async purge() {
    this.adapter = null
    const adapter = new GitAdapter({
      ...this.config,
      mode: this.mode
    }, {
      mode: this.mode,
      logger: WIKI.logger
    })
    this.adapter = adapter
    return adapter.purge()
  }
}
