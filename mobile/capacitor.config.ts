import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.verso.mobile',
  appName: 'Verso',
  webDir: 'dist',
  android: { allowMixedContent: false }
}

export default config
