// src/types/index.ts

// ── Producto interno (scraping) ────────────────────────────
export interface Product {
  id: string | null;
  titulo: string;
  sku: string | null;
  vehiculo: string | null;
  marca: string | null;
  stock: number | null;
  precio: string | null;
  url: string | null;
  imagen: string | null;
}

// ── Producto normalizado (API output) ──────────────────────
export interface NormalizedProduct {
  code: string;
  brand: string;
  category: string;
  vehicle: string;
  precioObtenido: number;
  precioIva: number;
  precioCosto: number;
  precioVenta: number;
  stock: number;
  image: string;
}

// ── Paginación ─────────────────────────────────────────────
export interface Pagination {
  currentPage: number;
  totalPages: number;
}

// ── Filtros de búsqueda (internos) ─────────────────────────
export interface SearchFilters {
  q?: string;
  sku?: string;
  categoria?: string;
  marca?: string;
  allPages?: boolean;
}

// ── Resultado de scraping ──────────────────────────────────
export interface SearchResult {
  success: boolean;
  filtros: Omit<SearchFilters, 'allPages'>;
  paginacion: Pagination | { paginasRecorridas: number; total: number };
  totalProductos: number;
  productos: Product[];
}

// ── Input POST /search ─────────────────────────────────────
export interface SearchInput {
  query?: string;
  sku?: string;
  filters?: {
    categoria?: string;
    marca?: string;
  };
}

// ── Output POST /search ────────────────────────────────────
export interface SearchOutput {
  total: number;
  products: NormalizedProduct[];
}

// ── Config ─────────────────────────────────────────────────
export interface AppConfig {
  port: number;
  username: string;
  password: string;
  baseUrl: string;
  loginUrl: string;
  shopUrl: string;
  headless: boolean;
  loginTimeout: number;
  requestTimeout: number;
  maxRetries: number;
}
