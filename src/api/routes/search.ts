// src/api/routes/search.ts
import { Router, Request, Response } from 'express';
import { Scraper } from '../../scraper';
import { SearchInput, SearchFilters } from '../../types';
import { logger } from '../../utils/logger';

const MODULE = 'SearchRoute';

const ALLOWED_FILTER_KEYS = new Set(['categoria', 'marca']);

export function searchRouter(scraper: Scraper): Router {
  const router = Router();

  /**
   * POST /search
   *
   * Body:
   * {
   *   "query": "bieleta",          // texto libre (obligatorio si no hay sku)
   *   "sku": "5860-RSF",           // código SKU (obligatorio si no hay query)
   *   "filters": {                  // filtros opcionales
   *     "categoria": "BIELETAS",
   *     "marca": "RSF"
   *   }
   * }
   */
  router.post('/', async (req: Request, res: Response) => {
    try {
      const body = req.body as SearchInput | undefined;

      if (body && typeof body !== 'object') {
        res.status(400).json({ error: 'El body debe ser un objeto JSON' });
        return;
      }

      const query = body?.query;
      const sku = body?.sku;
      const filters = body?.filters;

      // Validar tipos
      if (query !== undefined && typeof query !== 'string') {
        res.status(400).json({ error: '"query" debe ser un string' });
        return;
      }
      if (sku !== undefined && typeof sku !== 'string') {
        res.status(400).json({ error: '"sku" debe ser un string' });
        return;
      }

      // Al menos query o sku es obligatorio
      if (!query && !sku) {
        res.status(400).json({ error: 'Se requiere "query" o "sku" (al menos uno debe estar presente)' });
        return;
      }

      if (filters !== undefined && (typeof filters !== 'object' || Array.isArray(filters))) {
        res.status(400).json({ error: '"filters" debe ser un objeto' });
        return;
      }

      // Validar claves de filtros
      if (filters) {
        const invalidKeys = Object.keys(filters).filter((k) => !ALLOWED_FILTER_KEYS.has(k));
        if (invalidKeys.length > 0) {
          res.status(400).json({
            error: `Filtros no válidos: ${invalidKeys.join(', ')}`,
            allowedFilters: Array.from(ALLOWED_FILTER_KEYS),
          });
          return;
        }
      }

      // Construir SearchFilters internos
      const searchFilters: SearchFilters = { allPages: true };
      if (query) searchFilters.q = query;
      if (sku) searchFilters.sku = sku;
      if (filters?.categoria) searchFilters.categoria = filters.categoria;
      if (filters?.marca) searchFilters.marca = filters.marca;

      logger.info(MODULE, 'POST /search', searchFilters);

      const t0 = Date.now();
      const result = await scraper.search(searchFilters);
      const totalMs = Date.now() - t0;
      const normalizedProducts = Scraper.normalizeProducts(result.productos);

      res.json({
        total: normalizedProducts.length,
        products: normalizedProducts,
        timing: { totalMs },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      logger.error(MODULE, `Error en POST /search: ${message}`);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
