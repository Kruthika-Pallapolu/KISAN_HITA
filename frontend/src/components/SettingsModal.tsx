import React, { useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useFarmProfile } from '../context/FarmProfileContext';
import { useAssistant } from '../context/AssistantContext';
import { SupportedLanguage } from '../i18n/translations';
import { Settings, X, Check, HelpCircle } from 'lucide-react';
import { ONBOARDING_COPY } from '../i18n/onboardingCopy';
import { localizeSoil, localizeWater } from '../i18n/agriculture';
import { FarmLocationFields } from './FarmLocationFields';
import { getState, getStateForDistrict } from '../services/geography';
import { buildDefaultWakePhrase, getWakePreferences, saveWakePreferences } from '../services/wakeWord';

const GUEST_SETTINGS_COPY: Record<SupportedLanguage, { notice: string; end: string }> = {
  en: { notice: 'Guest settings last for this browser session. Guest access expires after 24 hours.', end: 'End guest session' },
  te: { notice: 'అతిథి సెట్టింగ్‌లు ఈ బ్రౌజర్ సెషన్ వరకు ఉంటాయి. అతిథి ప్రవేశం 24 గంటల తర్వాత ముగుస్తుంది.', end: 'అతిథి సెషన్ ముగించండి' },
  hi: { notice: 'अतिथि सेटिंग इस ब्राउज़र सत्र तक रहेंगी। अतिथि प्रवेश 24 घंटे बाद समाप्त होगा।', end: 'अतिथि सत्र समाप्त करें' },
  ta: { notice: 'விருந்தினர் அமைப்புகள் இந்த உலாவி அமர்வு வரை இருக்கும். விருந்தினர் அணுகல் 24 மணிநேரத்தில் முடியும்.', end: 'விருந்தினர் அமர்வை முடிக்கவும்' },
  kn: { notice: 'ಅತಿಥಿ ಸೆಟ್ಟಿಂಗ್‌ಗಳು ಈ ಬ್ರೌಸರ್ ಸೆಷನ್‌ವರೆಗೆ ಇರುತ್ತವೆ. ಅತಿಥಿ ಪ್ರವೇಶ 24 ಗಂಟೆಗಳ ನಂತರ ಮುಗಿಯುತ್ತದೆ.', end: 'ಅತಿಥಿ ಸೆಷನ್ ಅಂತ್ಯಗೊಳಿಸಿ' },
  ml: { notice: 'അതിഥി ക്രമീകരണങ്ങൾ ഈ ബ്രൗസർ സെഷൻ വരെ നിലനിൽക്കും. അതിഥി പ്രവേശനം 24 മണിക്കൂറിന് ശേഷം അവസാനിക്കും.', end: 'അതിഥി സെഷൻ അവസാനിപ്പിക്കുക' },
  mr: { notice: 'अतिथी सेटिंग्ज या ब्राउझर सत्रापुरत्या राहतील. अतिथी प्रवेश २४ तासांनी संपेल.', end: 'अतिथी सत्र समाप्त करा' },
};

