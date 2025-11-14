<template lang='pug'>
  div.git-profiles
    v-alert(type='info', dense, outlined)
      strong Manage multiple Git storage profiles.
      span.ml-2 Allows independent push / pull schedules with per-profile auth and direction.

    v-card(flat, class='mb-4')
      v-card-title
        span.subtitle-1 Profiles
        v-spacer
        v-btn(color='primary', small, depressed, @click='openCreate')
          v-icon(left) mdi-plus
          | Add Profile
        v-btn.ml-2(color='grey', small, outlined, @click='loadProfiles()', :loading='loading')
          v-icon(left) mdi-refresh
          | Refresh
      v-card-text
        v-alert(type='error', outlined, dense, v-if='error')
          | {{ error }}
        v-simple-table(v-else)
          template(v-slot:default)
            thead
              tr
                th Name
                th Direction
                th Branch
                th Enabled
                th Last Run
                th Actions
            tbody
              tr(v-for='profile in profiles', :key='profile.id')
                td {{ profile.name }}
                td {{ friendlyDirection(profile.direction) }}
                td {{ profile.branch }}
                td
                  v-chip(small, :color="profile.enabled ? 'green' : 'grey'", text-color='white') {{ profile.enabled ? 'On' : 'Off' }}
                td
                  span(v-if='profile.lastRun') {{ formatRun(profile.lastRun) }}
                  span(v-else, class='caption grey--text') Never
                td
                  v-tooltip(bottom)
                    template(v-slot:activator='{ on, attrs }')
                      v-btn(icon, small, v-on='on', v-bind='attrs', @click='openEdit(profile)')
                        v-icon mdi-pencil
                    span Edit profile
                  v-tooltip(bottom)
                    template(v-slot:activator='{ on, attrs }')
                      v-btn(icon, small, color='green', v-on='on', v-bind='attrs', :loading='actionLoading === `sync-${profile.id}`', @click='triggerSync(profile.id)')
                        v-icon mdi-sync
                    span Sync now
                  v-tooltip(bottom)
                    template(v-slot:activator='{ on, attrs }')
                      v-btn(icon, small, color='orange', v-on='on', v-bind='attrs', :loading='actionLoading === `force-${profile.id}`', @click='triggerForce(profile.id)')
                        v-icon mdi-alert
                    span Force sync (re-clone)
                  v-tooltip(bottom)
                    template(v-slot:activator='{ on, attrs }')
                      v-btn(icon, small, color='teal', v-on='on', v-bind='attrs', :loading='actionLoading === `test-${profile.id}`', @click='testProfile(profile.id)')
                        v-icon mdi-connection
                    span Test connection
                  v-tooltip(bottom)
                    template(v-slot:activator='{ on, attrs }')
                      v-btn(icon, small, color='red', v-on='on', v-bind='attrs', :loading='actionLoading === `delete-${profile.id}`', @click='deleteProfile(profile.id)')
                        v-icon mdi-delete
                    span Delete profile
              tr(v-if='profiles.length === 0')
                td(colspan='6', class='caption grey--text text-center') No profiles configured yet.

    v-dialog(v-model='dialog.visible', max-width='900px', persistent)
      v-card
        v-card-title
          span.headline {{ dialogTitle }}
          v-spacer
          v-btn(icon, @click='closeDialog', :disabled='dialog.loading')
            v-icon mdi-close
        v-card-text
          v-form(ref='form')
            v-container(fluid)
              v-row
                v-col(cols='12', md='6')
                  v-text-field(
                    outlined
                    label='Name'
                    v-model='form.name'
                    required
                  )
                v-col(cols='12', md='6')
                  v-switch(
                    inset
                    label='Enabled'
                    color='primary'
                    v-model='form.enabled'
                  )
              v-row
                v-col(cols='12', md='6')
                  v-select(
                    outlined
                    label='Direction'
                    :items='directionOptions'
                    v-model='form.direction'
                    required
                  )
                v-col(cols='12', md='6')
                  v-text-field(
                    outlined
                    label='Branch'
                    v-model='form.branch'
                  )
              v-row
                v-col(cols='12', md='6')
                  v-text-field(
                    outlined
                    label='Repository URL'
                    v-model='form.repoUrl'
                    required
                  )
                v-col(cols='12', md='6')
                  v-text-field(
                    outlined
                    label='Local Path'
                    v-model='form.localPath'
                    required
                  )
              v-row
                v-col(cols='12', md='6')
                  v-select(
                    outlined
                    label='Authentication'
                    :items='authOptions'
                    v-model='form.authType'
                  )
                v-col(cols='12', md='6')
                  v-switch(
                    inset
                    label='Verify SSL'
                    color='primary'
                    v-model='form.verifySSL'
                  )
              v-row(v-if='form.authType === \"ssh\"')
                v-col(cols='12', md='6')
                  v-select(
                    outlined
                    label='SSH Key Mode'
                    :items='sshModeOptions'
                    v-model='form.sshKeyMode'
                  )
                v-col(cols='12', md='6', v-if='form.sshKeyMode === \"path\"')
                  v-text-field(
                    outlined
                    label='SSH Private Key Path'
                    v-model='form.sshKeyPath'
                  )
                v-col(cols='12', v-if='form.sshKeyMode === \"contents\"')
                  v-textarea(
                    outlined
                    label='SSH Private Key Contents'
                    v-model='form.sshKeyContent'
                    rows='4'
                  )
              v-row(v-if='form.authType === \"https_pat\"')
                v-col(cols='12', md='6')
                  v-text-field(
                    outlined
                    label='Username'
                    v-model='form.username'
                  )
                v-col(cols='12', md='6')
                  v-text-field(
                    outlined
                    :type='showToken ? \"text\" : \"password\"'
                    :append-icon='showToken ? \"mdi-eye-off\" : \"mdi-eye\"'
                    @click:append='showToken = !showToken'
                    label='Token / PAT'
                    v-model='form.token'
                  )
              v-expansion-panels(flat, multiple, v-model='advancedPanel')
                v-expansion-panel
                  v-expansion-panel-header Advanced
                  v-expansion-panel-content
                    v-row
                      v-col(cols='12', md='6')
                        v-text-field(outlined, label='Default Author Name', v-model='form.defaultAuthorName')
                      v-col(cols='12', md='6')
                        v-text-field(outlined, label='Default Author Email', v-model='form.defaultAuthorEmail')
                    v-row
                      v-col(cols='12', md='6')
                        v-text-field(outlined, label='Committer Name', v-model='form.committerName')
                      v-col(cols='12', md='6')
                        v-text-field(outlined, label='Committer Email', v-model='form.committerEmail')
                    v-row
                      v-col(cols='12', md='6')
                        v-text-field(outlined, label='Schedule (cron)', v-model='form.scheduleCron', hint='Optional cron expression', persistent-hint)
                      v-col(cols='12', md='6')
                        v-text-field(outlined, label='Webhook Secret', v-model='form.webhookSecret', hint='Required for Git webhook sync', persistent-hint)
                    v-row
                      v-col(cols='12', md='6')
                        v-switch(inset, label='Always namespace content', color='primary', v-model='form.alwaysNamespace')
                      v-col(cols='12', md='6')
                        v-text-field(outlined, label='Git Binary Path', v-model='form.gitBinaryPath', hint='Optional custom git binary', persistent-hint)
        v-card-actions
          v-spacer
          v-btn(text, @click='closeDialog', :disabled='dialog.loading') Cancel
          v-btn(color='primary', depressed, :loading='dialog.loading', @click='saveProfile')
            v-icon(left) mdi-content-save
            | Save
