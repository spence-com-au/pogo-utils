/**
 * Live PokeMap as one open tab sees it: the calls its page makes on load, then one viewport request per refresh.
 *
 * **It writes nothing.** The page `PUT`s `/api/settings/ui-preferences` on load, and doing the same would overwrite
 * the user's own display filters with the watcher's, so no method here sends anything but the login and the viewport —
 * both `POST`s that read. `onRequest` hears every method and path sent, which is what `--verbose` prints and what the
 * end-to-end test holds that claim to.
 *
 * **It keeps itself logged in.** `POST /api/auth/login` answers a `Bearer` JWT good for 24 hours with no refresh
 * endpoint, so a 401 on anything else is answered by logging in again and asking once more.
 *
 * **Neither the password nor the token is ever printed.** Errors carry the method, the path and the server's own
 * message, and nothing from the request.
 */

import {
  ApiError,
  unwrap,
  type ClientConfig,
  type GameData,
  type ViewportRequest,
  type ViewportResponse,
} from './wire.mts';

export const LIVE_POKEMAP = 'https://play.livepokemap.com';

/**
 * What Chrome sends with the page's own `fetch`, other than the cookies and the `Content-Type` and `Authorization` the
 * wrapper adds. Node's `fetch` cannot present Chrome's TLS or HTTP/2 fingerprint whatever headers it sends, so these
 * make the requests read like the page's in a log rather than pass for a browser at the edge — whether Cloudflare
 * minds is #189's overnight run to find out.
 */
export const CHROME_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/141.0.0.0 Safari/537.36',
  'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
});

export interface Credentials {
  username: string;
  password: string;
}

/**
 * The login itself turned away, at start or on a re-login hours in — a password changed, an account suspended. Its
 * own class because it is the one failure never to retry: the same credentials sent again every few minutes are how
 * an account gets locked, and nobody is there to notice.
 */
export class LoginRefused extends Error {
  constructor(cause: ApiError) {
    super(`Live PokeMap refused the login: ${cause.message}`, { cause });
    this.name = 'LoginRefused';
  }
}

export class LivePokeMap {
  readonly #base: string;
  readonly #credentials: Credentials;
  readonly #onRequest: (line: string) => void;
  #token: string | null = null;

  /** `onRequest` is told each request as `METHOD /path` as it is sent. */
  constructor(base: string, credentials: Credentials, onRequest: (line: string) => void = () => {}) {
    this.#base = base;
    this.#credentials = credentials;
    this.#onRequest = onRequest;
  }

  get loggedIn(): boolean {
    return this.#token !== null;
  }

  /** `/api/config` and `/api/game_data` take no token; the page reads both before it has one. */
  config(signal?: AbortSignal): Promise<ClientConfig> {
    return this.#object('/api/config', signal) as Promise<ClientConfig>;
  }

  gameData(signal?: AbortSignal): Promise<GameData> {
    return this.#object('/api/game_data', signal) as Promise<GameData>;
  }

  /**
   * A tokenless read whose answer its caller takes on trust, refused as a failure when it is no object: a JSON `null`,
   * bare or as an envelope's `data`, would otherwise be dereferenced outside any retry.
   */
  async #object(path: string, signal?: AbortSignal): Promise<unknown> {
    const answer = await this.#send('GET', path, undefined, false, signal);

    if (typeof answer !== 'object' || answer === null) {
      throw new ApiError(`GET ${path}: 200 with no object in its body`, 200);
    }

    return answer;
  }

  /**
   * `login` in the page:
   *
   * ```js
   * let a=await f("/api/auth/login",{method:"POST",body:JSON.stringify({username:n,password:t})});r(a.token);
   * ```
   */
  async login(signal?: AbortSignal): Promise<void> {
    this.#token = null;

    let answer: { token?: unknown };

    try {
      answer = (await this.#send('POST', '/api/auth/login', this.#credentials, false, signal)) as { token?: unknown };
    } catch (error) {
      if (error instanceof ApiError && [400, 401, 403].includes(error.status)) {
        throw new LoginRefused(error);
      }

      throw error;
    }

    if (typeof answer?.token !== 'string' || answer.token === '') {
      throw new ApiError('the login answered no token', 200);
    }

    this.#token = answer.token;
  }

  /** The reads the page makes once logged in, before its first viewport: who it is, and its game sessions. */
  async startup(signal?: AbortSignal): Promise<void> {
    await this.#authorised('GET', '/api/auth/me', undefined, signal);
    await this.#authorised('GET', '/api/session/status', undefined, signal);
  }

  viewport(body: ViewportRequest, signal?: AbortSignal): Promise<ViewportResponse> {
    return this.#authorised('POST', '/api/map/viewport', body, signal) as Promise<ViewportResponse>;
  }

  /** A request needing the token, logging in first where there is none and again where it is refused. */
  async #authorised(method: string, path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    if (!this.loggedIn) {
      await this.login(signal);
    }

    try {
      return await this.#send(method, path, body, true, signal);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        throw error;
      }

      await this.login(signal);

      return this.#send(method, path, body, true, signal);
    }
  }

  async #send(method: string, path: string, body: unknown, authorised: boolean, signal?: AbortSignal) {
    const headers: Record<string, string> = {
      ...CHROME_HEADERS,
      'Content-Type': 'application/json',
      'Referer': `${this.#base}/`,
    };

    if (method !== 'GET') {
      headers.Origin = this.#base;
    }

    if (authorised && this.#token) {
      headers.Authorization = `Bearer ${this.#token}`;
    }

    this.#onRequest(`${method} ${path}`);

    const response = await fetch(`${this.#base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });

    let parsed: unknown = null;

    try {
      parsed = await response.json();
    } catch {
      // A Cloudflare challenge or an error page. Under an error status that status says what there is to say; under a
      // 200 it is still no answer, and is refused here as a failure rather than handed on as one.
      if (response.ok) {
        throw new ApiError(`${method} ${path}: ${response.status} with a body that is not JSON`, response.status);
      }
    }

    try {
      return unwrap(parsed, response.status, response.ok);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401) {
          this.#token = null;
        }

        error.message = `${method} ${path}: ${response.status} ${error.message}`;
      }

      throw error;
    }
  }
}
