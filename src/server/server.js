import app from './app'
require('source-map-support').install()

const server = app.listen(process.env.PORT || 8080, () => {
  console.log(`[server] app on http://localhost:${server.address().port} - ${app.settings.env}`)
})

process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0)
  })
})
