/* global WIKI */

const path = require('path')
const sgit = require('simple-git')
const fs = require('fs-extra')
const _ = require('lodash')
const stream = require('stream')
const Promise = require('bluebird')
const pipeline = Promise.promisify(stream.pipeline)
const klaw = require('klaw')
const os = require('os')

const pageHelper = require('../../../helpers/page')
const assetHelper = require('../../../helpers/asset')
const commonDisk = require('../disk/common')

class GitAdapter {
  constructor(config = {}, options = {}) {
    this.logger = options.logger || WIKI.logger
    this.options = options
    this.config = this.buildConfig(config)
    this.mode = options.mode || config.mode || this.directionToMode(config.direction) || 'sync'
    this.repoPath = path.resolve(WIKI.ROOTPATH, this.config.localRepoPath || path.join(WIKI.config.dataPath, 'repo'))
    this.git = null
  }

  buildConfig(source = {}) {
    if (source.localRepoPath) {
      return {
        ...source
      }
    }

    const defaultName = source.committerName || source.defaultAuthorName || source.defaultName || _.get(WIKI, 'config.git.defaultName', 'Wiki.js')
    const defaultEmail = source.committerEmail || source.defaultAuthorEmail || source.defaultEmail || _.get(WIKI, 'config.git.defaultEmail', 'wiki@example.com')

    const localPath = source.localPath || source.localRepoPath || path.join(WIKI.config.dataPath, 'repo')

    return {
      repoUrl: source.repoUrl,
      branch: source.branch || 'main',
      verifySSL: _.get(source, 'verifySSL', true),
      authType: source.authType === 'https_pat' ? 'basic' : (source.authType || 'ssh'),
      sshPrivateKeyMode: source.sshKeyMode || 'path',
      sshPrivateKeyPath: source.sshKeyPath,
      sshPrivateKeyContent: source.sshKeyContent,
      basicUsername: source.username,
      basicPassword: source.token,
      defaultName,
      defaultEmail,
      localRepoPath: localPath,
      alwaysNamespace: _.get(source, 'alwaysNamespace', false),
      gitBinaryPath: source.gitBinaryPath || ''
    }
  }

  directionToMode(direction) {
    switch (direction) {
      case 'PUSH_ONLY':
        return 'push'
      case 'PULL_ONLY':
        return 'pull'
      case 'BIDIRECTIONAL':
        return 'sync'
      default:
        return null
    }
  }

  modeToDirection(mode) {
    switch (mode) {
      case 'push':
        return 'PUSH_ONLY'
      case 'pull':
        return 'PULL_ONLY'
      default:
        return 'BIDIRECTIONAL'
    }
  }

  async ensureGit() {
    this.repoPath = path.resolve(WIKI.ROOTPATH, this.config.localRepoPath || path.join(WIKI.config.dataPath, 'repo'))
    await fs.ensureDir(this.repoPath)
    if (!this.git) {
      this.git = sgit(this.repoPath, { maxConcurrentProcesses: 1 })
      if (!_.isEmpty(this.config.gitBinaryPath)) {
        this.git.customBinary(this.config.gitBinaryPath)
      }
    }
  }

  async resolveSshKeyPath() {
    if (this.config.authType !== 'ssh') {
      return null
    }
    if (this.config.sshPrivateKeyMode === 'contents' && this.config.sshPrivateKeyContent) {
      try {
        const secureDir = path.resolve(WIKI.ROOTPATH, WIKI.config.dataPath, 'secure')
        await fs.ensureDir(secureDir, { mode: 0o700 })
        this.config.sshPrivateKeyPath = path.join(secureDir, `git-${_.kebabCase(this.config.defaultName || 'storage')}.pem`)
        await fs.outputFile(this.config.sshPrivateKeyPath, this.config.sshPrivateKeyContent + os.EOL, {
          encoding: 'utf8',
          mode: 0o600
        })
      } catch (err) {
        WIKI.logger.error(err)
        throw err
      }
    }
    return this.config.sshPrivateKeyPath
  }

