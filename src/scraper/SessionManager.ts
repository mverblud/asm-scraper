// src/scraper/SessionManager.ts
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { config } from '../config';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const MODULE = 'SessionManager';
const STORAGE_PATH = path.resolve(process.cwd(), '.session-state.json');

export class SessionManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private _page: Page | null = null;
  private loggedIn = false;

  get page(): Page {
    if (!this._page) throw new Error('Browser no inicializado. Llamá a login() primero.');
    return this._page;
  }

  isLoggedIn(): boolean {
    return this.loggedIn;
  }

  // ── Login con reintentos ─────────────────────────────────
  async login(): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      try {
        logger.info(MODULE, `Intento de login ${attempt}/${config.maxRetries} como "${config.username}"...`);
        await this.doLogin();
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn(MODULE, `Login intento ${attempt} falló: ${lastError.message}`);
        await this.closeBrowser();
        if (attempt < config.maxRetries) {
          await this.sleep(2000 * attempt);
        }
      }
    }

    throw lastError ?? new Error('Login fallido luego de todos los reintentos');
  }

  // ── Login real ───────────────────────────────────────────
  private async doLogin(): Promise<void> {
    this.browser = await chromium.launch({ headless: config.headless });

    // Intentar restaurar sesión desde storageState guardado
    if (fs.existsSync(STORAGE_PATH)) {
      logger.info(MODULE, 'Restaurando sesión desde storageState guardado...');
      try {
        this.context = await this.browser.newContext({ storageState: STORAGE_PATH });
        this._page = await this.context.newPage();

        await this._page.goto(config.loginUrl, {
          waitUntil: 'networkidle',
          timeout: config.loginTimeout,
        });

        if (await this.verifyLoggedIn()) {
          this.loggedIn = true;
          logger.info(MODULE, `Sesión restaurada correctamente como "${config.username}"`);
          return;
        }

        logger.warn(MODULE, 'storageState expirado, haciendo login fresco...');
        await this._page.close();
        await this.context.close();
      } catch {
        logger.warn(MODULE, 'Error restaurando storageState, haciendo login fresco...');
      }
    }

    // Login fresco
    this.context = await this.browser.newContext();
    this._page = await this.context.newPage();

    await this._page.goto(config.loginUrl, {
      waitUntil: 'networkidle',
      timeout: config.loginTimeout,
    });

    // Completar formulario
    await this._page.getByRole('textbox', { name: 'Nombre de usuario o correo' }).fill(config.username);
    await this._page.getByPlaceholder('Ingrese su contraseña').fill(config.password);
    await this._page.getByRole('button', { name: 'Ingresar' }).click();

    await this._page.waitForLoadState('networkidle', { timeout: config.loginTimeout });

    if (!(await this.verifyLoggedIn())) {
      throw new Error('Login fallido. Verificá ASM_USERNAME y ASM_PASSWORD en el .env');
    }

    // Guardar storageState para reutilizar la sesión
    await this.saveSession();

    this.loggedIn = true;
    logger.info(MODULE, `Sesión iniciada correctamente como "${config.username}"`);
  }

  // ── Verificar si estamos logueados ───────────────────────
  private async verifyLoggedIn(): Promise<boolean> {
    const bodyText = (await this._page!.textContent('body')) ?? '';
    return (
      bodyText.includes('Cerrar sesión') ||
      bodyText.includes('Salir') ||
      bodyText.includes('Hola') ||
      bodyText.includes(config.username)
    );
  }

  // ── Guardar sesión ───────────────────────────────────────
  private async saveSession(): Promise<void> {
    try {
      const state = await this.context!.storageState();
      fs.writeFileSync(STORAGE_PATH, JSON.stringify(state));
      logger.debug(MODULE, 'storageState guardado');
    } catch (err) {
      logger.warn(MODULE, 'No se pudo guardar storageState', err);
    }
  }

  // ── Reconexión si la sesión expiró ───────────────────────
  async ensureLoggedIn(): Promise<void> {
    if (!this._page || !this.loggedIn) {
      await this.login();
      return;
    }

    try {
      // Verificar sesión navegando a la cuenta
      await this._page.goto(config.loginUrl, {
        waitUntil: 'networkidle',
        timeout: config.requestTimeout,
      });

      if (!(await this.verifyLoggedIn())) {
        logger.warn(MODULE, 'Sesión expirada, re-logueando...');
        await this.closeBrowser();
        this.loggedIn = false;
        await this.login();
      }
    } catch {
      logger.warn(MODULE, 'Error verificando sesión, re-logueando...');
      await this.closeBrowser();
      this.loggedIn = false;
      await this.login();
    }
  }

  // ── Obtener cookies para API Client ──────────────────────
  async getCookies(): Promise<string> {
    if (!this.context) return '';
    const cookies = await this.context.cookies();
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  // ── Cerrar browser ───────────────────────────────────────
  private async closeBrowser(): Promise<void> {
    try {
      await this.browser?.close();
    } catch { /* ignore */ }
    this.browser = null;
    this.context = null;
    this._page = null;
  }

  async close(): Promise<void> {
    await this.closeBrowser();
    this.loggedIn = false;
    logger.info(MODULE, 'Browser cerrado');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
