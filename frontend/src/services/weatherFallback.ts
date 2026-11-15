import type { WeatherPayload } from './weatherApi';

export interface DemoWeatherPayload extends WeatherPayload {
  isDemo: true;
}

function stringHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Generates a stable, varied, physically plausible demo weather forecast
 * for locations where live API data is unavailable, times out, or errors.
 *
 * Values are deterministically derived from location parameters, ensuring
 * that re-renders of the same location remain stable and consistent.
 */
export function generateDemoForecast(params: {
  district?: string;
  state?: string;
  latitude?: number;
  longitude?: number;
}): DemoWeatherPayload {
  const normDistrict = (params.district || '').trim().toLowerCase();
  const normState = (params.state || '').trim().toLowerCase();
  const locKey = normDistrict && normState
    ? `${normDistrict}|${normState}`
    : `${params.latitude?.toFixed(2) ?? '0'}|${params.longitude?.toFixed(2) ?? '0'}`;

  const seed = stringHash(locKey);

  // Realistic temperature range for Indian conditions (26°C to 33°C)
  const baseTemp = 26 + (seed % 8);
  const apparentTemp = baseTemp + 3;
  const humidity = 45 + ((seed >> 2) % 35);
  const windSpeed = 8 + ((seed >> 4) % 12);
  const windDir = (seed * 37) % 360;

  // Plausible WMO interpretation codes (Clear, Mainly clear, Partly cloudy, Overcast, Drizzle, Rain, Showers)
  const plausibleCodes = [0, 1, 2, 2, 3, 1, 51, 61, 80];
  const weatherCode = plausibleCodes[seed % plausibleCodes.length];

  // Consistent anchor calendar date (UTC YYYY-MM-DD)
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  const hourlyTime: string[] = [];
  const hourlyTemp: number[] = [];
  const hourlyApparent: number[] = [];
  const hourlyProb: number[] = [];
  const hourlyPrecip: number[] = [];
  const hourlyWind: number[] = [];
  const hourlyCodes: number[] = [];
  const hourlyVis: number[] = [];

  for (let i = 0; i < 24; i++) {
    const h = String(i).padStart(2, '0');
    hourlyTime.push(`${dateStr}T${h}:00`);
    const diurnal = Math.sin((i - 8) * Math.PI / 12);
    const temp = Math.round(baseTemp + diurnal * 4);
    hourlyTemp.push(temp);
    hourlyApparent.push(temp + 2);
    const prob = Math.max(0, Math.min(100, Math.round(((seed + i * 7) % 65))));
    hourlyProb.push(prob);
    hourlyPrecip.push(prob > 50 ? 0.6 : 0);
    hourlyWind.push(Math.round(windSpeed + Math.sin(i) * 3));
    hourlyCodes.push(weatherCode);
    hourlyVis.push(10000);
  }

  const dailyTime: string[] = [];
  const dailyCodes: number[] = [];
  const dailyMax: number[] = [];
  const dailyMin: number[] = [];
  const dailyProb: number[] = [];

  for (let d = 0; d < 7; d++) {
    const dayDate = new Date(now.getTime() + d * 86400000);
    dailyTime.push(dayDate.toISOString().slice(0, 10));
    dailyCodes.push(plausibleCodes[(seed + d) % plausibleCodes.length]);
    dailyMax.push(baseTemp + 2 + ((seed + d) % 3));
    dailyMin.push(baseTemp - 5 + ((seed + d * 2) % 3));
    dailyProb.push(Math.round(((seed + d * 13) % 70)));
  }

  return {
    isDemo: true,
    location: {
      district: params.district || null,
      state: params.state || null,
      latitude: params.latitude ?? 0,
      longitude: params.longitude ?? 0,
      source: 'Demo / Illustrative Fallback',
    },
    current: {
      temperature_2m: baseTemp,
      apparent_temperature: apparentTemp,
      relative_humidity_2m: humidity,
      precipitation: 0,
      weather_code: weatherCode,
      wind_speed_10m: windSpeed,
      wind_direction_10m: windDir,
      time: `${dateStr}T12:00`,
      cloud_cover: 25,
    },
    hourly: {
      time: hourlyTime,
      temperature_2m: hourlyTemp,
      apparent_temperature: hourlyApparent,
      precipitation_probability: hourlyProb,
      precipitation: hourlyPrecip,
      weather_code: hourlyCodes,
      wind_speed_10m: hourlyWind,
      visibility: hourlyVis,
    },
    daily: {
      time: dailyTime,
      weather_code: dailyCodes,
      temperature_2m_max: dailyMax,
      temperature_2m_min: dailyMin,
      precipitation_probability_max: dailyProb,
    },
    units: { temperature: '°C', wind_speed: 'km/h', precipitation: 'mm' },
    provider: 'Demo Forecast',
    provider_url: 'https://open-meteo.com/',
    license: 'CC BY 4.0',
    license_url: 'https://open-meteo.com/en/licence',
    commercial_use_notice: 'Demo Forecast — Illustrative data, not live weather.',
    updated_at: `${dateStr} 12:00`,
  };
}
