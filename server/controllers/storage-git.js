const express = require('express')
const crypto = require('crypto')
const _ = require('lodash')
const GitAdapter = require('../modules/storage/git/gitAdapter')
const gitProfileManager = require('../modules/storage/git/profileManager')

/* global WIKI */

const router = express.Router()

const ensureAdmin = (req, res) => {
  if (WIKI.auth.checkAccess(req.user, ['manage:system'])) {
    return true
  }
  res.status(403).json({ error: 'forbidden' })
  return false
}

const ensureFeatureEnabled = (res) => {
  if (!_.get(WIKI.config, 'features.featureMultiGitProfiles', false)) {
    res.status(404).json({ error: 'not found' })
    return false
  }
  return true
}

const runProfileSync = async (profile, { force = false, requestedBy = 'system' } = {}) => {
  const action = force ? 'force' : 'sync'
  let run = null
  try {
    run = await WIKI.models.storageProfileRuns.query().insert({
      profileId: profile.id,
      action,
      status: 'pending',
      message: `requested by ${requestedBy}`
    })
  } catch (err) {
    WIKI.logger.error(`(STORAGE/GIT) Failed to record sync run for profile ${profile.id}: ${err.message}`)
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

    await gitProfileManager.syncProfile(profile.id, { force })

    if (run) {
      await WIKI.models.storageProfileRuns.query().patch({
        status: 'success',
        finishedAt: new Date().toISOString(),
        message: `completed (${action})`
      }).where('id', run.id)
    }
  } catch (err) {
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

const sanitizeProfile = (profile, { lastRun } = {}) => {
  const payload = _.omit(profile, ['token', 'sshKeyContent'])
  payload.hasToken = Boolean(profile.token)
  payload.hasSshKey = Boolean(profile.sshKeyContent || profile.sshKeyPath)
  if (lastRun) {
    payload.lastRun = {
      id: lastRun.id,
      status: lastRun.status,
      startedAt: lastRun.startedAt,
      finishedAt: lastRun.finishedAt,
      message: lastRun.message,
      action: lastRun.action
    }
  } else {
    payload.lastRun = null
  }
  return payload
}

const collectProfilesWithRuns = async () => {
  const profiles = await WIKI.models.storageProfiles.query().where('type', 'git').orderBy('name')
  const profileIds = profiles.map(p => p.id)
  let runs = []
  if (profileIds.length > 0) {
    runs = await WIKI.models.storageProfileRuns.query()
      .whereIn('profileId', profileIds)
      .orderBy('startedAt', 'desc')
  }
  const runMap = new Map()
  for (const run of runs) {
    if (!runMap.has(run.profileId)) {
      runMap.set(run.profileId, run)
    }
  }
  return profiles.map(profile => sanitizeProfile(profile, { lastRun: runMap.get(profile.id) }))
}

const refreshManager = async () => {
  if (_.get(WIKI.config, 'features.featureMultiGitProfiles', false)) {
    await gitProfileManager.reloadProfiles()
  }
}

const normalizeTimestamps = (profile) => {
  const copy = _.cloneDeep(profile)
  if (copy.createdAt) {
    copy.createdAt = new Date(copy.createdAt).toISOString()
  }
  if (copy.updatedAt) {
    copy.updatedAt = new Date(copy.updatedAt).toISOString()
  }
  return copy
}

const verifySignature = (signature, rawBody, secret) => {
  if (!signature || !rawBody || !secret) {
    return false
  }

  let provided = signature
  let algorithm = 'sha256'
  if (signature.startsWith('sha1=')) {
    algorithm = 'sha1'
    provided = signature.substring(5)
  } else if (signature.startsWith('sha256=')) {
    provided = signature.substring(7)
  }

  const computed = crypto
    .createHmac(algorithm, secret)
    .update(rawBody)
    .digest('hex')

  const providedBuf = Buffer.from(provided, 'hex')
  const computedBuf = Buffer.from(computed, 'hex')
  if (providedBuf.length !== computedBuf.length) {
    return false
  }
  return crypto.timingSafeEqual(providedBuf, computedBuf)
}

const buildProfilePayload = (body) => {
  const fields = [
    'name', 'enabled', 'direction', 'repoUrl', 'branch', 'localPath', 'verifySSL',
    'authType', 'sshKeyMode', 'sshKeyPath', 'sshKeyContent', 'username', 'token',
    'defaultAuthorName', 'defaultAuthorEmail', 'committerName', 'committerEmail',
    'scheduleCron', 'webhookSecret', 'alwaysNamespace', 'gitBinaryPath'
  ]
  const payload = {}
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      payload[field] = body[field]
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'enabled')) {
    payload.enabled = payload.enabled === true || payload.enabled === 'true' || payload.enabled === 1 || payload.enabled === '1'
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'verifySSL')) {
    payload.verifySSL = payload.verifySSL === true || payload.verifySSL === 'true' || payload.verifySSL === 1 || payload.verifySSL === '1'
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'alwaysNamespace')) {
    payload.alwaysNamespace = payload.alwaysNamespace === true || payload.alwaysNamespace === 'true' || payload.alwaysNamespace === 1 || payload.alwaysNamespace === '1'
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'enabled')) {
    payload.enabled = true
  }
  if (!payload.branch) {
    payload.branch = 'main'
  }
  if (!payload.direction) {
    payload.direction = 'BIDIRECTIONAL'
  }
  if (!payload.authType) {
    payload.authType = 'ssh'
  }
  return payload
}

