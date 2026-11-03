// Vite's `?inline` import: the stylesheet's text, not a <link> or a side effect.
declare module '*.css?inline' {
  const css: string
  export default css
}

// Vite's `?raw` import: the file's text, as the logo SVG.
declare module '*.svg?raw' {
  const text: string
  export default text
}
