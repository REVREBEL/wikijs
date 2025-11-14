<template lang="pug">
  .tabset.elevation-2
    ul.tabset-tabs(ref='tabs', role='tablist')
      slot(name='tabs')
    .tabset-content(ref='content')
      slot(name='content')
</template>

<script>

import { customAlphabet } from 'nanoid/non-secure'

const nanoid = customAlphabet('1234567890abcdef', 10)

export default {
  data() {
    return {
      currentTab: 0
    }
  },
  watch: {
    currentTab (newValue, oldValue) {
      this.setActiveTab()
    }
  },
  methods: {
    setActiveTab () {
      this.$refs.tabs.childNodes.forEach((node, idx) => {
        if (idx === this.currentTab) {
          node.className = 'is-active'
          node.setAttribute('aria-selected', 'true')
        } else {
          node.className = ''
          node.setAttribute('aria-selected', 'false')
        }
      })
      this.$refs.content.childNodes.forEach((node, idx) => {
        if (idx === this.currentTab) {
          node.className = 'tabset-panel is-active'
          node.removeAttribute('hidden')
        } else {
          node.className = 'tabset-panel'
          node.setAttribute('hidden', '')
        }
      })
    }
  },
  mounted () {
    // Handle scroll to header on load within hidden tab content
    if (window.location.hash && window.location.hash.length > 1) {
      const headerId = decodeURIComponent(window.location.hash)
      let foundIdx = -1
      this.$refs.content.childNodes.forEach((node, idx) => {
        if (node.querySelector(headerId)) {
          foundIdx = idx
        }
      })
      if (foundIdx >= 0) {
        this.currentTab = foundIdx
      }
    }

    this.setActiveTab()

    const tabRefId = nanoid()

    this.$refs.tabs.childNodes.forEach((node, idx) => {
      node.setAttribute('id', `${tabRefId}-${idx}`)
      node.setAttribute('role', 'tab')
      node.setAttribute('aria-controls', `${tabRefId}-${idx}-tab`)
      node.setAttribute('tabindex', '0')
      node.addEventListener('click', ev => {
        this.currentTab = [].indexOf.call(ev.target.parentNode.children, ev.target)
      })
      node.addEventListener('keydown', ev => {
        if (ev.key === 'ArrowLeft' && idx > 0) {
          this.currentTab = idx - 1
          this.$refs.tabs.childNodes[idx - 1].focus()
        } else if (ev.key === 'ArrowRight' && idx < this.$refs.tabs.childNodes.length - 1) {
          this.currentTab = idx + 1
          this.$refs.tabs.childNodes[idx + 1].focus()
        } else if (ev.key === 'Enter' || ev.key === ' ') {
          this.currentTab = idx
          node.focus()
        } else if (ev.key === 'Home') {
          this.currentTab = 0
          ev.preventDefault()
          ev.target.parentNode.children[0].focus()
        } else if (ev.key === 'End') {
          this.currentTab = this.$refs.tabs.childNodes.length - 1
          ev.preventDefault()
          ev.target.parentNode.children[this.$refs.tabs.childNodes.length - 1].focus()
        }
      })
    })

    this.$refs.content.childNodes.forEach((node, idx) => {
      node.setAttribute('id', `${tabRefId}-${idx}-tab`)
      node.setAttribute('role', 'tabpanel')
      node.setAttribute('aria-labelledby', `${tabRefId}-${idx}`)
      node.setAttribute('tabindex', '0')
    })
  }
}
</script>

<style lang="scss">
@import "../_variables.css";
@import "../adapter.classes.tokens.css";

.tabset {
  border-radius: 5px;
  margin-top: 10px;

  @at-root .theme--dark & {
    background-color: var(--color-rev-dark);
  }

  > .tabset-tabs {
    padding-left: 0;
    margin: 0;
    display: flex;
    align-items: stretch;
    background: linear-gradient(to bottom, #FAFAFA, #FAFAFA);
    box-shadow: inset 0 -1px 0 0 var(--color-rev-inverse-dark);
    border-radius: 5px 5px 0 0;
    overflow: auto;

    @at-root .theme--dark & {
      background: linear-gradient(to bottom,var(--color-rev-dark), var(--color-rev-green));
      box-shadow: inset 0 -1px 0 0 var(--color-rev-dark);
    }

    > li {
      display: block;
      padding: 16px;
      margin-top: 0;
      cursor: pointer;
      transition: color 1s ease;
      border-right: 1px solid #FAFAFA;
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 1px;
      user-select: none;

      @at-root .theme--dark & {
        border-right-color: var(--color-rev-dark);
      }

      &.is-active {
        background-color: #FAFAFA;
        margin-bottom: 0;
        padding-bottom: 17px;
        padding-top: 13px;
        color:var(--color-rev-inverse-dark);
        border-top: 3px solid var(--color-rev-dark);

        @at-root .theme--dark & {
          background-color: var(--color-rev-dark);
          color: mc('blue', '300');
        }
      }

      &:last-child {
        border-right: none;

        &.is-active {
          border-right: 1px solid var(--color-rev-inverse-dark);

          @at-root .theme--dark & {
            border-right-color: var(--color-rev-dark);
          }
        }
      }

      &:hover {
        background-color: rgba(#CCC, .1);

        @at-root .theme--dark & {
          background-color: rgba(var(--color-rev-dark), .25);
        }

        &.is-active {
          background-color: #FFF;

          @at-root .theme--dark & {
            background-color: var(--color-rev-dark);
          }
        }
      }

      & + li {
        border-left: 1px solid #EEE;

        @at-root .theme--dark & {
          border-left-color: var(--color-rev-dark);
        }
      }
    }
  }

  > .tabset-content {
    .tabset-panel {
      padding: 2px 16px 16px;
      display: none;

      &.is-active {
        display: block;
      }
    }
  }
}
</style>