router.get('/admin/storage/git/profiles', async (req, res) => {
  if (!ensureAdmin(req, res)) { return }
  if (!ensureFeatureEnabled(res)) { return }
  try {
    const profiles = await collectProfilesWithRuns()
    res.json({ profiles })
  } catch (err) {
    WIKI.logger.error(`(STORAGE/GIT) Failed to list profiles: ${err.message}`)
    res.status(500).json({ error: err.message })
  }
})

router.post('/admin/storage/git/profiles', async (req, res) => {
  if (!ensureAdmin(req, res)) { return }
  if (!ensureFeatureEnabled(res)) { return }
  try {
    const payload = buildProfilePayload(req.body || {})
    payload.type = 'git'
    let profile = null
    try {
      profile = await WIKI.models.storageProfiles.query().insertAndFetch(payload)
      await refreshManager()
      res.status(201).json({ profile: sanitizeProfile(profile) })
    } catch (err) {
      if (profile) {
        await WIKI.models.storageProfiles.query().deleteById(profile.id)
      }
      throw err
    }
  } catch (err) {
    WIKI.logger.error(`(STORAGE/GIT) Failed to create profile: ${err.message}`)
    res.status(400).json({ error: err.message })
  }
})

router.put('/admin/storage/git/profiles/:id', async (req, res) => {
  if (!ensureAdmin(req, res)) { return }
  if (!ensureFeatureEnabled(res)) { return }
  const { id } = req.params
  try {
    const existing = await WIKI.models.storageProfiles.query().findById(id)
    if (!existing) {
      return res.status(404).json({ error: 'profile not found' })
    }

    const payload = buildProfilePayload(req.body || {})
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'token')) {
      payload.token = existing.token
    }
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'sshKeyContent')) {
      payload.sshKeyContent = existing.sshKeyContent
    }
    const before = normalizeTimestamps(_.omit(existing, ['id']))
    let profile = null
    try {
      profile = await WIKI.models.storageProfiles.query().patchAndFetchById(id, payload)
      await refreshManager()
      res.json({ profile: sanitizeProfile(profile) })
    } catch (err) {
      await WIKI.models.storageProfiles.query().patch(before).where('id', id)
      throw err
    }
  } catch (err) {
    WIKI.logger.error(`(STORAGE/GIT) Failed to update profile ${id}: ${err.message}`)
    res.status(400).json({ error: err.message })
  }
})

