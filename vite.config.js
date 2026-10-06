import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:phone` serves over HTTPS on the LAN: the microphone (getUserMedia)
// only works in a secure context, so plain http://<pc-ip> would block it on the phone.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'phone' ? [basicSsl()] : [],
  server: { host: true, port: 5180, strictPort: true },
  preview: { host: true, port: 5181 },
}));