export const SettingsModal: React.FC = () => {
  const { t, language, setLanguage, languages } = useLanguage();
  const { user, isGuest, signOut } = useAuth();
  const { profile, updateProfile, showSettingsModal, setShowSettingsModal } = useFarmProfile();
  const { setAssistantName: updateAssistantName } = useAssistant();

  const [state, setState] = useState(getState(profile.state)?.name || getStateForDistrict(profile.district)?.name || '');
  const [district, setDistrict] = useState(profile.district);
  const [village, setVillage] = useState(profile.village);
  const [soilType, setSoilType] = useState(profile.soilType);
  const [waterSource, setWaterSource] = useState(profile.waterSource);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [wakeName, setWakeName] = useState(() => getWakePreferences().name);

  useEffect(() => {
    const open = () => setShowSettingsModal(true);
    window.addEventListener('kisan-hita:open-settings', open);
    return () => window.removeEventListener('kisan-hita:open-settings', open);
  }, [setShowSettingsModal]);

  useEffect(() => {
    const handleSync = () => {
      setWakeName(getWakePreferences(localStorage, language).name);
    };
    window.addEventListener('kisan-hita:wake-preferences-updated', handleSync);
    return () => {
      window.removeEventListener('kisan-hita:wake-preferences-updated', handleSync);
    };
  }, [language]);

  useEffect(() => {
    if (!showSettingsModal) return;
    setState(getState(profile.state)?.name || getStateForDistrict(profile.district)?.name || '');
    setDistrict(profile.district);
    setVillage(profile.village);
    setSoilType(profile.soilType);
    setWaterSource(profile.waterSource);
    setWakeName(getWakePreferences(localStorage, language).name);
  }, [showSettingsModal, profile, language]);

  if (!showSettingsModal) return null;

  const handleWakeNameChange = (nameInput: string) => {
    setWakeName(nameInput);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile({
      state,
      district,
      village,
      soilType,
      waterSource,
    });
    if (updateAssistantName) {
      updateAssistantName(wakeName);
    } else {
      saveWakePreferences(wakeName, wakeName, localStorage, language);
    }
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      setShowSettingsModal(false);
    }, 800);
  };

  return (
    <div className="cinematic-modal-overlay" style={{
      position: 'fixed',
      inset: 0,
      zIndex: 100,
      background: 'rgba(10, 11, 7, 0.85)',
      backdropFilter: 'blur(10px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem'
    }}>
      <div className="cinematic-modal-surface" style={{
        background: 'var(--char-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        maxWidth: '540px',
        width: '100%',
        padding: '2rem',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)',
        position: 'relative',
        maxHeight: '90vh',
        overflowY: 'auto'
      }}>
        <button
          onClick={() => setShowSettingsModal(false)}
          style={{
            position: 'absolute',
            top: '1.2rem',
            right: '1.2rem',
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer'
          }}
        >
          <X size={20} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.5rem' }}>
          <Settings size={22} style={{ color: 'var(--amber)' }} />
          <h2 style={{ fontSize: '1.35rem' }}>{t('settingsTitle')}</h2>
        </div>

        {user && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.7rem', marginBottom: '1rem', padding: '.65rem .8rem', border: '1px solid var(--border-card)', borderRadius: '.75rem', color: 'var(--text-muted)', fontSize: '.78rem' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</span>
          <button type="button" onClick={() => void signOut()} style={{ flexShrink: 0, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-full)', padding: '.35rem .7rem', color: 'var(--cream)', background: 'transparent', cursor: 'pointer' }}>{t('authSignOut')}</button>
        </div>}
        {isGuest && <div role="note" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.7rem', marginBottom: '1rem', padding: '.65rem .8rem', border: '1px solid var(--border-card)', borderRadius: '.75rem', color: 'var(--text-muted)', fontSize: '.78rem' }}>
          <span>{GUEST_SETTINGS_COPY[language].notice}</span>
          <button type="button" onClick={() => void signOut()} style={{ flexShrink: 0, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-full)', padding: '.45rem .7rem', color: 'var(--cream)', background: 'transparent', cursor: 'pointer' }}>{GUEST_SETTINGS_COPY[language].end}</button>
        </div>}

        <form onSubmit={handleSave}>
          <section style={{ margin: '1rem 0', padding: '1rem', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)' }}>
            <h3 style={{ marginTop: 0 }}>{t('handsFreeTitle')}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '.84rem' }}>{t('handsFreeDescription')}</p>
            {/* The assistant name (handsFreeName) and wake phrase (handsFreePhrase) are identical */}
            <label className="input-label">
              {t('handsFreeName')}
              <input
                className="input-field"
                value={wakeName}
                maxLength={40}
                onChange={(event) => handleWakeNameChange(event.target.value)}
              />
            </label>
            <small style={{ color: 'var(--text-muted)', display: 'block', margin: '0.4rem 0' }}>
              The assistant name you enter is the exact wake phrase used to activate hands-free mode. Speak this exact name to start.
            </small>
            <small style={{ color: 'var(--text-muted)' }}>{t('handsFreePrivacy')}</small>
          </section>
          {/* Language Selection */}
          <div className="input-group">
            <label className="input-label">{t('languageSelect')}</label>
            <select
              className="select-field"
              value={language}
              onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
            >
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.nativeName} ({l.name})
                </option>
              ))}
            </select>
          </div>

          {/* State-first farm location */}
          <div className="input-group">
            <label className="input-label">{t('farmLocation')}</label>
            <FarmLocationFields
              state={state}
              district={district}
              onChange={(nextState, nextDistrict) => { setState(nextState); setDistrict(nextDistrict); }}
            />
          </div>

          {/* Soil Type */}
          <div className="input-group">
            <label className="input-label">{t('soilType')}</label>
            <select
              className="select-field"
              value={soilType}
              onChange={(e) => setSoilType(e.target.value)}
            >
              {['Black Cotton Soil', 'Red Soil', 'Sandy Soil', 'Loamy Soil', 'Clay Soil'].map((soil) => <option key={soil} value={soil}>{localizeSoil(soil, language)}</option>)}
            </select>
          </div>

          {/* Water Source */}
          <div className="input-group">
            <label className="input-label">{t('waterAvailability')}</label>
            <select
              className="select-field"
              value={waterSource}
              onChange={(e) => setWaterSource(e.target.value)}
            >
              {['Good irrigation', 'Limited irrigation', 'Rain-dependent'].map((water) => <option key={water} value={water}>{localizeWater(water, language)}</option>)}
            </select>
          </div>

          {/* Website Guide Trigger */}
          <div style={{ marginTop: '1.2rem' }}>
            <button
              type="button"
              onClick={() => {
                setShowSettingsModal(false);
                window.dispatchEvent(new CustomEvent('kisan-hita:open-onboarding'));
              }}
              className="btn btn-secondary"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '0.75rem',
                fontSize: '0.88rem',
              }}
            >
              <HelpCircle size={17} style={{ color: 'var(--amber)' }} />
              <span>{ONBOARDING_COPY[language]?.viewGuide || 'View Website Guide'}</span>
            </button>
          </div>

          <div style={{ marginTop: '1.2rem', display: 'flex', gap: '1rem' }}>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ flex: 1, padding: '0.85rem' }}
            >
              {savedSuccess ? (
                <>
                  <Check size={18} /> {t('saveComplete')}
                </>
              ) : (
                t('savePreferences')
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

