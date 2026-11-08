/**
 * `fetch`, refusing a response that is not ok with its status alone, so each caller names the file in its own words.
 * HTTP/2 sends no reason phrase, so a bare status is all there is to say — trimmed rather than printed with a trailing
 * space.
 */
export async function fetchOk(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }

  return response;
}
