// src/scraper/ProductScraper.ts
import { Page } from 'playwright';
import { SessionManager } from './SessionManager';
import { config } from '../config';
import { logger } from '../utils/logger';
import { Product, Pagination, SearchFilters, SearchResult } from '../types';

const MODULE = 'ProductScraper';

export class ProductScraper {
  constructor(private session: SessionManager) {}

  private get page(): Page {
    return this.session.page;
  }

  // ── Esperar a que el grid se actualice ───────────────────
  private async waitForGridUpdate(): Promise<void> {
    try {
      // Esperar la respuesta AJAX del filtro (más preciso que networkidle)
      await this.page.waitForResponse(
        (res) => res.url().includes('admin-ajax.php') && res.status() === 200,
        { timeout: config.requestTimeout },
      );
    } catch {
      logger.warn(MODULE, 'waitForResponse timeout, esperando selector...');
    }

    // Esperar a que el grid exista
    try {
      await this.page.waitForSelector('.jet-listing-grid__items', { timeout: 10000 });
    } catch {
      logger.warn(MODULE, 'Grid selector no encontrado en timeout');
    }
  }

  // ── Navegar a la tienda y aplicar filtros ────────────────
  private async navigateAndFilter(filters: Omit<SearchFilters, 'allPages'>, page = 1): Promise<void> {
    const params = new URLSearchParams();
    if (page > 1) params.append('paged', String(page));
    const qs = params.toString();
    const url = `${config.shopUrl}${qs ? '?' + qs : ''}`;

    logger.debug(MODULE, `Navegando a ${url}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.requestTimeout });

    // Esperar a que el grid esté presente después de navegar
    try {
      await this.page.waitForSelector('.jet-listing-grid__items', { timeout: 10000 });
    } catch {
      logger.warn(MODULE, 'Grid no encontrado post-navegación');
    }

    // Búsqueda por texto libre
    if (filters.q) {
      logger.debug(MODULE, `Buscando: "${filters.q}"`);
      const searchBox = this.page.getByRole('searchbox', { name: 'Busqueda avanzada' });
      await searchBox.fill(filters.q);
      await this.page.locator('.jet-search-filter[data-query-var="query"] button.jet-search-filter__submit').click();
      await this.waitForGridUpdate();
    }

    // Búsqueda por SKU
    if (filters.sku) {
      logger.debug(MODULE, `Buscando SKU: "${filters.sku}"`);
      const skuBox = this.page.getByRole('searchbox', { name: 'Busqueda por SKU' });
      await skuBox.fill(filters.sku);
      await this.page.locator('.jet-search-filter[data-query-var="codigo-producto"] button.jet-search-filter__submit').click();
      await this.waitForGridUpdate();
    }

    // Filtros select: categoría (índice 0), marca (índice 1)
    const selectFilters: Array<{ index: number; value: string }> = [];
    if (filters.categoria) selectFilters.push({ index: 0, value: filters.categoria });
    if (filters.marca) selectFilters.push({ index: 1, value: filters.marca });

    const allSelects = this.page.getByRole('combobox', { name: 'Filtros tipo select' });

    for (const { index, value } of selectFilters) {
      const select = allSelects.nth(index);
      if ((await select.count()) > 0) {
        logger.debug(MODULE, `Aplicando filtro select[${index}] = "${value}"`);
        await select.selectOption({ label: value });
        await this.waitForGridUpdate();
      }
    }
  }

  // ── Extraer productos del grid actual ────────────────────
  async parseProducts(): Promise<Product[]> {
    return this.page.evaluate(() => {
      const products: Array<{
        id: string | null;
        titulo: string;
        sku: string | null;
        vehiculo: string | null;
        marca: string | null;
        stock: number | null;
        precio: string | null;
        url: string | null;
        imagen: string | null;
      }> = [];
      const seen = new Set<string>();

      const cards = document.querySelectorAll('.jet-listing-grid__item');
      cards.forEach((card) => {
        const h2 = card.querySelector('h2');
        if (!h2) return;
        const title = h2.textContent?.trim() ?? '';
        if (!title || seen.has(title)) return;

        const titleLink = h2.querySelector('a') as HTMLAnchorElement | null;
        const url = titleLink?.href ?? null;

        // Imagen del producto
        const img = card.querySelector('img') as HTMLImageElement | null;
        const imagen = img?.dataset?.src || img?.src || null;

        // Vehículo: primer <p> dentro de la card
        const vehiculo = card.querySelector('p')?.textContent?.trim() || null;

        let stock: number | null = null;
        let precio: string | null = null;
        let codigo: string | null = null;
        let marca: string | null = null;

        card.querySelectorAll('.elementor-widget-container').forEach((widget) => {
          const text = widget.textContent?.trim() ?? '';
          if (text.startsWith('Stock:')) {
            const match = text.match(/(\d+)/);
            stock = match ? parseInt(match[1], 10) : 0;
          }
          if (text.includes('Precio de lista:')) {
            const priceText = text.replace('Precio de lista:', '').trim();
            precio = priceText.replace(/[^0-9.,]/g, '').trim() || null;
          }
          if (text.startsWith('Cod:')) {
            codigo = text.replace('Cod:', '').trim() || null;
          }
          if (text.startsWith('Marca:')) {
            marca = text.replace('Marca:', '').trim() || null;
          }
        });

        // Fallback SKU desde slug de URL
        const sku =
          codigo ||
          (url ? (url.split('/producto/')[1]?.replace(/\//g, '').toUpperCase() ?? null) : null);

        // ID del producto desde add-to-cart link
        const addToCartLink = card.querySelector('a[href*="add-to-cart"]') as HTMLAnchorElement | null;
        const cartMatch = addToCartLink?.href?.match(/add-to-cart=(\d+)/);
        const id = cartMatch ? cartMatch[1] : null;

        seen.add(title);
        products.push({ id, titulo: title, sku, vehiculo, marca, stock, precio, url, imagen });
      });

      return products;
    });
  }

  // ── Extraer paginación del DOM ───────────────────────────
  private async parsePagination(): Promise<Pagination> {
    return this.page.evaluate(() => {
      // Usar data-page y data-pages del grid (más fiable)
      const grid = document.querySelector('.jet-listing-grid__items');
      if (grid) {
        const currentPage = parseInt(grid.getAttribute('data-page') ?? '1', 10) || 1;
        const totalPages = parseInt(grid.getAttribute('data-pages') ?? '1', 10) || 1;
        return { currentPage, totalPages };
      }

      // Fallback: paginación por DOM
      const currentEl = document.querySelector('.jet-filters-pagination__current');
      const currentPage = parseInt(currentEl?.getAttribute('data-value') ?? '1', 10) || 1;

      const items = document.querySelectorAll('.jet-filters-pagination__item');
      let totalPages = currentPage;
      items.forEach((el) => {
        const val = parseInt(el.getAttribute('data-value') ?? '', 10);
        if (!isNaN(val) && val > totalPages) totalPages = val;
      });

      return { currentPage, totalPages };
    });
  }

  // ── Búsqueda principal ───────────────────────────────────
  async search(filters: SearchFilters = {}): Promise<SearchResult> {
    const { allPages, ...rest } = filters;
    const t0 = Date.now();

    logger.info(MODULE, 'Ejecutando búsqueda DOM', rest);
    await this.navigateAndFilter(rest);

    const products = await this.parseProducts();
    const pagination = await this.parsePagination();

    logger.info(MODULE, `Página ${pagination.currentPage}/${pagination.totalPages} - ${products.length} productos`);

    if (allPages && pagination.totalPages > 1) {
      for (let p = 2; p <= pagination.totalPages; p++) {
        logger.debug(MODULE, `Navegando a página ${p}/${pagination.totalPages}`);
        await this.navigateAndFilter(rest, p);
        const pageProducts = await this.parseProducts();
        products.push(...pageProducts);
      }

      // Deduplicar por título
      const deduped = this.deduplicateProducts(products);

      const elapsed = Date.now() - t0;
      logger.info(MODULE, `Búsqueda DOM completa: ${deduped.length} productos, ${pagination.totalPages} páginas en ${elapsed}ms`);

      return {
        success: true,
        filtros: rest,
        paginacion: { paginasRecorridas: pagination.totalPages, total: pagination.totalPages },
        totalProductos: deduped.length,
        productos: deduped,
      };
    }

    const elapsed = Date.now() - t0;
    logger.info(MODULE, `Búsqueda DOM completa: ${products.length} productos, 1 página en ${elapsed}ms`);

    return {
      success: true,
      filtros: rest,
      paginacion: pagination,
      totalProductos: products.length,
      productos: products,
    };
  }

  private deduplicateProducts(products: Product[]): Product[] {
    const seen = new Set<string>();
    return products.filter((p) => {
      const key = p.titulo;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
