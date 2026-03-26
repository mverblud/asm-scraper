// src/scraper/ApiClient.ts
// Cliente HTTP directo al endpoint AJAX de JetSmartFilters.
// Usa fetch nativo de Node.js y cheerio para parsear HTML, sin depender del browser.
// Paraleliza la obtención de múltiples páginas para búsquedas con muchos resultados.

import * as cheerio from 'cheerio';
import { SessionManager } from './SessionManager';
import { config } from '../config';
import { logger } from '../utils/logger';
import { Product, Pagination, SearchFilters, SearchResult } from '../types';

const MODULE = 'ApiClient';

const AJAX_URL = `${config.baseUrl}/wp-admin/admin-ajax.php`;

// Máximo de páginas a fetchear en paralelo
const PAGE_CONCURRENCY = 10;

// Productos por página en el request AJAX (más = menos roundtrips)
const POSTS_PER_PAGE = 100;

// Parámetros fijos que JetSmartFilters envía siempre
const FIXED_DEFAULTS: Record<string, string> = {
  'defaults[post_status][]': 'publish',
  'defaults[post_type]': 'product',
  'defaults[posts_per_page]': String(POSTS_PER_PAGE),
  'defaults[ignore_sticky_posts]': '1',
  'defaults[order]': 'ASC',
  'defaults[orderby]': 'meta_value',
  'defaults[meta_key]': '_stock_status',
  'defaults[wc_query]': 'product_query',
};

const FIXED_SETTINGS: Record<string, string> = {
  'settings[lisitng_id]': '1798',
  'settings[columns]': '1',
  'settings[columns_tablet]': '',
  'settings[columns_mobile]': '',
  'settings[column_min_width]': '240',
  'settings[column_min_width_tablet]': '',
  'settings[column_min_width_mobile]': '',
  'settings[inline_columns_css]': 'false',
  'settings[post_status][]': 'publish',
  'settings[use_random_posts_num]': '',
  'settings[posts_num]': String(POSTS_PER_PAGE),
  'settings[max_posts_num]': '9',
  'settings[not_found_message]':
    'No se encontraron productos que coincidan con tu búsqueda, borrá los filtros e intentalo nuevamente',
  'settings[is_masonry]': '',
  'settings[equal_columns_height]': '',
  'settings[use_load_more]': '',
  'settings[load_more_id]': '',
  'settings[load_more_type]': 'click',
  'settings[load_more_offset][unit]': 'px',
  'settings[load_more_offset][size]': '0',
  'settings[loader_text]': '',
  'settings[loader_spinner]': '',
  'settings[use_custom_post_types]': '',
  'settings[custom_post_types]': '',
  'settings[hide_widget_if]': '',
  'settings[carousel_enabled]': '',
  'settings[slides_to_scroll]': '1',
  'settings[arrows]': 'true',
  'settings[arrow_icon]': 'fa fa-angle-left',
  'settings[dots]': '',
  'settings[autoplay]': 'true',
  'settings[pause_on_hover]': 'true',
  'settings[autoplay_speed]': '5000',
  'settings[infinite]': 'true',
  'settings[center_mode]': '',
  'settings[effect]': 'slide',
  'settings[speed]': '500',
  'settings[inject_alternative_items]': '',
  'settings[scroll_slider_enabled]': '',
  'settings[scroll_slider_on][]': 'desktop',
  'settings[custom_query]': '',
  'settings[custom_query_id]': '',
  'settings[_element_id]': 'lista-productos',
  'settings[collapse_first_last_gap]': '',
  'settings[list_items_wrapper_tag]': 'div',
  'settings[list_item_tag]': 'div',
  'settings[empty_items_wrapper_tag]': 'div',
  'settings[list_tags_selection]': '',
};

interface FilterMap {
  [label: string]: string; // label → taxonomy term ID
}

export class ApiClient {
  private filterMaps: Record<string, FilterMap> | null = null;
  private lastFoundPosts = 0;
  private lastMaxPages = 0;

  constructor(private session: SessionManager) {}

