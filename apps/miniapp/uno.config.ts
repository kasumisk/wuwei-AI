import presetWind3 from '@unocss/preset-wind3'
import { defineConfig } from 'unocss'

// 微信小程序 class 名不支持的特殊字符需要转义
const charMap: Record<string, string> = {
  ':': '-cl-',
  '[': '-bl-',
  ']': '-br-',
  '/': '-sl-',
  '%': '-pc-',
  '!': '-im-',
  '#': '-ha-',
  '(': '-lp-',
  ')': '-rp-',
  '.': '-dt-',
  ',': '-cm-',
  '>': '-gt-',
  '+': '-pl-',
  '~': '-tl-',
}

const escapeRE = /[:\[\]/%!#().,>+~]/g

function escapeSelector(selector: string): string {
  return selector.replace(escapeRE, (c) => charMap[c] || c)
}

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
    // 转义小程序不支持的选择器字符
    util.selector = escapeSelector(util.selector)
  },
  // 仅扫描 src 下的文件
  content: {
    filesystem: ['src/**/*.{tsx,ts,jsx,js}'],
  },
})
