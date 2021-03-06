const rollup = require('rollup').rollup
const buble = require('rollup-plugin-buble')
const json = require('rollup-plugin-json')
const commonjs = require('rollup-plugin-commonjs')
const replace = require('rollup-plugin-replace')
const uglify = require('rollup-plugin-uglify')
const nodeResolve = require('rollup-plugin-node-resolve')
const fs = require('fs-extra-promise')
const sass = require('node-sass').render
const cssnano = require('cssnano').process
const purifycss = require('purify-css')
const optimizeJs = require('optimize-js') // optimizeJs should be used & perf'd on case by case basis
const { name, dependencies } = require('./package')
const swPrecache = require('sw-precache').write
const nodeRev = require('node-rev').default

const server = () => rollup({
  entry: 'src/server/server.js',
  external: Object.keys(dependencies).concat(['fs']),
  plugins: [
    replace({ '__CLIENT__': false }),
    json(),
    commonjs({ extensions: [ '.js', '.json' ] }),
    buble({ jsx: 'h', objectAssign: 'Object.assign' })
  ]
}).then((bundle) => bundle.write({ sourceMap: true, format: 'cjs', dest: `build/server.js` }))

const client = () => rollup({
  entry: 'src/app/entry.js',
  context: 'window',
  plugins: [
    nodeResolve({ jsnext: true, browser: true }),
    commonjs({ namedExports: { 'preact-redux': ['connect', 'Provider'] } }),
    replace({ '__CLIENT__': true, 'process.env.NODE_ENV': JSON.stringify('production') }),
    buble({ jsx: 'h', objectAssign: 'Object.assign' }),
    uglify(require('./uglify'))
  ]
})
.then((bundle) => bundle.generate({ sourceMap: true, format: 'iife' }))
.then(({ code, map }) => Promise.all([
  fs.outputFileAsync(`build/public/bundle.js`, optimizeJs(code) + `//# sourceMappingURL=/bundle.js.map`),
  fs.outputFileAsync(`build/public/bundle.js.map`, map.toString())
]))

const css = () => new Promise((resolve, reject) => sass({ file: `src/app/styles/entry.scss` }, (err, result) => err ? reject(err) : resolve(result)))
  .then(({ css }) => purifycss(['src/app/components/**/*.js'], css.toString()))
  .then((purified) => cssnano(purified, { autoprefixer: { add: true } }))
  .then(({ css }) => fs.outputFileAsync(`build/public/bundle.css`, css))

const sw = () => swPrecache('build/public/sw.js', {
  cacheId: `${name}`,
  directoryIndex: '/',
  staticFileGlobs: [
    '/',
    './build/public/manifest-*.json',
    // './build/public/bundle-*.{css,js}', // depends if we inlineJs, inlineCss or not
    './build/public/*.{gif,png,svg}' // will not preache /icons
  ],
  navigateFallback: '/',
  dynamicUrlToDependencies: {
    '/': ['./src/server/routes/root.js', './build/public/bundle.css', './build/public/bundle.js', './build/public/manifest.json', './package.json'] // bust cache when these change
  },
  skipWaiting: true,
  stripPrefix: './build/public',
  runtimeCaching: [{
    urlPattern: /\/posts/, // handle remote api call
    handler: 'cacheFirst'
  }]
})

const rev = () => Promise.resolve(nodeRev({
  files: './build/public/**/*.*',
  outputDir: './build/public/',
  file: './build/public/assets.json',
  hash: true  // depends if we inlineJs, inlineCss or not
}))

const clean = () => fs.emptyDirAsync('./build')
const copy = () => fs.copyAsync(`src/app/static/`, `./build/public/`)

const tasks = new Map()
const run = (task) => {
  const start = new Date()
  return tasks.get(task)().then(() => {
    console.log(`[build] '${task}' done in ${new Date().getTime() - start.getTime()}ms`)
  }, (err) => console.error(err.stack))
}

tasks
  .set('clean', clean)
  .set('client', client)
  .set('css', css)
  .set('copy', copy)
  .set('rev', rev)
  .set('server', server)
  .set('sw', sw)
  .set('build', () => run('clean')
    .then(() => Promise.all([run('client'), run('css'), run('copy'), run('server')]))
    .then(() => run('rev'))
    .then(() => run('sw'))
  )

run(/^\w/.test(process.argv[2] || '') ? process.argv[2] : 'build')
