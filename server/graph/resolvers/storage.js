const _ = require('lodash')
const graphHelper = require('../../helpers/graph')

/* global WIKI */

module.exports = {
  Query: {
    async storage() { return {} }
  },
  Mutation: {
    async storage() { return {} }
  },
  StorageQuery: {
    async targets(obj, args, context, info) {
      let targets = await WIKI.models.storage.getTargets()
      const multiGitEnabled = _.get(WIKI.config, 'features.featureMultiGitProfiles', false)
      if (multiGitEnabled) {
        targets = targets.filter(tgt => tgt.key !== 'git')
      }
      targets = _.sortBy(targets.map(tgt => {
        const targetInfo = _.find(WIKI.data.storage, ['key', tgt.key]) || {}
        return {
          ...targetInfo,
          ...tgt,
          hasSchedule: (targetInfo.schedule !== false),
          syncInterval: tgt.syncInterval || targetInfo.schedule || 'P0D',
          syncIntervalDefault: targetInfo.schedule,
          config: _.sortBy(_.transform(tgt.config, (res, value, key) => {
            const configData = _.get(targetInfo.props, key, false)
            if (configData) {
              res.push({
                key,
                value: JSON.stringify({
                  ...configData,
                  value: (configData.sensitive && value.length > 0) ? '********' : value
                })
              })
            }
          }, []), 'key')
        }
      }), ['title', 'key'])
      if (multiGitEnabled) {
        targets.push({
          key: 'git-profiles',
          title: 'Git Profiles',
          description: 'Manage multiple Git storage profiles.',
          isSynthetic: true,
          isAvailable: true,
          isEnabled: false,
          supportedModes: [],
          mode: 'sync',
          hasSchedule: false,
          syncInterval: null,
          syncIntervalDefault: null,
          config: [],
          actions: []
        })
      }
      return targets
    },
    async status(obj, args, context, info) {
      let activeTargets = await WIKI.models.storage.query().where('isEnabled', true)
      const multiGitEnabled = _.get(WIKI.config, 'features.featureMultiGitProfiles', false)
      if (multiGitEnabled) {
        activeTargets = activeTargets.filter(tgt => tgt.key !== 'git')
      }
      const statuses = activeTargets.map(tgt => {
        const targetInfo = _.find(WIKI.data.storage, ['key', tgt.key]) || {}
        return {
          key: tgt.key,
          title: targetInfo.title,
          status: _.get(tgt, 'state.status', 'pending'),
          message: _.get(tgt, 'state.message', 'Initializing...'),
          lastAttempt: _.get(tgt, 'state.lastAttempt', null),
          isSynthetic: false
        }
      })
      if (multiGitEnabled) {
        const profiles = await WIKI.models.storageProfiles.query().orderBy('name', 'asc')
        const profileIds = profiles.map(p => p.id)
        let latestRuns = []
        if (profileIds.length > 0) {
          latestRuns = await WIKI.models.storageProfileRuns.query()
            .whereIn('profileId', profileIds)
            .orderBy('startedAt', 'desc')
        }
        const latestRunMap = new Map()
        for (const run of latestRuns) {
          if (!latestRunMap.has(run.profileId)) {
            latestRunMap.set(run.profileId, run)
          }
        }
        for (const profile of profiles) {
          const run = latestRunMap.get(profile.id)
          let status = profile.enabled ? 'pending' : 'operational'
          let message = profile.enabled ? 'Awaiting first sync.' : 'Profile disabled.'
          let lastAttempt = null
          if (run) {
            if (run.status === 'success') {
              status = 'operational'
            } else if (run.status === 'warning') {
              status = 'pending'
            } else if (run.status === 'error') {
              status = 'error'
            }
            message = run.message || `Last action: ${run.action || 'sync'}`
            const ts = run.finishedAt || run.startedAt
            if (ts) {
              lastAttempt = new Date(ts).toISOString()
            }
          }
          statuses.push({
            key: `git-profile-${profile.id}`,
            title: profile.name,
            status,
            message,
            lastAttempt,
            isSynthetic: true
          })
        }
      }
      return _.sortBy(statuses, ['title', 'key'])
    }
  },
  StorageMutation: {
    async updateTargets(obj, args, context) {
      try {
        let dbTargets = await WIKI.models.storage.getTargets()
        for (let tgt of args.targets) {
          const currentDbTarget = _.find(dbTargets, ['key', tgt.key])
          if (!currentDbTarget) {
            continue
          }
          await WIKI.models.storage.query().patch({
            isEnabled: tgt.isEnabled,
            mode: tgt.mode,
            syncInterval: tgt.syncInterval,
            config: _.reduce(tgt.config, (result, value, key) => {
              let configValue = _.get(JSON.parse(value.value), 'v', null)
              if (configValue === '********') {
                configValue = _.get(currentDbTarget.config, value.key, '')
              }
              _.set(result, `${value.key}`, configValue)
              return result
            }, {}),
            state: {
              status: 'pending',
              message: 'Initializing...',
              lastAttempt: null
            }
          }).where('key', tgt.key)
        }
        await WIKI.models.storage.initTargets()
        return {
          responseResult: graphHelper.generateSuccess('Storage targets updated successfully')
        }
      } catch (err) {
        return graphHelper.generateError(err)
      }
    },
    async executeAction(obj, args, context) {
      try {
        await WIKI.models.storage.executeAction(args.targetKey, args.handler)
        return {
          responseResult: graphHelper.generateSuccess('Action completed.')
        }
      } catch (err) {
        return graphHelper.generateError(err)
      }
    }
  }
}
