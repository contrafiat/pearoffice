// Expo config plugin: declare an Android <queries> block so the app can ask
// whether a Lightning wallet is installed (the donation sheet, from
// PearList). Android 11+ hides other apps from canOpenURL without it.
const { withAndroidManifest } = require('expo/config-plugins')

module.exports = function withAndroidQueries (config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest
    manifest.queries = manifest.queries || []
    manifest.queries.push({
      intent: [{
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        data: [{ $: { 'android:scheme': 'lightning' } }]
      }]
    })
    return cfg
  })
}
