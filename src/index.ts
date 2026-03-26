// src/index.ts
import express from 'express';
import cors from 'cors';
import { config } from './config';
import { Scraper } from './scraper';
import { searchRouter } from './api/routes/search';
import { logger } from './utils/logger';

const MODULE = 'App';

async function bootstrap(): Promise<void> {
  // ── 1. Inicializar scraper (login automático) ────────────
  const scraper = new Scraper();

  try {
    await scraper.init();
  } catch (err) {
    logger.error(MODULE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // ── 2. Express ───────────────────────────────────────────
  const app = express();
  app.use(cors());
  app.use(express.json());

  // ── 3. Rutas ─────────────────────────────────────────────
  app.use('/search', searchRouter(scraper));

  // 404 genérico
  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      error: 'Ruta no encontrada',
      rutasDisponibles: ['POST /search'],
    });
  });

  // ── 4. Iniciar servidor ───────────────────────────────────
  const server = app.listen(config.port, () => {
    logger.info(MODULE, `ASM Scraper API corriendo en http://localhost:${config.port}`);
    logger.info(MODULE, 'POST /search → búsqueda por query/sku con filtros opcionales (categoria, marca)');
  });

  // ── 5. Graceful shutdown ──────────────────────────────────
  const shutdown = async () => {
    logger.info(MODULE, 'Cerrando browser y servidor...');
    server.close();
    await scraper.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap();