router.delete('/admin/storage/git/profiles/:id', async (req, res) => {
  if (!ensureAdmin(req, res)) { return }
  if (!ensureFeatureEnabled(res)) { return }
  const { id } = req.params
  try {
    const deleted = await WIKI.models.storageProfiles.query().deleteById(id)
    if (!deleted) {
      return res.status(404).json({ error: 'profile not found' })
    }
    await refreshManager()
    res.json({ ok: true })
  } catch (err) {
    WIKI.logger.error(`(STORAGE/GIT) Failed to delete profile ${id}: ${err.message}`)
    res.status(400).json({ error: err.message })
  }
})

router.post('/admin/storage/git/profiles/:id/test', async (req, res) => {
  if (!ensureAdmin(req, res)) { return }
  if (!ensureFeatureEnabled(res)) { return }
  const { id } = req.params
  try {
    const profile = await WIKI.models.storageProfiles.query().findById(id)
    if (!profile) {
      return res.status(404).json({ error: 'profile not found' })
    }
    const mode = gitProfileManager.directionToMode(profile.direction)
    const adapter = new GitAdapter(profile, { mode, logger: WIKI.logger })
    await adapter.init({ skipSync: true })
    await adapter.git.raw(['remote', 'update', 'origin'])
    res.json({ ok: true })
  } catch (err) {
    WIKI.logger.error(`(STORAGE/GIT) Test failed for profile ${req.params.id}: ${err.message}`)
    res.status(400).json({ error: err.message })
  }
})

router.post('/admin/storage/git/profiles/:id/sync', async (req, res) => {
  if (!ensureAdmin(req, res)) { return }
  if (!ensureFeatureEnabled(res)) { return }
  const { id } = req.params
  try {
    const profile = await WIKI.models.storageProfiles.query().findById(id)
    if (!profile) {
      return res.status(404).json({ error: 'profile not found' })
    }
    if (!profile.enabled) {
      return res.status(400).json({ error: 'profile is disabled' })
    }

    await runProfileSync(profile, {
      force: false,
      requestedBy: _.get(req, 'user.name', 'admin') || 'admin'
    })

    await refreshManager()
    res.json({ ok: true })
  } catch (err) {
    WIKI.logger.error(`(STORAGE/GIT) Failed to run sync for profile ${id}: ${err.message}`)
    res.status(400).json({ error: err.message })
  }
})

router.post('/admin/storage/git/profiles/:id/force', async (req, res) => {
  if (!ensureAdmin(req, res)) { return }
  if (!ensureFeatureEnabled(res)) { return }
  const { id } = req.params
  try {
    const profile = await WIKI.models.storageProfiles.query().findById(id)
    if (!profile) {
      return res.status(404).json({ error: 'profile not found' })
    }
    if (!profile.enabled) {
      return res.status(400).json({ error: 'profile is disabled' })
    }

    await runProfileSync(profile, {
      force: true,
      requestedBy: _.get(req, 'user.name', 'admin') || 'admin'
    })

    await refreshManager()
    res.json({ ok: true })
  } catch (err) {
    WIKI.logger.error(`(STORAGE/GIT) Failed to run force sync for profile ${id}: ${err.message}`)
    res.status(400).json({ error: err.message })
  }
})

router.post('/webhooks/git/:id', async (req, res) => {
  const { id } = req.params
  try {
    if (!ensureFeatureEnabled(res)) { return }
    const profile = await WIKI.models.storageProfiles.query().findById(id)
    if (!profile || !profile.enabled) {
      return res.status(404).json({ error: 'profile not found' })
    }
    if (!profile.webhookSecret) {
      return res.status(403).json({ error: 'webhook not configured' })
    }

    const signature = req.get('x-hub-signature-256') || req.get('x-hub-signature')
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}))
    if (!verifySignature(signature || '', rawBody, profile.webhookSecret)) {
      return res.status(401).json({ error: 'invalid signature' })
    }

    WIKI.scheduler.registerJob({
      name: 'storage.git.sync',
      immediate: true,
      schedule: 'P1D',
      repeat: false
    }, {
      profileId: profile.id,
      force: false,
      requestedBy: 'webhook'
    })

    res.status(202).json({ ok: true })
  } catch (err) {
    WIKI.logger.error(`(STORAGE/GIT) Webhook processing failed for profile ${id}: ${err.message}`)
    res.status(400).json({ error: err.message })
  }
})

module.exports = router
