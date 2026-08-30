/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx}'],
  theme: {
    extend: {
      /* 颜色全部代理到 tokens.css 的 --c-* CSS 变量（RGB 三元组）。
       * 于是明暗主题只需换变量，组件里不写任何 dark: 变体。 */
      colors: {
        bg: 'rgb(var(--c-bg) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--c-surface) / <alpha-value>)',
          2: 'rgb(var(--c-surface-2) / <alpha-value>)',
          3: 'rgb(var(--c-surface-3) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--c-border) / <alpha-value>)',
          strong: 'rgb(var(--c-border-strong) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--c-text) / <alpha-value>)',
          2: 'rgb(var(--c-text-2) / <alpha-value>)',
          3: 'rgb(var(--c-text-3) / <alpha-value>)',
        },
        up: 'rgb(var(--c-up) / <alpha-value>)',
        down: 'rgb(var(--c-down) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          hover: 'rgb(var(--c-accent-hover) / <alpha-value>)',
        },
        warn: 'rgb(var(--c-warn) / <alpha-value>)',
        info: 'rgb(var(--c-info) / <alpha-value>)',
      },

      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },

      /* 终端排版刻度：小字号 + 紧凑行高，[字号, 行高] */
      fontSize: {
        '2xs': ['10px', '14px'],
        xs: ['11px', '16px'],
        sm: ['12px', '18px'],
        base: ['13px', '20px'],
        md: ['14px', '20px'],
        lg: ['16px', '22px'],
        xl: ['20px', '26px'],
        '2xl': ['24px', '30px'],
        '3xl': ['32px', '36px'],
        '4xl': ['40px', '44px'],
      },

      /* 终端用小圆角 */
      borderRadius: {
        sm: '3px',
        DEFAULT: '4px',
        md: '5px',
        lg: '6px',
        xl: '8px',
      },

      /* 让无颜色修饰的 border 默认取我们的发丝线色 */
      borderColor: {
        DEFAULT: 'rgb(var(--c-border) / <alpha-value>)',
      },

      spacing: {
        sidebar: 'var(--sidebar-width)',
        topbar: 'var(--topbar-height)',
      },

      maxWidth: {
        content: 'var(--content-max-width)',
      },

      zIndex: {
        base: '0',
        sticky: '40',
        sidebar: '200',
        overlay: '150',
        drawer: '60',
        tooltip: '400',
        loader: '9999',
      },

      /* 单一缓动 + 三档时长 */
      transitionDuration: {
        1: 'var(--dur-1)',
        2: 'var(--dur-2)',
        3: 'var(--dur-3)',
      },
      transitionTimingFunction: {
        terminal: 'cubic-bezier(0.2, 0, 0, 1)',
      },

      // keyframes 定义在 global.css（保证一定被输出，不依赖 Tailwind 的
      // usage-based 剪枝，.stagger 与 .animate-* 都能引用到）。
      animation: {
        // 延迟直接写进 shorthand，可用内联 --stagger 做交错。
        enter: 'enter var(--dur-2) var(--ease) var(--stagger, 0ms) both',
        shimmer: 'shimmer 1.4s infinite',
        'flash-up': 'flash-up 600ms var(--ease)',
        'flash-down': 'flash-down 600ms var(--ease)',
      },
    },
  },
  plugins: [],
}
