Component({
  options: {
    addGlobalClass: true
  },

  properties: {
    layoutMode: {
      type: String,
      value: 'wide'
    },
    problem: {
      type: Object,
      value: null
    },
    actionBanner: {
      type: String,
      value: ''
    },
    selectedNumeratorLabel: {
      type: String,
      value: '未选择'
    },
    selectedDenominatorLabel: {
      type: String,
      value: '未选择'
    },
    roleCards: {
      type: Array,
      value: []
    },
    edgeFields: {
      type: Array,
      value: []
    },
    knownFields: {
      type: Array,
      value: []
    },
    ratioFields: {
      type: Array,
      value: []
    },
    thirdInput: {
      type: String,
      value: ''
    },
    finalInputs: {
      type: Object,
      value: {
        numerator: '',
        denominator: ''
      }
    }
  },

  methods: {
    handleChooseRole(event) {
      this.triggerEvent('chooserole', event.currentTarget.dataset)
    },

    handleEdgeInput(event) {
      this.triggerEvent('edgeinput', {
        side: event.currentTarget.dataset.side,
        value: event.detail.value
      })
    },

    handleKnownInput(event) {
      this.triggerEvent('knowninput', {
        role: event.currentTarget.dataset.role,
        value: event.detail.value
      })
    },

    handleRatioInput(event) {
      this.triggerEvent('ratioinput', {
        role: event.currentTarget.dataset.role,
        value: event.detail.value
      })
    },

    handleThirdInput(event) {
      this.triggerEvent('thirdinput', {
        value: event.detail.value
      })
    },

    handleFinalInput(event) {
      this.triggerEvent('finalinput', {
        slot: event.currentTarget.dataset.slot,
        value: event.detail.value
      })
    },

    handleSubmit() {
      this.triggerEvent('submitanswer')
    }
  }
})
