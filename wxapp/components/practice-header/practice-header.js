Component({
  options: {
    addGlobalClass: true
  },

  properties: {
    layoutMode: {
      type: String,
      value: 'wide'
    },
    title: {
      type: String,
      value: ''
    },
    currentIndex: {
      type: Number,
      value: 0
    },
    total: {
      type: Number,
      value: 0
    },
    formattedTime: {
      type: String,
      value: '00:00'
    },
    progressPercent: {
      type: Number,
      value: 0
    }
  },

  methods: {
    handleBackHome() {
      this.triggerEvent('backhome')
    },

    handleRestart() {
      this.triggerEvent('restart')
    }
  }
})