  async configureRemote() {
    await this.git.raw(['config', '--local', '--bool', 'http.sslVerify', _.toString(this.config.verifySSL)])

    const remotes = await this.git.getRemotes()
    if (remotes.length > 0) {
      for (const remote of remotes) {
        await this.git.removeRemote(remote.name)
      }
    }

    switch (this.config.authType) {
      case 'ssh': {
        await this.resolveSshKeyPath()
        if (this.config.sshPrivateKeyPath) {
          const sshCommandArgs = ['ssh', '-o', 'IdentitiesOnly=yes']
          if (this.config.verifySSL) {
            sshCommandArgs.push('-o', 'StrictHostKeyChecking=yes')
          } else {
            sshCommandArgs.push('-o', 'StrictHostKeyChecking=no')
          }
          sshCommandArgs.push('-i', this.config.sshPrivateKeyPath)
          await this.git.addConfig('core.sshCommand', sshCommandArgs.join(' '))
        }
        await this.git.addRemote('origin', this.config.repoUrl)
        break
      }
      default: {
        let originUrl = ''
        const username = encodeURI(this.config.basicUsername || '')
        const password = encodeURI(this.config.basicPassword || '')
        if (_.startsWith(this.config.repoUrl, 'http')) {
          originUrl = this.config.repoUrl.replace('://', `://${username}:${password}@`)
        } else {
          originUrl = `https://${username}:${password}@${this.config.repoUrl}`
        }
        await this.git.addRemote('origin', originUrl)
        break
      }
    }
  }

  async markSafeDirectory() {
    try {
      await this.git.raw(['config', '--global', '--add', 'safe.directory', this.repoPath])
    } catch (err) {
      if (!_.includes(_.get(err, 'message', ''), 'already exists')) {
        WIKI.logger.warn(`(STORAGE/GIT) Unable to mark ${this.repoPath} as a safe directory: ${err.message}`)
      }
    }
  }

  async init({ skipSync = false } = {}) {
    WIKI.logger.info('(STORAGE/GIT) Initializing...')
    await this.ensureGit()

    WIKI.logger.info('(STORAGE/GIT) Checking repository state...')
    const isRepo = await this.git.checkIsRepo()
    if (!isRepo) {
      WIKI.logger.info('(STORAGE/GIT) Initializing local repository...')
      await this.git.init()
    }

    await this.git.raw(['config', '--local', 'core.quotepath', false])
    await this.git.raw(['config', '--local', 'color.ui', false])
    await this.git.raw(['config', '--local', 'user.email', this.config.defaultEmail])
    await this.git.raw(['config', '--local', 'user.name', this.config.defaultName])

    await this.configureRemote()

    WIKI.logger.info('(STORAGE/GIT) Fetch updates from remote...')
    await this.git.raw(['remote', 'update', 'origin']).catch(async err => {
      WIKI.logger.warn(`(STORAGE/GIT) Failed to fetch remote updates: ${err.message}`)
      throw err
    })

    const branches = await this.git.branch()
    if (!_.includes(branches.all, this.config.branch) && !_.includes(branches.all, `remotes/origin/${this.config.branch}`)) {
      throw new Error('Invalid branch! Make sure it exists on the remote first.')
    }
    WIKI.logger.info(`(STORAGE/GIT) Checking out branch ${this.config.branch}...`)
    await this.git.checkout(this.config.branch)

    await this.markSafeDirectory()

    if (!skipSync) {
      await this.sync()
    }

    WIKI.logger.info('(STORAGE/GIT) Initialization completed.')
  }

  async sync() {
    const currentCommitLog = _.get(await this.git.log(['-n', '1', this.config.branch, '--']), 'latest', {})

    const rootUser = await WIKI.models.users.getRootUser()

    if (_.includes(['sync', 'pull'], this.mode)) {
      WIKI.logger.info(`(STORAGE/GIT) Performing pull rebase from origin on branch ${this.config.branch}...`)
      await this.git.pull('origin', this.config.branch, ['--rebase'])
    }

    if (_.includes(['sync', 'push'], this.mode)) {
      WIKI.logger.info(`(STORAGE/GIT) Performing push to origin on branch ${this.config.branch}...`)
      let pushOpts = ['--signed=if-asked']
      if (this.mode === 'push') {
        pushOpts.push('--force')
      }
      await this.git.push('origin', this.config.branch, pushOpts)
    }

    if (_.includes(['sync', 'pull'], this.mode)) {
      const latestCommitLog = _.get(await this.git.log(['-n', '1', this.config.branch, '--']), 'latest', {})

      const diff = await this.git.diffSummary(['-M', currentCommitLog.hash, latestCommitLog.hash])
      if (_.get(diff, 'files', []).length > 0) {
        let filesToProcess = []
        const filePattern = /(.*?)(?:{(.*?))? => (?:(.*?)})?(.*)/
        for (const f of diff.files) {
          const fMatch = f.file.match(filePattern)
          const fNames = {
            old: null,
            new: null
          }
          if (!fMatch) {
            fNames.old = f.file
            fNames.new = f.file
          } else if (!fMatch[2] && !fMatch[3]) {
            fNames.old = fMatch[1]
            fNames.new = fMatch[4]
          } else {
            fNames.old = (fMatch[1] + fMatch[2] + fMatch[4]).replace('//', '/')
            fNames.new = (fMatch[1] + fMatch[3] + fMatch[4]).replace('//', '/')
          }
          const fPath = path.join(this.repoPath, fNames.new)
          let fStats = { size: 0 }
          try {
            fStats = await fs.stat(fPath)
          } catch (err) {
            if (err.code !== 'ENOENT') {
              WIKI.logger.warn(`(STORAGE/GIT) Failed to access file ${f.file}! Skipping...`)
              continue
            }
          }

          filesToProcess.push({
            ...f,
            file: {
              path: fPath,
              stats: fStats
            },
            oldPath: fNames.old,
            relPath: fNames.new
          })
        }
        await this.processFiles(filesToProcess, rootUser)
      }
    }
  }

