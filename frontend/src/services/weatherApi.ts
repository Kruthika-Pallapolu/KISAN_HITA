export interface WeatherPayload {
  location: { district: string | null; state: string | null; latitude: number; longitude: number; source: string };
  current: Record<string, number | string | null>;
  hourly: Record<string, Array<number | string | null>>;
  daily: Record<string, Array<number | string | null>>;
  units: { temperature: string; wind_speed: string; precipitation: string };
  provider: string;
  provider_url: string;
  license: string;
  license_url: string;
  commercial_use_notice: string;
  updated_at: string;
  isDemo?: boolean;
}

export class WeatherApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; this.name = 'WeatherApiError'; }
}

export async function requestWeather(params: { district?: string; state?: string; latitude?: number; longitude?: number; language: string }): Promise<WeatherPayload> {
  const query = new URLSearchParams({ language: params.language });
  if (params.district && params.state) { query.set('district', params.district); query.set('state', params.state); }
  if (params.latitude !== undefined && params.longitude !== undefined) { query.set('latitude', String(params.latitude)); query.set('longitude', String(params.longitude)); }
  const response = await fetch(`/api/weather/current?${query.toString()}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.detail;
    if (typeof detail === 'object' && detail) throw new WeatherApiError(detail.code || 'weather_error', detail.message || 'Weather request failed.');
    throw new WeatherApiError('weather_error', typeof detail === 'string' ? detail : 'Weather request failed.');
  }
  if (!body?.current || !body?.hourly?.time || !body?.daily?.time || body.provider !== 'Open-Meteo') {
    throw new WeatherApiError('weather_invalid_response', 'Weather response was incomplete.');
  }
  return body as WeatherPayload;
}
