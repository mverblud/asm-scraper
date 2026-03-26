# ASM Autopartes — Scraper API

API REST en **Node.js + TypeScript + Express** que se loguea automáticamente en [autopartessanmartin.com.ar](https://autopartessanmartin.com.ar), navega el catálogo y devuelve productos en JSON.

---

## Requisitos

- Node.js >= 18
- npm >= 9

---

## Instalación y uso

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar variables de entorno

El archivo `.env` ya viene configurado. Si necesitás cambiarlo:

```env
PORT=3000

ASM_USERNAME=tu_usuario
ASM_PASSWORD=tu_contraseña

ASM_BASE_URL=https://autopartessanmartin.com.ar
ASM_LOGIN_URL=https://autopartessanmartin.com.ar/cuenta/
ASM_SHOP_URL=https://autopartessanmartin.com.ar/tienda/
```

### 3. Levantar el servidor

**Modo desarrollo** (con hot-reload):
```bash
npm run dev
```

**Modo producción** (compilar y ejecutar):
```bash
npm run build
npm start
```

Al iniciar, el servidor se loguea automáticamente con las credenciales del `.env` antes de aceptar peticiones.

---

## Endpoints

### `GET /health`

Estado del servidor y sesión.

```json
{
  "status": "ok",
  "sesionActiva": true,
  "usuario": "mv",
  "timestamp": "2026-03-17T12:00:00.000Z"
}
```

---

### `GET /productos`

Lista productos con filtros opcionales.

| Query param  | Descripción                      | Ejemplo                         |
|--------------|----------------------------------|---------------------------------|
| `q`          | Búsqueda por nombre/texto        | `?q=bieleta`                    |
| `sku`        | Código SKU                       | `?sku=5860-RSF`                 |
| `categoria`  | Categoría del producto           | `?categoria=BIELETAS`           |
| `marca`      | Marca del producto               | `?marca=RSF`                    |
| `vehiculo`   | Vehículo compatible              | `?vehiculo=PEUGEOT%20208`       |
| `anio`       | Año del vehículo                 | `?anio=2015`                    |
| `page`       | Número de página (default: 1)    | `?page=2`                       |
| `allPages`   | Trae todos los resultados        | `?allPages=true`                |

**Respuesta:**
```json
{
  "success": true,
  "filtros": { "categoria": "BIELETAS" },
  "paginacion": { "currentPage": 1, "totalPages": 3 },
  "totalProductos": 12,
  "productos": [
    {
      "id": "6321",
      "titulo": "BIELETA 5860-RSF",
      "sku": "BIELETA-5860-RSF",
      "vehiculo": "PEUGEOT 2008",
      "stock": 5,
      "precio": "45200,00",
      "url": "https://autopartessanmartin.com.ar/producto/bieleta-5860-rsf/"
    }
  ]
}
```

---

### `GET /productos/:sku`

Busca un producto por SKU exacto.

```
GET /productos/5860-RSF
```

---

## Ejemplos con curl

```bash
# Todos los productos (página 1)
curl http://localhost:3000/productos

# Buscar por texto
curl "http://localhost:3000/productos?q=amortiguador"

# Filtrar por categoría
curl "http://localhost:3000/productos?categoria=BIELETAS"

# Filtrar por vehículo y año
curl "http://localhost:3000/productos?vehiculo=PEUGEOT%20208&anio=2015"

# Buscar por SKU
curl http://localhost:3000/productos/5860-RSF

# Traer TODAS las páginas de una categoría
curl "http://localhost:3000/productos?categoria=AMORTIGUADORES&allPages=true"

# Estado del servidor
curl http://localhost:3000/health
```

---

## Estructura del proyecto

```
asm-scraper/
├── src/
│   ├── config/
│   │   └── index.ts          # Lee y valida el .env
│   ├── routes/
│   │   ├── health.ts         # GET /health
│   │   └── productos.ts      # GET /productos, GET /productos/:sku
│   ├── services/
│   │   ├── SessionService.ts # Login y manejo de cookies
│   │   └── ScraperService.ts # Scraping del catálogo
│   ├── types/
│   │   └── index.ts          # Interfaces TypeScript
│   └── index.ts              # Entry point — bootstrap
├── .env                      # Variables de entorno (no commitear)
├── .env.example              # Plantilla sin datos sensibles
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```
