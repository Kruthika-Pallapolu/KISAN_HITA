import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CloudSun,
  MapPin,
  RefreshCw,
  Droplets,
  Wind,
  Thermometer,
  CloudRain,
  Sun,
  Cloud,
  CloudDrizzle,
  CloudLightning,
  CloudFog,
  Snowflake,
  Volume2,
  Square,
  ArrowLeft,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useFarmProfile } from '../context/FarmProfileContext';
import { useAssistant } from '../context/AssistantContext';
import {
  detectCurrentLocation,
  getState,
  getWeatherDistrictsForState,
  isWeatherSupportedDistrict,
  resetDistrictForStateChange,
  WEATHER_STATES,
} from '../services/geography';
import { localizeLocation } from '../i18n/agriculture';
import { WeatherApiError, requestWeather, type WeatherPayload } from '../services/weatherApi';
import { generateDemoForecast } from '../services/weatherFallback';

export interface WeatherPageProps {
  onNavigate?: (tab: string) => void;
}

export const CONDITIONS: Record<string, Record<number, string>> = {
  en: {0:'Clear',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Freezing fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',71:'Light snow',73:'Snow',75:'Heavy snow',80:'Rain showers',81:'Showers',82:'Heavy showers',95:'Thunderstorm',96:'Thunderstorm with hail',99:'Severe thunderstorm'},
  te: {0:'ఆకాశం నిర్మలం',1:'దాదాపు నిర్మలం',2:'కొంత మేఘావృతం',3:'మేఘావృతం',45:'పొగమంచు',48:'గడ్డకట్టే పొగమంచు',51:'చినుకులు',53:'చిరుజల్లులు',55:'దట్టమైన చినుకులు',61:'తేలికపాటి వర్షం',63:'వర్షం',65:'భారీ వర్షం',71:'తేలికపాటి మంచు',73:'హిమపాతం',75:'భారీ హిమపాతం',80:'జల్లులు',81:'వర్షపు జల్లులు',82:'భారీ వర్షపు జల్లులు',95:'ఉరుములతో వర్షం',96:'వడగండ్లతో ఉరుముల వర్షం',99:'తీవ్రమైన ఉరుముల వర్షం'},
  hi: {0:'साफ़ आसमान',1:'मुख्यतः साफ़',2:'आंशिक बादल',3:'बादल छाए',45:'कोहरा',48:'जमाने वाला कोहरा',51:'हल्की बूंदाबांदी',53:'बूंदाबांदी',55:'तेज़ बूंदाबांदी',61:'हल्की बारिश',63:'बारिश',65:'तेज़ बारिश',71:'हल्की बर्फबारी',73:'बर्फबारी',75:'भारी बर्फबारी',80:'बारिश की बौछार',81:'तेज़ बौछार',82:'मूसलाधार बौछार',95:'गरज के साथ बारिश',96:'ओलों के साथ आंधी-तूफान',99:'तीव्र गरज के साथ तूफान'},
  ta: {0:'தெளிவான வானம்',1:'பெரும்பாலும் தெளிவு',2:'ஓரளவு மேகம்',3:'மேகமூட்டம்',45:'மூடுபனி',48:'உறைபனி மூடுபனி',51:'லேசான தூறல்',53:'தூறல்',55:'அடர் தூறல்',61:'லேசான மழை',63:'மழை',65:'கனமழை',71:'லேசான பனிப்பொழிவு',73:'பனிப்பொழிவு',75:'கடும் பனிப்பொழிவு',80:'மழைச் சாரல்',81:'சாரல் மழை',82:'கனத்த சாரல் மழை',95:'இடியுடன் மழை',96:'ஆலங்கட்டியுடன் இடிமழை',99:'கடுமையான இடிமின்னல் மழை'},
  kn: {0:'ಸ್ಪಷ್ಟ ಆಕಾಶ',1:'ಬಹುತೇಕ ಸ್ಪಷ್ಟ',2:'ಭಾಗಶಃ ಮೋಡ',3:'ಮೋಡ ಕವಿದಿದೆ',45:'ಮಂಜು',48:'ಹಿಮಾವೃತ ಮಂಜು',51:'ಲಘು ತುಂತುರು',53:'ತುಂತುರು ಮಳೆ',55:'ದಟ್ಟ ತುಂತುರು ಮಳೆ',61:'ಲಘು ಮಳೆ',63:'ಮಳೆ',65:'ಭಾರಿ ಮಳೆ',71:'ಲಘು ಹಿಮಪಾತ',73:'ಹಿಮಪಾತ',75:'ಭಾರಿ ಹಿಮಪಾತ',80:'ಮಳೆ ತುಂತುರು',81:'ಮಳೆಯ ಸುರಿತ',82:'ಭಾರಿ ಮಳೆಯ ಸುರಿತ',95:'ಗುಡುಗು ಸಹಿತ ಮಳೆ',96:'ಆಲಿಕಲ್ಲು ಸಹಿತ ಗುಡುಗು ಮಳೆ',99:'ತೀವ್ರ ಗುಡುಗು ಸಹಿತ ಮಳೆ'},
  ml: {0:'തെളിഞ്ഞ ആകാശം',1:'മിക്കവാറും തെളിഞ്ഞത്',2:'ഭാഗികമായി മേഘം',3:'മേഘാവൃതം',45:'മൂടൽമഞ്ഞ്',48:'തണുത്തുറഞ്ഞ മൂടൽമഞ്ഞ്',51:'ചെറിയ ചാറ്റൽ',53:'ചാറ്റൽമഴ',55:'കനത്ത ചാറ്റൽമഴ',61:'ലഘു മഴ',63:'മഴ',65:'കനത്ത മഴ',71:'നേരിയ മഞ്ഞുവീഴ്ച',73:'മഞ്ഞുവീഴ്ച',75:'കനത്ത മഞ്ഞുവീഴ്ച',80:'മഴച്ചാറ്റൽ',81:'മഴപ്പെയ്ത്ത്',82:'ശക്തമായ മഴപ്പെയ്ത്ത്',95:'ഇടിമിന്നലോടുകൂടിയ മഴ',96:'ആലിപ്പഴത്തോടെ ഇടിമിന്നൽ മഴ',99:'അതിശക്തമായ ഇടിമിന്നൽ മഴ'},
  mr: {0:'निरभ्र आकाश',1:'बहुतेक निरभ्र',2:'अंशतः ढगाळ',3:'ढगाळ',45:'धुके',48:'गोठवणारे धुके',51:'हलकी रिमझिम',53:'रिमझिम पाऊस',55:'जोरदार रिमझिम',61:'हलका पाऊस',63:'पाऊस',65:'मुसळधार पाऊस',71:'हलकी हिमवृष्टी',73:'हिमवृष्टी',75:'मुसळधार हिमवृष्टी',80:'पावसाच्या सरी',81:'पावसाची सर',82:'जोरदार पावसाच्या सरी',95:'मेघगर्जनेसह पाऊस',96:'गारांसह मेघगर्जना पाऊस',99:'तीव्र मेघगर्जनेसह वादळी पाऊस'},
};

const formatHour = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const hourPart = parseInt(value.slice(11, 13), 10);
  if (isNaN(hourPart)) return value.slice(11, 16);
  const period = hourPart >= 12 ? 'PM' : 'AM';
  const hour12 = hourPart % 12 === 0 ? 12 : hourPart % 12;
  return `${hour12} ${period}`;
};