  async processFiles(files, user) {
    for (const item of files) {
      const contentType = pageHelper.getContentType(item.relPath)
      const fileExists = await fs.pathExists(item.file.path)
      if (!item.binary && contentType) {
        if (fileExists && !item.importAll && item.relPath !== item.oldPath) {
          WIKI.logger.info(`(STORAGE/GIT) Page marked as renamed: from ${item.oldPath} to ${item.relPath}`)

          const contentPath = pageHelper.getPagePath(item.oldPath)
          const contentDestinationPath = pageHelper.getPagePath(item.relPath)
          await WIKI.models.pages.movePage({
            user: user,
            path: contentPath.path,
            destinationPath: contentDestinationPath.path,
            locale: contentPath.locale,
            destinationLocale: contentPath.locale,
            skipStorage: true
          })
        } else if (!fileExists && !item.importAll && item.deletions > 0 && item.insertions === 0) {
          WIKI.logger.info(`(STORAGE/GIT) Page marked as deleted: ${item.relPath}`)

          const contentPath = pageHelper.getPagePath(item.relPath)
          await WIKI.models.pages.deletePage({
            user: user,
            path: contentPath.path,
            locale: contentPath.locale,
            skipStorage: true
          })
          continue
        }

        try {
          await commonDisk.processPage({
            user,
            relPath: item.relPath,
            fullPath: this.repoPath,
            contentType: contentType,
            moduleName: 'GIT'
          })
        } catch (err) {
          WIKI.logger.warn(`(STORAGE/GIT) Failed to process ${item.relPath}`)
          WIKI.logger.warn(err)
        }
      } else {
        if (fileExists && !item.importAll && ((item.before === item.after) || (item.deletions === 0 && item.insertions === 0))) {
          WIKI.logger.info(`(STORAGE/GIT) Asset marked as renamed: from ${item.oldPath} to ${item.relPath}`)

          const fileHash = assetHelper.generateHash(item.relPath)
          const assetToRename = await WIKI.models.assets.query().findOne({ hash: fileHash })
          if (assetToRename) {
            await WIKI.models.assets.query().patch({
              filename: item.relPath,
              hash: fileHash
            }).findById(assetToRename.id)
            await assetToRename.deleteAssetCache()
          } else {
            WIKI.logger.info(`(STORAGE/GIT) Asset was not found in the DB, nothing to rename: ${item.relPath}`)
          }
          continue
        } else if (!fileExists && !item.importAll && ((item.before > 0 && item.after === 0) || (item.deletions > 0 && item.insertions === 0))) {
          WIKI.logger.info(`(STORAGE/GIT) Asset marked as deleted: ${item.relPath}`)

          const fileHash = assetHelper.generateHash(item.relPath)
          const assetToDelete = await WIKI.models.assets.query().findOne({ hash: fileHash })
          if (assetToDelete) {
            await WIKI.models.knex('assetData').where('id', assetToDelete.id).del()
            await WIKI.models.assets.query().deleteById(assetToDelete.id)
            await assetToDelete.deleteAssetCache()
          } else {
            WIKI.logger.info(`(STORAGE/GIT) Asset was not found in the DB, nothing to delete: ${item.relPath}`)
          }
          continue
        }

        try {
          await commonDisk.processAsset({
            user,
            relPath: item.relPath,
            file: item.file,
            contentType: contentType,
            moduleName: 'GIT'
          })
        } catch (err) {
          WIKI.logger.warn(`(STORAGE/GIT) Failed to process asset ${item.relPath}`)
          WIKI.logger.warn(err)
        }
      }
    }
  }

