# Build & Optimization Guide

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Build (Minify Assets)
```bash
npm run build
```

This generates:
- `public/app.min.css` (minified CSS)
- `public/app.min.js` (minified JavaScript)

### 3. Deploy Minified Version
After running the build, manually update the HTML files to use minified assets:

**In `index.html` and `public/index.html`:**

```html
<!-- Change from: -->
<link rel="stylesheet" href="./app.css?v=20260501f" />

<!-- To: -->
<link rel="stylesheet" href="./app.min.css" />
```

```html
<!-- Change from: -->
import("./app.js?v=20260501g")

<!-- To: -->
import("./app.min.js")
```

### 4. Start Server
```bash
npm start
```
This runs `http-server public -p 8080`

---

## What the Build Does

- **CSS Minification**: Uses `csso` to remove whitespace, unused selectors, and compress values
- **JS Minification**: Uses `esbuild` to bundle, tree-shake, and minify your JavaScript
- **Size Reduction**: Typically 40-60% smaller files

## Development vs Production

- **Development**: Run with unminified assets (`app.css`, `app.js`) for easier debugging
- **Production**: Run `npm run build`, then update HTML to use `.min` files

## Lighthouse Improvements After Build

After using minified assets, Lighthouse should show:
- ✅ **Minify CSS** — Fixed
- ✅ **Minify JavaScript** — Fixed  
- ✅ **Reduce unused CSS** — Improved (csso removes unused rules)
- ✅ **Reduce JavaScript execution time** — Improved (smaller files = faster parse)

## Optional: Auto-Update HTML

If you want the build script to automatically update HTML files, edit `build.js` and uncomment the production mode section, then run:

```bash
NODE_ENV=production npm run build
```

---

## Troubleshooting

**"Module not found: esbuild"**
→ Run `npm install` again

**Build takes too long**
→ This is normal for the first run; esbuild caches results

**Minified JS has errors**
→ Check browser console; report the error and we can adjust esbuild settings

---

## Firebase Hosting

The minified files are automatically covered by the `firebase.json` no-cache headers:

```json
"headers": [
  {
    "source": "**/*.js",
    "headers": [{"key": "Cache-Control", "value": "no-cache, no-store, must-revalidate"}]
  }
]
```

So users always get the latest version on deploy.