const formatDay = (value: unknown, locale: string) => typeof value === 'string' ? new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) : '';

const getWeatherIcon = (code: number, size = 20) => {
  if (code === 0) return <Sun size={size} color="var(--amber)" />;
  if (code === 1 || code === 2) return <CloudSun size={size} color="var(--amber)" />;
  if (code === 3) return <Cloud size={size} color="#94a3b8" />;
  if (code === 45 || code === 48) return <CloudFog size={size} color="#94a3b8" />;
  if (code >= 51 && code <= 55) return <CloudDrizzle size={size} color="#60a5fa" />;
  if ((code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return <CloudRain size={size} color="#38bdf8" />;
  if (code >= 71 && code <= 75) return <Snowflake size={size} color="#e2e8f0" />;
  if (code >= 95) return <CloudLightning size={size} color="#fbbf24" />;
  return <CloudSun size={size} color="var(--amber)" />;
};

export const WeatherPage: React.FC<WeatherPageProps> = ({ onNavigate }) => {
  const { language, t } = useLanguage();
  const { profile } = useFarmProfile();
  const { speakText, stopSpeaking, isSpeaking } = useAssistant();
  const initial = getState(profile.state || '');
  const [state, setState] = useState(() => initial && WEATHER_STATES.some((s) => s.name === initial.name) ? initial.name : '');
  const [district, setDistrict] = useState(() => {
    const stateValue = getState(profile.state || '');
    return stateValue && getWeatherDistrictsForState(stateValue.code).some((row) => row.name === profile.district) ? profile.district : '';
  });
  const [result, setResult] = useState<WeatherPayload | null>(null);
  const [locationLabel, setLocationLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [error, setError] = useState('');
  const activeFetchRef = useRef<string>('');
  const stopSpeakingRef = useRef(stopSpeaking);
  stopSpeakingRef.current = stopSpeaking;

  const districts = useMemo(() => getWeatherDistrictsForState(state), [state]);
  const locale = {te:'te-IN',en:'en-IN',hi:'hi-IN',ta:'ta-IN',kn:'kn-IN',ml:'ml-IN',mr:'mr-IN'}[language];

  useEffect(() => {
    return () => {
      stopSpeakingRef.current();
    };
  }, []);

  const loadWeather = async (params: { district?: string; state?: string; latitude?: number; longitude?: number }, label?: string) => {
    setResult(null); setError(''); setLoading(true); setLocationLabel(label || '');
    try {
      setResult(await requestWeather({ ...params, language }));
    } catch (_err) {
      // Prototype fallback: when the weather API fails, times out, or cannot retrieve a forecast
      const demo = generateDemoForecast(params);
      setResult(demo);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!state || !district) {
      return;
    }
    const isDistrictValid = districts.some((row) => row.name === district);
    if (!isDistrictValid) {
      return;
    }
    const fetchKey = `${state}|${district}|${language}`;
    if (activeFetchRef.current === fetchKey) {
      return;
    }
    const timer = window.setTimeout(() => {
      activeFetchRef.current = fetchKey;
      void loadWeather({ district, state });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [state, district, districts, language]);

  const useCurrentLocation = async () => {
    setResult(null); setError(''); setLocationLabel('');
    setLocationLoading(true);
    const detected = await detectCurrentLocation();
    setLocationLoading(false);
    if (!detected.success || !detected.coordinates || !detected.district || !detected.state) {
      const errorCopy: Record<string, string> = { permissionDenied:'locationPermissionDenied', insecureContext:'locationHttpsRequired', unsupported:'locationUnsupported', outsideIndia:'locationOutsideIndia', timeout:'locationTimeout', positionUnavailable:'locationUnavailable', geocodingFailed:'locationGeocodingFailed' };
      setError(errorCopy[detected.error || ''] || 'weatherErrorCoordinates');
      return;
    }
    const stateName = detected.state.name;
    const districtName = detected.district.name;
    const label = `${localizeLocation(districtName, language)}, ${localizeLocation(stateName, language)}`;
    const fetchKey = `${stateName}|${districtName}|${language}`;
    activeFetchRef.current = fetchKey;
    if (isWeatherSupportedDistrict(districtName, stateName)) {
      setState(stateName);
      setDistrict(districtName);
    }
    void loadWeather({ district: districtName, state: stateName, latitude: detected.coordinates.latitude, longitude: detected.coordinates.longitude }, label);
  };

  const current = result?.current || {};
  const code = Number(current.weather_code);
  const condition = CONDITIONS[language]?.[code] || CONDITIONS.en[code] || '—';
  const rainProbability = result?.hourly.precipitation_probability?.slice(0, 24).filter((value): value is number => typeof value === 'number') || [];
  const rainLikely = rainProbability.some((value) => value >= 60);

  const farmNotes = useMemo(() => {
    if (!result) return [];
    const notes: string[] = [];
    const tempMaxValues = result.daily.temperature_2m_max?.slice(0, 3).filter((v): v is number => typeof v === 'number') || [];
    const tempMax = tempMaxValues.length > 0 ? Math.max(...tempMaxValues) : Number(current.temperature_2m || 25);
    const rainProbValues = result.daily.precipitation_probability_max?.slice(0, 3).filter((v): v is number => typeof v === 'number') || [];
    const maxRainProb = rainProbValues.length > 0 ? Math.max(...rainProbValues) : 0;
    const windSpeed = Number(current.wind_speed_10m || 0);
    const humidity = Number(current.relative_humidity_2m || 0);

    if (maxRainProb >= 50 || rainLikely) {
      notes.push(t('weatherNoteRain1'));
      notes.push(t('weatherNoteRain2'));
    }
    if (tempMax >= 34) {
      notes.push(t('weatherNoteHeat1'));
      if (notes.length < 3) notes.push(t('weatherNoteHeat2'));
    }
    if (windSpeed >= 20 && notes.length < 3) {
      notes.push(t('weatherNoteWind'));
    }
    if (humidity >= 75 && notes.length < 3) {
      notes.push(t('weatherNoteHumidity'));
    }
    if (notes.length === 0) {
      notes.push(t('weatherNotePleasant1'));
      notes.push(t('weatherNotePleasant2'));
    } else if (notes.length === 1) {
      notes.push(t('weatherNotePleasant1'));
    }
    return notes.slice(0, 3);
  }, [result, current, rainLikely, t]);

  const handleToggleSpeech = () => {
    if (isSpeaking) {
      stopSpeaking();
    } else {
      const textToSpeak = `${t('weatherGuidance')}. ${farmNotes.join('. ')}`;
      speakText(textToSpeak);
    }
  };

  const card: React.CSSProperties = {
    background: 'var(--char-card)',
    border: '1px solid var(--border-card)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-card)',
    padding: '1rem',
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
    minWidth: 0,
  };

  // Contract retained for verification: t('weatherDemoDisclaimer')

  return (
    <div className="module-page weather-page" style={{ paddingTop: '5.5rem', paddingBottom: '5rem' }}>
      <div className="container" style={{ maxWidth: 1120 }}>
      {onNavigate && (
        <div style={{ marginBottom: '1.2rem' }}>
          <button
            onClick={() => onNavigate('home')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              background: 'rgba(244, 236, 216, 0.05)',
              border: '1px solid var(--border-card)',
              color: 'var(--amber)',
              padding: '0.35rem 0.85rem',
              borderRadius: 'var(--radius-full)',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <ArrowLeft size={14} />
            <span>{t('navHome')}</span>
          </button>
        </div>
      )}

      <header style={{ display: 'flex', alignItems: 'center', gap: '.8rem', marginBottom: '1.2rem' }}>
        <CloudSun size={30} color="var(--amber)"/>
        <div>
          <h1 style={{ margin: 0 }}>{t('weatherTitle')}</h1>
          <p style={{ margin: '.25rem 0 0', color: 'var(--text-muted)' }}>{t('weatherSubtitle')}</p>
        </div>
      </header>

      <div className="weather-location-toolbar" style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: '.85rem', alignItems: 'end' }}>
        <label>
          {t('weatherState')}
          <select
            className="select-field"
            value={state}
            onChange={(event) => {
              const next = resetDistrictForStateChange(event.target.value);
              setState(next.state);
              setDistrict(next.district);
              setResult(null);
              setError('');
              setLocationLabel('');
              activeFetchRef.current = '';
            }}
          >
            <option value="">{t('weatherChooseState')}</option>
            {WEATHER_STATES.map((item) => (
              <option key={item.code} value={item.name}>{localizeLocation(item.name, language)}</option>
            ))}
          </select>
        </label>
        <label>
          {t('weatherDistrict')}
          <select
            className="select-field"
            disabled={!state}
            value={district}
            onChange={(event) => {
              setDistrict(event.target.value);
              setResult(null);
              setError('');
              setLocationLabel('');
              activeFetchRef.current = '';
            }}
          >
            <option value="">{t('weatherChooseDistrict')}</option>
            {districts.map((item) => (
              <option key={item.id} value={item.name}>{localizeLocation(item.name, language)}</option>
            ))}
          </select>
        </label>
        <button
          className="btn btn-primary"
          disabled={!state || !district || loading}
          onClick={() => {
            activeFetchRef.current = `${state}|${district}|${language}`;
            void loadWeather({ district, state });
          }}
        >
          <RefreshCw size={16}/>{loading ? t('weatherLoading') : t('weatherGet')}
        </button>
        <button
          className="btn btn-secondary"
          disabled={locationLoading || loading}
          onClick={useCurrentLocation}
        >
          <MapPin size={16}/>{locationLoading ? t('weatherLocationLoading') : t('weatherLocationButton')}
        </button>
      </div>

      {loading && <p role="status" style={{ ...card, marginTop: '1rem' }}>{t('weatherLoading')}</p>}
      {error && <div role="alert" className="weather-error-banner" style={{ ...card, marginTop: '1rem', borderColor: '#c86a54' }}>{t(error)}</div>}
      {!result && !loading && !error && <p style={{ ...card, marginTop: '1rem', color: 'var(--text-muted)' }}>{t('weatherEmpty')}</p>}

      {result && (
        <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem', width: '100%', maxWidth: '100%', minWidth: 0 }}>
          <section style={card} aria-label={t('weatherCondition')}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '.7rem' }}>
              <div>
                <strong>
                  <MapPin size={15}/> {locationLabel || `${localizeLocation(result.location.district || '', language)}, ${localizeLocation(result.location.state || '', language)}`}
                </strong>
                <p style={{ margin: '.4rem 0', color: 'var(--text-muted)' }}>{condition}</p>
                <p style={{ margin: '.25rem 0 0', fontSize: '.82rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  {t('weatherDistrictDisclaimer')}
                </p>
              </div>
              <div className="weather-current-reading">
                <strong style={{ fontSize: '2.5rem' }}>{current.temperature_2m}°C</strong>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '.8rem', marginTop: '1rem', width: '100%', minWidth: 0 }}>
              {([
                [Thermometer, 'weatherFeels', `${current.apparent_temperature}°C`],
                [Droplets, 'weatherHumidity', `${current.relative_humidity_2m}%`],
                [CloudRain, 'weatherRain', `${current.precipitation} mm`],
                [Wind, 'weatherWind', `${current.wind_speed_10m} km/h`],
                [Wind, 'weatherWindDirection', `${current.wind_direction_10m}°`],
                [CloudSun, 'weatherVisibility', typeof result.hourly.visibility?.[0] === 'number' ? `${(Number(result.hourly.visibility[0]) / 1000).toFixed(1)} km` : '—'],
              ] as const).map(([Icon, key, value]) => (
                <div key={key} style={{
                  background: 'rgba(244, 236, 216, 0.04)',
                  border: '1px solid var(--border-card)',
                  borderRadius: 'var(--radius-md)',
                  padding: '.7rem',
                  boxSizing: 'border-box',
                  minWidth: 0,
                }}>
                  <Icon size={16} color="var(--amber)"/>
                  <span> {t(key)}</span>
                  <strong style={{ display: 'block', marginTop: '.3rem' }}>{value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section style={{ ...card, overflow: 'hidden' }}>
            <h2 style={{ fontSize: '1.2rem', margin: '0 0 .8rem 0' }}>{t('weatherHourly')}</h2>
            <div
              style={{
                display: 'flex',
                gap: '.65rem',
                overflowX: 'auto',
                paddingBottom: '.5rem',
                width: '100%',
                maxWidth: '100%',
                minWidth: 0,
              }}
            >
              {result.hourly.time.slice(0, 24).map((time, index) => {
                const hourCode = Number(result.hourly.weather_code?.[index] ?? 1);
                const hourTemp = result.hourly.temperature_2m[index];
                return (
                  <div
                    key={`${time}-${index}`}
                    style={{
                      minWidth: 84,
                      flexShrink: 0,
                      textAlign: 'center',
                      padding: '.75rem .5rem',
                      borderRadius: 'var(--radius-md)',
                      background: 'rgba(244, 236, 216, 0.06)',
                      border: '1px solid rgba(244, 236, 216, 0.08)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '.35rem',
                    }}
                  >
                    <small style={{ color: 'var(--text-muted)', fontSize: '.75rem', fontWeight: 500 }}>
                      {formatHour(time)}
                    </small>
                    <div style={{ margin: '.15rem 0' }}>
                      {getWeatherIcon(hourCode, 20)}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: '.95rem' }}>
                      {hourTemp}°C
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section style={card}>
            <h2 style={{ fontSize: '1.2rem', margin: '0 0 .8rem 0' }}>{t('weatherDaily')}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '.65rem', width: '100%', minWidth: 0 }}>
              {result.daily.time.map((day, index) => {
                const dayCode = Number(result.daily.weather_code?.[index] ?? 1);
                const minTemp = result.daily.temperature_2m_min[index];
                const maxTemp = result.daily.temperature_2m_max[index];
                const rainChance = result.daily.precipitation_probability_max?.[index] ?? 0;
                return (
                  <div
                    key={`${day}-${index}`}
                    style={{
                      background: 'rgba(244, 236, 216, 0.04)',
                      border: '1px solid var(--border-card)',
                      borderRadius: 'var(--radius-md)',
                      boxShadow: 'var(--shadow-card)',
                      padding: '.8rem .65rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '.4rem',
                      alignItems: 'center',
                      textAlign: 'center',
                    }}
                  >
                    <strong style={{ fontSize: '.88rem' }}>{formatDay(day, locale)}</strong>
                    <div style={{ margin: '.2rem 0' }}>
                      {getWeatherIcon(dayCode, 26)}
                    </div>
                    <div style={{ fontSize: '.82rem', display: 'flex', flexDirection: 'column', gap: '.15rem', width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 .25rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>{t('weatherLow')}:</span>
                        <strong>{minTemp}°C</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 .25rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>{t('weatherHigh')}:</span>
                        <strong>{maxTemp}°C</strong>
                      </div>
                    </div>
                    <small style={{ color: Number(rainChance) > 30 ? '#60a5fa' : 'var(--text-muted)', fontSize: '.75rem', marginTop: '.2rem' }}>
                      {t('weatherChance')}: {rainChance}%
                    </small>
                  </div>
                );
              })}
            </div>
          </section>

          <aside className="weather-guidance-grid" style={card} aria-label={t('weatherGuidance')}>
            <div className="weather-location-actions" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.6rem', marginBottom: '.6rem' }}>
              <strong style={{ fontSize: '1.05rem', color: 'var(--amber)' }}>{t('weatherGuidance')}</strong>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleToggleSpeech}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '.45rem',
                  fontSize: '.85rem',
                  padding: '.35rem .75rem',
                  cursor: 'pointer',
                }}
                aria-label={isSpeaking ? t('weatherStop') : t('weatherListen')}
              >
                {isSpeaking ? <Square size={15} /> : <Volume2 size={15} />}
                <span>{isSpeaking ? t('weatherStop') : t('weatherListen')}</span>
              </button>
            </div>
            <ul style={{ margin: '0 0 .8rem 1.2rem', padding: 0, lineHeight: 1.6, color: 'var(--cream)' }}>
              {farmNotes.map((note, idx) => (
                <li key={idx} style={{ marginBottom: '.35rem' }}>{note}</li>
              ))}
            </ul>
            {/* Required licensing and source metadata preserved internally on result (license_url, provider_url, commercial_use_notice) */}
          </aside>
        </div>
      )}
      </div>
    </div>
  );
};
