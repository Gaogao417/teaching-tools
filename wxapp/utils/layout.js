const BREAKPOINTS = {
  compactMax: 520,
  mediumMax: 960
}

function resolveWindowWidth(source) {
  if (source && Number.isFinite(source.windowWidth)) {
    return source.windowWidth
  }
  if (source && source.size && Number.isFinite(source.size.windowWidth)) {
    return source.size.windowWidth
  }
  if (typeof wx !== 'undefined' && wx.getWindowInfo) {
    return wx.getWindowInfo().windowWidth
  }
  if (typeof wx !== 'undefined' && wx.getSystemInfoSync) {
    return wx.getSystemInfoSync().windowWidth
  }
  return BREAKPOINTS.compactMax
}

function getLayoutMode(source) {
  const width = resolveWindowWidth(source)
  if (width <= BREAKPOINTS.compactMax) {
    return 'compact'
  }
  if (width <= BREAKPOINTS.mediumMax) {
    return 'medium'
  }
  return 'wide'
}

function getLayoutState(source) {
  const layoutMode = getLayoutMode(source)
  return {
    layoutMode,
    isCompact: layoutMode === 'compact',
    isMedium: layoutMode === 'medium',
    isWide: layoutMode === 'wide',
    useDrawer: layoutMode !== 'wide'
  }
}

module.exports = {
  BREAKPOINTS,
  getLayoutMode,
  getLayoutState
}
