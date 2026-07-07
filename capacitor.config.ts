import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sistemapedidos.web',
  appName: 'Sistema Pedidos',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