  async created(page) {
    WIKI.logger.info(`(STORAGE/GIT) Committing new file [${page.localeCode}] ${page.path}...`)
    let fileName = `${page.path}.${pageHelper.getFileExtension(page.contentType)}`
    if (this.config.alwaysNamespace || (WIKI.config.lang.namespacing && WIKI.config.lang.code !== page.localeCode)) {
      fileName = `${page.localeCode}/${fileName}`
    }
    const filePath = path.join(this.repoPath, fileName)
    await fs.outputFile(filePath, page.injectMetadata(), 'utf8')

    const gitFilePath = `./${fileName}`
    if ((await this.git.checkIgnore(gitFilePath)).length === 0) {
      await this.git.add(gitFilePath)
      await this.git.commit(`docs: create ${page.path}`, fileName, {
        '--author': `"${page.authorName} <${page.authorEmail}>"`
      })
    }
  }

  async updated(page) {
    WIKI.logger.info(`(STORAGE/GIT) Committing updated file [${page.localeCode}] ${page.path}...`)
    let fileName = `${page.path}.${pageHelper.getFileExtension(page.contentType)}`
    if (this.config.alwaysNamespace || (WIKI.config.lang.namespacing && WIKI.config.lang.code !== page.localeCode)) {
      fileName = `${page.localeCode}/${fileName}`
    }
    const filePath = path.join(this.repoPath, fileName)
    await fs.outputFile(filePath, page.injectMetadata(), 'utf8')

    const gitFilePath = `./${fileName}`
    if ((await this.git.checkIgnore(gitFilePath)).length === 0) {
      await this.git.add(gitFilePath)
      await this.git.commit(`docs: update ${page.path}`, fileName, {
        '--author': `"${page.authorName} <${page.authorEmail}>"`
      })
    }
  }

  async deleted(page) {
    WIKI.logger.info(`(STORAGE/GIT) Committing removed file [${page.localeCode}] ${page.path}...`)
    let fileName = `${page.path}.${pageHelper.getFileExtension(page.contentType)}`
    if (this.config.alwaysNamespace || (WIKI.config.lang.namespacing && WIKI.config.lang.code !== page.localeCode)) {
      fileName = `${page.localeCode}/${fileName}`
    }

    const gitFilePath = `./${fileName}`
    if ((await this.git.checkIgnore(gitFilePath)).length === 0) {
      await this.git.rm(gitFilePath)
      await this.git.commit(`docs: delete ${page.path}`, fileName, {
        '--author': `"${page.authorName} <${page.authorEmail}>"`
      })
    }
  }

  async renamed(page) {
    WIKI.logger.info(`(STORAGE/GIT) Committing file move from [${page.localeCode}] ${page.path} to [${page.destinationLocaleCode}] ${page.destinationPath}...`)
    let sourceFileName = `${page.path}.${pageHelper.getFileExtension(page.contentType)}`
    let destinationFileName = `${page.destinationPath}.${pageHelper.getFileExtension(page.contentType)}`

    if (this.config.alwaysNamespace || WIKI.config.lang.namespacing) {
      if (this.config.alwaysNamespace || WIKI.config.lang.code !== page.localeCode) {
        sourceFileName = `${page.localeCode}/${sourceFileName}`
      }
      if (this.config.alwaysNamespace || WIKI.config.lang.code !== page.destinationLocaleCode) {
        destinationFileName = `${page.destinationLocaleCode}/${destinationFileName}`
      }
    }

    const sourceFilePath = path.join(this.repoPath, sourceFileName)
    const destinationFilePath = path.join(this.repoPath, destinationFileName)
    await fs.move(sourceFilePath, destinationFilePath)

    await this.git.rm(`./${sourceFileName}`)
    await this.git.add(`./${destinationFileName}`)
    await this.git.commit(`docs: rename ${page.path} to ${page.destinationPath}`, [sourceFilePath, destinationFilePath], {
      '--author': `"${page.moveAuthorName} <${page.moveAuthorEmail}>"`
    })
  }

  async assetUploaded(asset) {
    WIKI.logger.info(`(STORAGE/GIT) Committing new file ${asset.path}...`)
    const filePath = path.join(this.repoPath, asset.path)
    await fs.outputFile(filePath, asset.data, 'utf8')

    await this.git.add(`./${asset.path}`)
    await this.git.commit(`docs: upload ${asset.path}`, asset.path, {
      '--author': `"${asset.authorName} <${asset.authorEmail}>"`
    })
  }