  // ── Cargar mapas de filtros del DOM (una sola vez) ───────
  async loadFilterMaps(): Promise<void> {
    if (this.filterMaps) return;

    logger.debug(MODULE, 'Cargando mapas de filtros del DOM...');

    this.filterMaps = await this.session.page.evaluate(() => {
      const maps: Record<string, Record<string, string>> = {};
      const selects = document.querySelectorAll('[data-query-var] select');
      selects.forEach((sel) => {
        const parent = sel.closest('[data-query-var]');
        const queryVar = parent?.getAttribute('data-query-var');
        if (!queryVar) return;

        const optMap: Record<string, string> = {};
        sel.querySelectorAll('option').forEach((opt: HTMLOptionElement) => {
          const label = opt.textContent?.trim();
          if (label && opt.value) {
            optMap[label] = opt.value;
          }
        });
        maps[queryVar] = optMap;
      });
      return maps;
    });

    logger.debug(MODULE, 'Mapas de filtros cargados', {
      keys: Object.keys(this.filterMaps ?? {}),
    });
  }

  // ── Construir body del POST ──────────────────────────────
  private buildRequestBody(filters: Omit<SearchFilters, 'allPages'>, page: number): string {
    const params = new URLSearchParams();

    params.append('action', 'jet_smart_filters');
    params.append('provider', 'jet-engine/lista-productos');

    // Query params dinámicos según filtros
    if (filters.q) {
      params.append('query[__s_query|search]', filters.q);
    }
    if (filters.sku) {
      params.append('query[__s_query|search]', filters.sku);
    }
    if (filters.categoria && this.filterMaps?.product_cat) {
      const termId = this.filterMaps.product_cat[filters.categoria];
      if (termId) {
        params.append('query[_tax_query_product_cat]', termId);
        logger.debug(MODULE, `Filtro categoría: "${filters.categoria}" → termId ${termId}`);
      } else {
        logger.warn(MODULE, `Categoría "${filters.categoria}" no encontrada en filterMaps. Opciones disponibles: ${Object.keys(this.filterMaps.product_cat).join(', ')}`);
      }
    }
    if (filters.marca && this.filterMaps?.['pa_marca-vehiculo']) {
      const termId = this.filterMaps['pa_marca-vehiculo'][filters.marca];
      if (termId) {
        params.append('query[_tax_query_pa_marca-vehiculo]', termId);
        logger.debug(MODULE, `Filtro marca: "${filters.marca}" → termId ${termId}`);
      } else {
        logger.warn(MODULE, `Marca "${filters.marca}" no encontrada en filterMaps. Opciones disponibles: ${Object.keys(this.filterMaps['pa_marca-vehiculo']).join(', ')}`);
      }
    }


    // Defaults
    for (const [key, value] of Object.entries(FIXED_DEFAULTS)) {
      if (key === 'defaults[paged]') continue;
      params.append(key, value);
    }
    params.append('defaults[paged]', String(page));

    // Settings
    for (const [key, value] of Object.entries(FIXED_SETTINGS)) {
      params.append(key, value);
    }
    // Extra scroll_slider_on values
    params.append('settings[scroll_slider_on][]', 'tablet');
    params.append('settings[scroll_slider_on][]', 'mobile');

    return params.toString();
  }

