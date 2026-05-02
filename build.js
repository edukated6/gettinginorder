#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');
const CSS_SOURCE = path.join(PUBLIC_DIR, 'app.css');
const CSS_MIN = path.join(PUBLIC_DIR, 'app.min.css');

console.log('🔨 Building nORDER PWA...\n');

// Minify CSS using csso
if (fs.existsSync(CSS_SOURCE)) {
  try {
    console.log('📦 Minifying CSS...');
    const csso = require('csso');
    const css = fs.readFileSync(CSS_SOURCE, 'utf8');
    const minified = csso.minify(css).css;
    fs.writeFileSync(CSS_MIN, minified);
    const originalSize = (fs.statSync(CSS_SOURCE).size / 1024).toFixed(2);
    const minSize = (fs.statSync(CSS_MIN).size / 1024).toFixed(2);
    const savings = ((1 - minSize/originalSize) * 100).toFixed(1);
    console.log(`   ✓ app.css: ${originalSize}KB → ${minSize}KB (${savings}% smaller)\n`);
  } catch (err) {
    console.error('❌ CSS minification failed:', err.message);
    process.exit(1);
  }
}

console.log('✅ Build complete!\n');
console.log('📝 Minified CSS file:');
console.log('   public/app.min.css\n');
console.log('💡 For JS minification, manually minify each .js file using:');
console.log('   npx terser public/app.js -o public/app.min.js -c -m\n');
console.log('⚠️  Note: Do NOT bundle ES modules. Minify in place only.\n');


