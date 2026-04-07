import presetWind3 from '@unocss/preset-wind3'
import { defineConfig } from 'unocss'

export default defineConfig({
  presets: [presetWind3()],
  // rem → px，让 Taro pxtransform 统一处理
  postprocess: (util) => {
    util.entries.forEach((entry) => {
      const val = entry[1]
      if (typeof val === 'string' && /^-?[\d.]+rem$/.test(val)) {
        entry[1] = `${parseFloat(val) * 16}px`
      }
    })
  },
  // 仅扫描 src 下的文件
  content: {
    filesystem: ['src/**/*.{tsx,ts,jsx,js}'],
  },
})
