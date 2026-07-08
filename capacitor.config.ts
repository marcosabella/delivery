import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sistemapedidos.web',
  appName: 'Sistema Pedidos',
  webDir: 'dist',
  android: {
    adjustMarginsForEdgeToEdge: 'force',
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
