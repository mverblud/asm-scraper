// src/scraper/ApiClient.ts
// Cliente HTTP directo al endpoint AJAX de JetSmartFilters.
// Hace POST a admin-ajax.php con las cookies de sesión, evitando navegar con Playwright.
// La respuesta es HTML renderizado del grid, que se parsea igual que el DOM.

import { SessionManager } from './SessionManager';
import { config } from '../config';
import { logger } from '../utils/logger';
import { Product, Pagination, SearchFilters, SearchResult } from '../types';

const MODULE = 'ApiClient';

const AJAX_URL = `${config.baseUrl}/wp-admin/admin-ajax.php`;

// Parámetros fijos que JetSmartFilters envía siempre
const FIXED_DEFAULTS: Record<string, string> = {
  'defaults[post_status][]': 'publish',
  'defaults[post_type]': 'product',
  'defaults[posts_per_page]': '12',
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
  'settings[posts_num]': '12',
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
      if (termId) params.append('query[_tax_query_product_cat]', termId);
    }
    if (filters.marca && this.filterMaps?.['pa_marca-vehiculo']) {
      const termId = this.filterMaps['pa_marca-vehiculo'][filters.marca];
      if (termId) params.append('query[_tax_query_pa_marca-vehiculo]', termId);
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

  // ── Parsear HTML response ────────────────────────────────
  private async parseHtmlProducts(html: string): Promise<Product[]> {
    // Usamos page.evaluate para parsear el HTML con el DOM del browser
    // Esto es más fiable que un parser externo
    return this.session.page.evaluate((htmlStr: string) => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlStr, 'text/html');

      const products: Array<{
        id: string | null;
        titulo: string;
        sku: string | null;
        vehiculo: string | null;
        marca: string | null;
        stock: number | null;
        precio: string | null;
        url: string | null;
      }> = [];
      const seen = new Set<string>();

      const cards = doc.querySelectorAll('.jet-listing-grid__item');
      cards.forEach((card) => {
        const h2 = card.querySelector('h2');
        if (!h2) return;
        const title = h2.textContent?.trim() ?? '';
        if (!title || seen.has(title)) return;

        const titleLink = h2.querySelector('a') as HTMLAnchorElement | null;
        const url = titleLink?.getAttribute('href') ?? null;

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

        const sku =
          codigo ||
          (url ? (url.split('/producto/')[1]?.replace(/\//g, '').toUpperCase() ?? null) : null);

        const addToCartLink = card.querySelector('a[href*="add-to-cart"]') as HTMLAnchorElement | null;
        const cartMatch = addToCartLink?.getAttribute('href')?.match(/add-to-cart=(\d+)/);
        const id = cartMatch ? cartMatch[1] : null;

        seen.add(title);
        products.push({ id, titulo: title, sku, vehiculo, marca, stock, precio, url });
      });

      return products;
    }, html);
  }

  // ── Hacer request AJAX ───────────────────────────────────
  private async fetchPage(
    filters: Omit<SearchFilters, 'allPages'>,
    page: number,
  ): Promise<{ products: Product[]; pagination: Pagination }> {
    const cookies = await this.session.getCookies();
    const body = this.buildRequestBody(filters, page);

    logger.debug(MODULE, `Fetch AJAX página ${page}`);

    // Usamos page.evaluate para hacer el fetch con las cookies del contexto del browser
    const response = await this.session.page.evaluate(
      async (args: { url: string; body: string }) => {
        const res = await fetch(args.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: args.body,
          credentials: 'same-origin',
        });

        if (!res.ok) return { error: `HTTP ${res.status}`, html: '', pagination: null };

        const json = await res.json();
        return {
          html: json.content || json.data?.html || '',
          pagination: json.pagination || null,
        };
      },
      { url: AJAX_URL, body },
    );

    if ('error' in response && response.error) {
      throw new Error(`AJAX request falló: ${response.error}`);
    }

    const html = (response as { html: string }).html;
    const paginationResponse = (response as { pagination?: { found_posts?: number; max_num_pages?: number; page?: number } }).pagination;

    if (paginationResponse) {
      this.lastFoundPosts = paginationResponse.found_posts ?? this.lastFoundPosts;
      this.lastMaxPages = paginationResponse.max_num_pages ?? this.lastMaxPages;
    }

    const products = await this.parseHtmlProducts(html);

    const pagination: Pagination = {
      currentPage: paginationResponse?.page ?? page,
      totalPages: paginationResponse?.max_num_pages ?? (this.lastMaxPages || 1),
    };

    return { products, pagination };
  }

  // ── Búsqueda principal via API ───────────────────────────
  async search(filters: SearchFilters = {}): Promise<SearchResult> {
    const { allPages, ...rest } = filters;

    logger.info(MODULE, 'Ejecutando búsqueda via AJAX', rest);

    await this.loadFilterMaps();

    const { products, pagination } = await this.fetchPage(rest, 1);

    logger.info(MODULE, `Página ${pagination.currentPage}/${pagination.totalPages} - ${products.length} productos`);

    if (allPages && pagination.totalPages > 1) {
      for (let p = 2; p <= pagination.totalPages; p++) {
        logger.debug(MODULE, `Fetch AJAX página ${p}/${pagination.totalPages}`);
        const { products: pageProducts } = await this.fetchPage(rest, p);
        products.push(...pageProducts);
      }

      // Deduplicar
      const seen = new Set<string>();
      const deduped = products.filter((p) => {
        if (seen.has(p.titulo)) return false;
        seen.add(p.titulo);
        return true;
      });

      return {
        success: true,
        filtros: rest,
        paginacion: { paginasRecorridas: pagination.totalPages, total: pagination.totalPages },
        totalProductos: deduped.length,
        productos: deduped,
      };
    }

    return {
      success: true,
      filtros: rest,
      paginacion: pagination,
      totalProductos: products.length,
      productos: products,
    };
  }
}
