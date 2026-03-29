const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function main() {
  const root = process.cwd();
  const baseUrl = process.env.ASM_BASE_URL || 'https://autopartessanmartin.com.ar';
  const shopUrl = process.env.ASM_SHOP_URL || `${baseUrl}/tienda/`;
  const storagePath = path.resolve(root, '.session-state.json');

  const browser = await chromium.launch({ headless: true });
  let context;

  if (fs.existsSync(storagePath)) {
    context = await browser.newContext({ storageState: storagePath });
  } else {
    context = await browser.newContext();
  }

  const page = await context.newPage();
  await page.goto(shopUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-query-var="product_cat"] select option').length > 1,
    { timeout: 20000 }
  );

  const categorias = await page.evaluate(() => {
    const out = [];
    const options = document.querySelectorAll('[data-query-var="product_cat"] select option');

    options.forEach((opt) => {
      const id = (opt.getAttribute('value') || '').trim();
      const nombre = (opt.textContent || '').trim();
      if (!id || !nombre) return;
      if (id === '0') return;
      if (nombre.toLowerCase().includes('categor')) return;
      out.push({ id, nombre });
    });

    return out;
  });

  const unique = Array.from(new Map(categorias.map((c) => [`${c.id}|${c.nombre}`, c])).values());
  unique.sort((a, b) => Number(a.id) - Number(b.id));

  const outPath = path.resolve(root, 'src/analyzer/categories.json');
  fs.writeFileSync(outPath, JSON.stringify(unique, null, 2) + '\n', 'utf8');

  console.log(`OK ${unique.length} categorias -> ${outPath}`);

  await context.close();
  await browser.close();
}

main().catch((err) => {
  console.error('ERROR exporting categories:', err);
  process.exit(1);
});