</template>

<script>
import moment from 'moment'
import _ from 'lodash'

const emptyForm = () => ({
  id: null,
  name: '',
  enabled: true,
  direction: 'BIDIRECTIONAL',
  repoUrl: '',
  branch: 'main',
  localPath: '',
  verifySSL: true,
  authType: 'ssh',
  sshKeyMode: 'path',
  sshKeyPath: '',
  sshKeyContent: '',
  username: '',
  token: '',
  defaultAuthorName: '',
  defaultAuthorEmail: '',
  committerName: '',
  committerEmail: '',
  scheduleCron: '',
  webhookSecret: '',
  alwaysNamespace: false,
  gitBinaryPath: ''
})

export default {
  data () {
    return {
      loading: false,
      error: '',
      profiles: [],
      actionLoading: '',
      dialog: {
        visible: false,
        loading: false,
        mode: 'create'
      },
      form: emptyForm(),
      showToken: false,
      directionOptions: [
        { text: 'Bi-directional', value: 'BIDIRECTIONAL' },
        { text: 'Push only', value: 'PUSH_ONLY' },
        { text: 'Pull only', value: 'PULL_ONLY' }
      ],
      authOptions: [
        { text: 'SSH', value: 'ssh' },
        { text: 'HTTPS + PAT', value: 'https_pat' }
      ],
      sshModeOptions: [
        { text: 'Key path', value: 'path' },
        { text: 'Inline contents', value: 'contents' }
      ],
      advancedPanel: [0]
    }
  },
  computed: {
    dialogTitle () {
      return this.dialog.mode === 'edit' ? 'Edit Profile' : 'Add Profile'
    }
  },
  created () {
    this.loadProfiles()
  },
  methods: {
    friendlyDirection (direction) {
      switch (direction) {
        case 'PUSH_ONLY': return 'Push only'
        case 'PULL_ONLY': return 'Pull only'
        default: return 'Bi-directional'
      }
    },
    formatRun (run) {
      if (!run || !run.startedAt) {
        return 'Never'
      }
      return `${run.status || 'pending'} · ${moment(run.startedAt).fromNow()}`
    },
    async loadProfiles (emit = true) {
      this.loading = true
      this.error = ''
      try {
        const res = await fetch('/admin/storage/git/profiles', {
          credentials: 'same-origin'
        })
        if (!res.ok) {
          throw new Error(await res.text())
        }
        const data = await res.json()
        this.profiles = _.get(data, 'profiles', [])
        if (emit) {
          this.$emit('updated')
        }
      } catch (err) {
        this.error = err.message || 'Failed to load profiles.'
        this.profiles = []
      } finally {
        this.loading = false
      }
    },
    openCreate () {
      this.dialog.mode = 'create'
      this.form = emptyForm()
      this.dialog.visible = true
      this.showToken = false
    },
    openEdit (profile) {
      this.dialog.mode = 'edit'
      this.form = {
        ...emptyForm(),
        ..._.omit(profile, ['lastRun', 'hasToken', 'hasSshKey'])
      }
      this.form.token = ''
      this.form.sshKeyContent = ''
      this.dialog.visible = true
      this.showToken = false
    },
    closeDialog () {
      if (this.dialog.loading) { return }
      this.dialog.visible = false
    },
    async saveProfile () {
      this.dialog.loading = true
      try {
        const method = this.dialog.mode === 'edit' ? 'PUT' : 'POST'
        const url = this.dialog.mode === 'edit'
          ? `/admin/storage/git/profiles/${this.form.id}`
          : '/admin/storage/git/profiles'
        const payload = _.omit(this.form, ['id'])
        if (this.dialog.mode === 'edit' && !payload.token) {
          delete payload.token
        }
        if (this.dialog.mode === 'edit' && !payload.sshKeyContent) {
          delete payload.sshKeyContent
        }
        const res = await fetch(url, {
          method,
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        })
        if (!res.ok) {
          throw new Error(await res.text())
        }
        await this.loadProfiles()
        this.$store.commit('showNotification', {
          style: 'success',
          message: 'Profile saved.',
          icon: 'check'
        })
        this.dialog.visible = false
      } catch (err) {
        this.$store.commit('showNotification', {
          style: 'error',
          message: err.message || 'Failed to save profile.',
          icon: 'alert'
        })
      } finally {
        this.dialog.loading = false
      }
    },
    async deleteProfile (id) {
      if (!confirm('Delete this profile?')) {
        return
      }
      this.actionLoading = `delete-${id}`
      try {
        const res = await fetch(`/admin/storage/git/profiles/${id}`, {
          method: 'DELETE',
          credentials: 'same-origin'
        })
        if (!res.ok) {
          throw new Error(await res.text())
        }
        await this.loadProfiles()
        this.$store.commit('showNotification', {
          style: 'success',
          message: 'Profile deleted.',
          icon: 'check'
        })
      } catch (err) {
        this.$store.commit('showNotification', {
          style: 'error',
          message: err.message || 'Failed to delete profile.',
          icon: 'alert'
        })
      } finally {
        this.actionLoading = ''
      }
    },
    async triggerSync (id) {
      this.actionLoading = `sync-${id}`
      try {
        const res = await fetch(`/admin/storage/git/profiles/${id}/sync`, {
          method: 'POST',
          credentials: 'same-origin'
        })
        if (!res.ok) {
          throw new Error(await res.text())
        }
        await this.loadProfiles()
        this.$store.commit('showNotification', {
          style: 'success',
          message: 'Sync completed.',
          icon: 'check'
        })
      } catch (err) {
        this.$store.commit('showNotification', {
          style: 'error',
          message: err.message || 'Failed to sync.',
          icon: 'alert'
        })
      } finally {
        this.actionLoading = ''
      }
    },
    async triggerForce (id) {
      this.actionLoading = `force-${id}`
      try {
        const res = await fetch(`/admin/storage/git/profiles/${id}/force`, {
          method: 'POST',
          credentials: 'same-origin'
        })
        if (!res.ok) {
          throw new Error(await res.text())
        }
        await this.loadProfiles()
        this.$store.commit('showNotification', {
          style: 'success',
          message: 'Force sync completed.',
          icon: 'check'
        })
      } catch (err) {
        this.$store.commit('showNotification', {
          style: 'error',
          message: err.message || 'Failed to force sync.',
          icon: 'alert'
        })
      } finally {
        this.actionLoading = ''
      }
    },
    async testProfile (id) {
      this.actionLoading = `test-${id}`
      try {
        const res = await fetch(`/admin/storage/git/profiles/${id}/test`, {
          method: 'POST',
          credentials: 'same-origin'
        })
        if (!res.ok) {
          throw new Error(await res.text())
        }
        this.$store.commit('showNotification', {
          style: 'success',
          message: 'Connection test succeeded.',
          icon: 'check'
        })
      } catch (err) {
        this.$store.commit('showNotification', {
          style: 'error',
          message: err.message || 'Test failed.',
          icon: 'alert'
        })
      } finally {
        this.actionLoading = ''
      }
    }
  }
}
</script>

<style scoped>
.git-profiles .v-data-table {
  font-size: 0.9rem;
}

.git-profiles td.actions > * {
  margin-right: 4px;
}
</style>
