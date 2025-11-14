const _ = require('lodash')
const gitProfileManager = require('../modules/storage/git/profileManager')

/* global WIKI */

module.exports = async ({ profileId, force = false, requestedBy = 'system' } = {}) => {
  if (!_.get(WIKI.config, 'features.featureMultiGitProfiles', false)) {
    WIKI.logger.info('(STORAGE/GIT) Multi-profile feature disabled. Skipping sync job.')
    return
  }

  if (!profileId) {
    WIKI.logger.warn('(STORAGE/GIT) Sync job received without a profileId. Skipping.')
    return
  }

  const profile = await WIKI.models.storageProfiles.query().findById(profileId)
  if (!profile || !profile.enabled) {
    WIKI.logger.warn(`(STORAGE/GIT) Profile ${profileId} not found or disabled. Skipping sync job.`)
    return
  }

  const action = force ? 'force' : 'sync'
  let run
  try {
    run = await WIKI.models.storageProfileRuns.query().insert({
      profileId,
      action,
      status: 'pending',
      message: `requested by ${requestedBy}`
    })
  } catch (err) {
    WIKI.logger.error(`(STORAGE/GIT) Failed to record sync run for profile ${profileId}: ${err.message}`)
    if (err && err.data) {
      WIKI.logger.error('(STORAGE/GIT) Validation error data:', err.data)
    }
  }

  try {
    if (!gitProfileManager.isReady) {
      await gitProfileManager.init()
    } else {
      await gitProfileManager.ensureAdapter(profile)
    }

    await gitProfileManager.syncProfile(profileId, { force })

    if (run) {
      await WIKI.models.storageProfileRuns.query().patch({
        status: 'success',
        finishedAt: new Date().toISOString(),
        message: `completed (${action})`
      }).where('id', run.id)
    }
    WIKI.logger.info(`(STORAGE/GIT) Sync job for profile ${profile.name} completed.`)
  } catch (err) {
    WIKI.logger.error(`(STORAGE/GIT) Sync job for profile ${profile.name} failed: ${err.message}`)
    if (run) {
      await WIKI.models.storageProfileRuns.query().patch({
        status: 'error',
        finishedAt: new Date().toISOString(),
        message: err.message
      }).where('id', run.id)
    }
    throw err
  }
}