  // ── Parsear HTML response con cheerio (sin browser) ──────
  private parseHtmlProducts(html: string): Product[] {
    const $ = cheerio.load(html);
    const products: Product[] = [];
    const seen = new Set<string>();

    $('.jet-listing-grid__item').each((_, el) => {
      const card = $(el);
      const h2 = card.find('h2');
      if (!h2.length) return;
      const title = h2.text().trim();
      if (!title || seen.has(title)) return;

      const titleLink = h2.find('a');
      const url = titleLink.attr('href') ?? null;

      // Imagen del producto
      const img = card.find('img').first();
      const imagen = img.attr('data-src') || img.attr('src') || null;

      const vehiculo = card.find('p').first().text().trim() || null;

      let stock: number | null = null;
      let precio: string | null = null;
      let codigo: string | null = null;
      let marca: string | null = null;

      card.find('.elementor-widget-container').each((_, widget) => {
        const text = $(widget).text().trim();
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

      const sku =
        codigo ||
        (url ? (url.split('/producto/')[1]?.replace(/\//g, '').toUpperCase() ?? null) : null);

      const addToCartLink = card.find('a[href*="add-to-cart"]');
      const cartMatch = addToCartLink.attr('href')?.match(/add-to-cart=(\d+)/);
      const id = cartMatch ? cartMatch[1] : null;

      seen.add(title);
      products.push({ id, titulo: title, sku, vehiculo, marca, stock, precio, url, imagen });
    });

    return products;
  }

  // ── Hacer request AJAX con fetch nativo de Node.js ──────
  private async fetchPage(
    filters: Omit<SearchFilters, 'allPages'>,
    page: number,
  ): Promise<{ products: Product[]; pagination: Pagination }> {
    const cookies = await this.session.getCookies();
    const body = this.buildRequestBody(filters, page);
    const t0 = Date.now();

    logger.debug(MODULE, `Fetch AJAX página ${page}`);

    const res = await fetch(AJAX_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': cookies,
      },
      body,
    });

    if (!res.ok) {
      throw new Error(`AJAX request falló: HTTP ${res.status}`);
    }

    const json = await res.json() as {
      content?: string;
      data?: { html?: string };
      pagination?: { found_posts?: number; max_num_pages?: number; page?: number };
    };

    const html = json.content || json.data?.html || '';
    const paginationResponse = json.pagination;

    if (paginationResponse) {
      this.lastFoundPosts = paginationResponse.found_posts ?? this.lastFoundPosts;
      this.lastMaxPages = paginationResponse.max_num_pages ?? this.lastMaxPages;
    }

    const products = this.parseHtmlProducts(html);

    const pagination: Pagination = {
      currentPage: paginationResponse?.page ?? page,
      totalPages: paginationResponse?.max_num_pages ?? (this.lastMaxPages || 1),
    };

    logger.debug(MODULE, `Página ${page} obtenida: ${products.length} productos en ${Date.now() - t0}ms`);

    return { products, pagination };
  }

  // ── Fetch múltiples páginas en paralelo con concurrencia ──
  private async fetchPagesParallel(
    filters: Omit<SearchFilters, 'allPages'>,
    startPage: number,
    endPage: number,
  ): Promise<Product[]> {
    const pages = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);
    const allProducts: Product[] = [];

    for (let i = 0; i < pages.length; i += PAGE_CONCURRENCY) {
      const batch = pages.slice(i, i + PAGE_CONCURRENCY);
      logger.debug(MODULE, `Fetch paralelo páginas [${batch.join(', ')}]`);

      const results = await Promise.all(
        batch.map((p) => this.fetchPage(filters, p)),
      );

      for (const { products } of results) {
        allProducts.push(...products);
      }
    }

    return allProducts;
  }

  // ── Búsqueda principal via API ───────────────────────────
  async search(filters: SearchFilters = {}): Promise<SearchResult> {
    const { allPages, ...rest } = filters;
    const t0 = Date.now();

    logger.info(MODULE, 'Ejecutando búsqueda via AJAX', rest);

    // Solo cargar mapas de filtros si se necesitan (evita page.evaluate innecesario)
    const needsFilterMaps = !!(rest.categoria || rest.marca);
    if (needsFilterMaps) {
      await this.loadFilterMaps();
    }

    const { products, pagination } = await this.fetchPage(rest, 1);

    logger.info(MODULE, `Página ${pagination.currentPage}/${pagination.totalPages} - ${products.length} productos`);

    if (allPages && pagination.totalPages > 1) {
      const remainingProducts = await this.fetchPagesParallel(rest, 2, pagination.totalPages);
      products.push(...remainingProducts);

      // Deduplicar
      const seen = new Set<string>();
      const deduped = products.filter((p) => {
        if (seen.has(p.titulo)) return false;
        seen.add(p.titulo);
        return true;
      });

      const elapsed = Date.now() - t0;
      logger.info(MODULE, `Búsqueda AJAX completa: ${deduped.length} productos, ${pagination.totalPages} páginas en ${elapsed}ms`);

      return {
        success: true,
        filtros: rest,
        paginacion: { paginasRecorridas: pagination.totalPages, total: pagination.totalPages },
        totalProductos: deduped.length,
        productos: deduped,
      };
    }

    const elapsed = Date.now() - t0;
    logger.info(MODULE, `Búsqueda AJAX completa: ${products.length} productos, 1 página en ${elapsed}ms`);

    return {
      success: true,
      filtros: rest,
      paginacion: pagination,
      totalProductos: products.length,
      productos: products,
    };
  }
}
