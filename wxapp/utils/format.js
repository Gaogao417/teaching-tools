function pad(value) {
  return value < 10 ? `0${value}` : String(value)
}

function formatMs(ms) {
  if (!Number.isFinite(ms)) {
    return '--'
  }
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${pad(minutes)}:${pad(seconds)}`
}

function formatDateTime(value) {
  if (!value) {
    return '--'
  }
  const date = new Date(value)
  return `${date.getMonth() + 1}.${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

module.exports = {
  formatMs,
  formatDateTime
}
