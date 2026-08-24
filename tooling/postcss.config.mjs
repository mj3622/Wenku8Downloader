import autoprefixer from 'autoprefixer'
import { fileURLToPath, URL } from 'url'
import tailwindcss from 'tailwindcss'

const tailwindConfigPath = fileURLToPath(new URL('./tailwind.config.js', import.meta.url))

export default {
  plugins: [
    tailwindcss(tailwindConfigPath),
    autoprefixer(),
  ],
}
