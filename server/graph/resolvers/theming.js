const graphHelper = require('../../helpers/graph')
const _ = require('lodash')
const CleanCSS = require('clean-css')
const fs = require('fs-extra')
const path = require('path')
const yaml = require('js-yaml')

/* global WIKI */

module.exports = {
  Query: {
    async theming() { return {} }
  },
  Mutation: {
    async theming() { return {} }
  },
  ThemingQuery: {
    async themes(obj, args, context, info) {
      const themesDir = path.join(WIKI.ROOTPATH, 'client', 'themes')
      const themes = []

      try {
        const entries = await fs.readdir(themesDir)
        for (const entry of entries) {
          const themePath = path.join(themesDir, entry)
          let stats
          try {
            stats = await fs.stat(themePath)
          } catch (err) {
            WIKI.logger && WIKI.logger.warn(`Unable to stat theme directory ${entry}: ${err.message}`)
            continue
          }
          if (!stats.isDirectory()) {
            continue
          }

          const manifestPath = path.join(themePath, 'theme.yml')
          let meta = {}
          if (await fs.pathExists(manifestPath)) {
            try {
              const raw = await fs.readFile(manifestPath, 'utf8')
              meta = yaml.load(raw) || {}
            } catch (err) {
              WIKI.logger && WIKI.logger.warn(`Unable to load theme manifest for ${entry}: ${err.message}`)
            }
          }

          themes.push({
            key: entry,
            title: _.get(meta, 'name', _.startCase(entry)),
            author: _.get(meta, 'author', '')
          })
        }
      } catch (err) {
        WIKI.logger && WIKI.logger.warn(`Failed to enumerate themes: ${err.message}`)
      }

      if (!themes.find(thm => thm.key === 'default')) {
        themes.unshift({
          key: 'default',
          title: 'Default',
          author: 'requarks.io'
        })
      }

      return _.sortBy(themes, thm => thm.title.toLowerCase())
    },
    async config(obj, args, context, info) {
      return {
        theme: WIKI.config.theming.theme,
        iconset: WIKI.config.theming.iconset,
        darkMode: WIKI.config.theming.darkMode,
        tocPosition: WIKI.config.theming.tocPosition || 'left',
        injectCSS: new CleanCSS({ format: 'beautify' }).minify(WIKI.config.theming.injectCSS).styles,
        injectHead: WIKI.config.theming.injectHead,
        injectBody: WIKI.config.theming.injectBody
      }
    }
  },
  ThemingMutation: {
    async setConfig(obj, args, context, info) {
      try {
        if (!_.isEmpty(args.injectCSS)) {
          args.injectCSS = new CleanCSS({
            inline: false
          }).minify(args.injectCSS).styles
        }

        WIKI.config.theming = {
          ...WIKI.config.theming,
          theme: args.theme,
          iconset: args.iconset,
          darkMode: args.darkMode,
          tocPosition: args.tocPosition || 'left',
          injectCSS: args.injectCSS || '',
          injectHead: args.injectHead || '',
          injectBody: args.injectBody || ''
        }

        await WIKI.configSvc.saveToDb(['theming'])

        return {
          responseResult: graphHelper.generateSuccess('Theme config updated')
        }
      } catch (err) {
        return graphHelper.generateError(err)
      }
    }
  }
}
