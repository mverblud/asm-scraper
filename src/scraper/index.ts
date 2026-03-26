// src/scraper/index.ts
// Fachada unificada del scraper. Decide si usar ApiClient (AJAX directo) o ProductScraper (DOM).

import { SessionManager } from './SessionManager';
import { ProductScraper } from './ProductScraper';
import { ApiClient } from './ApiClient';
import { logger } from '../utils/logger';
import { SearchFilters, SearchResult, Product, NormalizedProduct } from '../types';

const MODULE = 'Scraper';

export class Scraper {
  private session: SessionManager;
  private productScraper: ProductScraper;
  private apiClient: ApiClient;
  private mutex = false;

  constructor() {
    this.session = new SessionManager();
    this.productScraper = new ProductScraper(this.session);
    this.apiClient = new ApiClient(this.session);
  }

  // ── Inicialización (login) ───────────────────────────────
  async init(): Promise<void> {
    await this.session.login();
  }

  // ── Estado ───────────────────────────────────────────────
  isLoggedIn(): boolean {
    return this.session.isLoggedIn();
  }

  getSessionManager(): SessionManager {
    return this.session;
  }

  // ── Mutex simple para evitar race conditions ─────────────
  private async acquireLock(): Promise<void> {
    while (this.mutex) {
      await new Promise((r) => setTimeout(r, 100));
    }
    this.mutex = true;
  }

  private releaseLock(): void {
    this.mutex = false;
  }

  // ── Búsqueda principal ───────────────────────────────────
  async search(filters: SearchFilters = {}): Promise<SearchResult> {
    await this.acquireLock();
    const t0 = Date.now();
    try {
      await this.session.ensureLoggedIn();

      const hasSearch = !!(filters.q || filters.sku);
      const hasSelectFilters = !!(filters.categoria || filters.marca);

      // Filtros combinados (búsqueda + selects) requieren interacción secuencial en el DOM:
      // primero buscar, esperar resultados, luego aplicar select filters.
      // El ApiClient envía todo en un solo POST y el sitio no filtra correctamente.
      if (hasSearch && hasSelectFilters) {
        logger.info(MODULE, 'Filtros combinados detectados → usando DOM scraper (interacción secuencial)');
        const result = await this.productScraper.search(filters);
        const elapsed = Date.now() - t0;
        logger.info(MODULE, `⏱ Búsqueda total: ${result.totalProductos} productos en ${elapsed}ms [método: DOM]`);
        return result;
      }

      // Para búsquedas simples, intentar ApiClient primero (más rápido)
      try {
        logger.info(MODULE, 'Intentando búsqueda via ApiClient (AJAX directo)...');
        const result = await this.apiClient.search(filters);
        if (result.productos.length > 0 || !filters.q) {
          const elapsed = Date.now() - t0;
          logger.info(MODULE, `⏱ Búsqueda total: ${result.totalProductos} productos en ${elapsed}ms [método: AJAX]`);
          return result;
        }
        logger.warn(MODULE, 'ApiClient retornó 0 productos, fallback a DOM scraper...');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(MODULE, `ApiClient falló: ${msg}, fallback a DOM scraper...`);
      }

      // Fallback: DOM scraper
      logger.info(MODULE, 'Usando ProductScraper (DOM)...');
      const result = await this.productScraper.search(filters);
      const elapsed = Date.now() - t0;
      logger.info(MODULE, `⏱ Búsqueda total: ${result.totalProductos} productos en ${elapsed}ms [método: DOM-fallback]`);
      return result;
    } finally {
      this.releaseLock();
    }
  }

  // ── Normalización de productos para POST /search ─────────
  static normalizeProducts(products: Product[]): NormalizedProduct[] {
    return products.map((p) => {
      // Formato argentino: 186.415,00 → quitar puntos de miles, coma → punto decimal
      const raw = (p.precio ?? '0').trim().replace(/\./g, '').replace(',', '.');
      const precioObtenido = parseFloat(raw) || 0;
      const precioIva = precioObtenido * 1.21;
      const precioCosto = precioIva * 0.45;
      const precioVenta = precioCosto * 1.25;

      return {
        code: p.sku ?? '',
        brand: p.marca ?? '',
        category: p.titulo.split(/\s+/)[0] ?? '',
        vehicle: p.vehiculo ?? '',
        precioObtenido: parseFloat(precioObtenido.toFixed(2)),
        precioIva: parseFloat(precioIva.toFixed(2)),
        precioCosto: parseFloat(precioCosto.toFixed(2)),
        precioVenta: parseFloat(precioVenta.toFixed(2)),
        stock: p.stock ?? 0,
        image: p.imagen ?? '',
      };
    });
  }

  // ── Cierre ───────────────────────────────────────────────
  async close(): Promise<void> {
    await this.session.close();
  }
}

// Re-exports para backward compatibility
export { SessionManager } from './SessionManager';
export { ProductScraper } from './ProductScraper';
export { ApiClient } from './ApiClient';
