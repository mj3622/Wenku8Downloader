import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'src/main/epub-integration.test.ts',
      'src/main/epub-merge-validate.test.ts',
    ],
  },
})