  async assetDeleted(asset) {
    WIKI.logger.info(`(STORAGE/GIT) Committing removed file ${asset.path}...`)

    await this.git.rm(`./${asset.path}`)
    await this.git.commit(`docs: delete ${asset.path}`, asset.path, {
      '--author': `"${asset.authorName} <${asset.authorEmail}>"`
    })
  }

  async assetRenamed(asset) {
    WIKI.logger.info(`(STORAGE/GIT) Committing file move from ${asset.path} to ${asset.destinationPath}...`)

    await this.git.mv(`./${asset.path}`, `./${asset.destinationPath}`)
    await this.git.commit(`docs: rename ${asset.path} to ${asset.destinationPath}`, [asset.path, asset.destinationPath], {
      '--author': `"${asset.moveAuthorName} <${asset.moveAuthorEmail}>"`
    })
  }

  async getLocalLocation(asset) {
    return path.join(this.repoPath, asset.path)
  }

  async importAll() {
    WIKI.logger.info(`(STORAGE/GIT) Importing all content from local Git repo to the DB...`)

    const rootUser = await WIKI.models.users.getRootUser()

    await pipeline(
      klaw(this.repoPath, {
        filter: (f) => {
          return !_.includes(f, '.git')
        }
      }),
      new stream.Transform({
        objectMode: true,
        transform: async (file, enc, cb) => {
          const relPath = file.path.substr(this.repoPath.length + 1)
          if (file.stats.size < 1) {
            return cb()
          } else if (relPath && relPath.length > 3) {
            WIKI.logger.info(`(STORAGE/GIT) Processing ${relPath}...`)
            await this.processFiles([{
              user: rootUser,
              relPath,
              file,
              deletions: 0,
              insertions: 0,
              importAll: true
            }], rootUser)
          }
          cb()
        }
      })
    )

    commonDisk.clearFolderCache()

    WIKI.logger.info('(STORAGE/GIT) Import completed.')
  }

  async syncUntracked() {
    WIKI.logger.info(`(STORAGE/GIT) Adding all untracked content...`)

    await pipeline(
      WIKI.models.knex.column('id', 'path', 'localeCode', 'title', 'description', 'contentType', 'content', 'isPublished', 'updatedAt', 'createdAt', 'editorKey').select().from('pages').where({
        isPrivate: false
      }).stream(),
      new stream.Transform({
        objectMode: true,
        transform: async (page, enc, cb) => {
          const pageObject = await WIKI.models.pages.query().findById(page.id)
          page.tags = await pageObject.$relatedQuery('tags')

          let fileName = `${page.path}.${pageHelper.getFileExtension(page.contentType)}`
          if (this.config.alwaysNamespace || (WIKI.config.lang.namespacing && WIKI.config.lang.code !== page.localeCode)) {
            fileName = `${page.localeCode}/${fileName}`
          }
          WIKI.logger.info(`(STORAGE/GIT) Adding page ${fileName}...`)
          const filePath = path.join(this.repoPath, fileName)
          await fs.outputFile(filePath, pageHelper.injectPageMetadata(page), 'utf8')
          await this.git.add(`./${fileName}`)
          cb()
        }
      })
    )

    const assetFolders = await WIKI.models.assetFolders.getAllPaths()

    await pipeline(
      WIKI.models.knex.column('filename', 'folderId', 'data').select().from('assets').join('assetData', 'assets.id', '=', 'assetData.id').stream(),
      new stream.Transform({
        objectMode: true,
        transform: async (asset, enc, cb) => {
          const filename = (asset.folderId && asset.folderId > 0) ? `${_.get(assetFolders, asset.folderId)}/${asset.filename}` : asset.filename
          WIKI.logger.info(`(STORAGE/GIT) Adding asset ${filename}...`)
          await fs.outputFile(path.join(this.repoPath, filename), asset.data)
          await this.git.add(`./${filename}`)
          cb()
        }
      })
    )

    await this.git.commit(`docs: add all untracked content`)
    WIKI.logger.info('(STORAGE/GIT) All content is now tracked.')
  }

  async purge() {
    WIKI.logger.info(`(STORAGE/GIT) Purging local repository...`)
    await fs.emptyDir(this.repoPath)
    WIKI.logger.info('(STORAGE/GIT) Local repository is now empty. Reinitializing...')
    this.git = null
    await this.init()
  }
}

module.exports = GitAdapter
