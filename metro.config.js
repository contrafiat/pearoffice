const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
// The worklet and the UI ship as .bundle assets (see app.json "assets").
config.resolver.assetExts.push('bundle')
// The licence list (scripts/build-ui.mjs --mobile).
config.resolver.assetExts.push('txt')
// This repo's desktop app, spikes and build output are not part of the mobile
// app. Anchored to the repo root: a bare /dist/ would also block dependencies'
// own dist folders.
const escape = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
config.resolver.blockList = ['desktop', 'spikes', 'dist'].map((d) => new RegExp('^' + escape(path.join(__dirname, d)) + '[/\\\\].*'))

module.exports = config
