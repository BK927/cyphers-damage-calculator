import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 프로젝트 사이트 경로: https://<user>.github.io/cyphers-damage-calculator/
// 저장소 이름이 다르면 아래 base 값을 바꾸세요. (dev 서버는 항상 '/')
// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/cyphers-damage-calculator/' : '/',
  plugins: [react()],
  // 프리뷰 하네스가 PORT 환경변수로 포트를 할당(autoPort) — 없으면 기본 5173
  server: { port: Number(process.env.PORT) || 5173, strictPort: true },
}))
