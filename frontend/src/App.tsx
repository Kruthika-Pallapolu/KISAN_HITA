import React, { useState } from 'react';
import { LanguageProvider } from './context/LanguageContext';
import { FarmProfileProvider } from './context/FarmProfileContext';
import { AssistantProvider } from './context/AssistantContext';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { LanguageModal } from './components/LanguageModal';
import { FirstTimeWelcomeModal } from './components/FirstTimeWelcomeModal';
import { SettingsModal } from './components/SettingsModal';
import { KisanAssistantModal } from './components/KisanAssistantModal';
import { PersistentAssistantBar } from './components/PersistentAssistantBar';
import { HomePage } from './pages/HomePage';
import { WeatherPage } from './pages/WeatherPage';
import { ChooseCropPage } from './pages/ChooseCropPage';
import { CheckCropPage } from './pages/CheckCropPage';
import { MarketPricesPage } from './pages/MarketPricesPage';
import { AskKisanHitaPage } from './pages/AskKisanHitaPage';
import { HandsFreeAssistant } from './components/HandsFreeAssistant';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthPage } from './pages/AuthPage';
import { FirstVisitLanguageSelection } from './components/FirstVisitLanguageSelection';
import { ScrollScrubBackground } from './components/ScrollScrubBackground';
import { useLanguage } from './context/LanguageContext';

const resolveRouteTab = (raw: string): string | null => {
  const cleaned = raw.replace(/^#\/?/, '').replace(/^\//, '').split('?')[0].split('/')[0].trim().toLowerCase();
  if (cleaned === 'weather') return 'weather';
  if (cleaned === 'choose-crop' || cleaned === 'crop_advisor') return 'choose-crop';
  if (cleaned === 'check-crop' || cleaned === 'crop_health') return 'check-crop';
  if (cleaned === 'market-prices' || cleaned === 'market_prices') return 'market-prices';
  if (cleaned === 'ask_kisan' || cleaned === 'ask-kisan') return 'ask_kisan';
  if (cleaned === 'home' || cleaned === 'dashboard') return 'home';
  return null;
};

const getInitialTab = (): string => {
  if (typeof window === 'undefined') return 'home';
  return resolveRouteTab(window.location.hash) || resolveRouteTab(window.location.pathname) || 'home';
};

const AppContent: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<string>(getInitialTab);

  React.useEffect(() => {
    const onRouteSync = () => {
      const tab = resolveRouteTab(window.location.hash) || resolveRouteTab(window.location.pathname);
      if (tab) setCurrentTab(tab);
    };
    window.addEventListener('hashchange', onRouteSync);
    window.addEventListener('popstate', onRouteSync);
    return () => {
      window.removeEventListener('hashchange', onRouteSync);
      window.removeEventListener('popstate', onRouteSync);
    };
  }, []);

  const handleRouteFeature = (feature: string) => {
    let nextTab = 'home';
    if (feature === 'home' || feature === 'dashboard') nextTab = 'home';
    else if (feature === 'weather') nextTab = 'weather';
    else if (feature === 'crop_advisor' || feature === 'choose-crop') nextTab = 'choose-crop';
    else if (feature === 'crop_health' || feature === 'check-crop') nextTab = 'check-crop';
    else if (feature === 'market_prices' || feature === 'market-prices') nextTab = 'market-prices';
    else if (feature === 'ask_kisan') nextTab = 'ask_kisan';

    setCurrentTab(nextTab);
    if (typeof window !== 'undefined') {
      const targetHash = nextTab === 'home' ? '' : `#${nextTab}`;
      if (window.location.hash !== targetHash) {
        window.history.pushState(null, '', targetHash || window.location.pathname);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="app-shell" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* Navigation Bar */}
      <Navbar currentTab={currentTab} onSelectTab={handleRouteFeature} />

      {/* Main Page Content */}
      <main style={{ flex: 1, zIndex: 1 }}>
        {currentTab === 'home' && <HomePage onSelectTab={handleRouteFeature} />}
        {currentTab === 'weather' && <WeatherPage onNavigate={handleRouteFeature} />}
        {currentTab === 'choose-crop' && <ChooseCropPage onNavigate={handleRouteFeature} />}
        {currentTab === 'check-crop' && <CheckCropPage onNavigate={handleRouteFeature} />}
        {currentTab === 'market-prices' && <MarketPricesPage onNavigate={handleRouteFeature} />}
        {currentTab === 'ask_kisan' && <AskKisanHitaPage onRouteFeature={handleRouteFeature} onNavigate={handleRouteFeature} />}
      </main>

      {/* Central Persistent Assistant Floating Bar (Accessible on every page) */}
      <PersistentAssistantBar />
      <HandsFreeAssistant />

      {/* Central Kisan Assistant Conversational Modal */}
      <KisanAssistantModal onRouteFeature={handleRouteFeature} />

      {/* First-Visit / On-Demand Language Selection Modal */}
      <LanguageModal />

      {/* First-Time Friendly Interactive Spotlight Product Tour */}
      <FirstTimeWelcomeModal currentTab={currentTab} onNavigate={handleRouteFeature} />

      {/* Settings & Preferences Modal */}
      <SettingsModal />

      {/* Footer */}
      <Footer onSelectTab={handleRouteFeature} />
    </div>
  );
};

const AuthenticatedApp: React.FC = () => {
  const { user, isGuest, guestContextId, loading, continueAsGuest } = useAuth();
  const { hasChosenLanguage } = useLanguage();
  if (loading) return <div role="status" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'transparent', color: 'var(--cream)', position: 'relative', zIndex: 1 }}>Kisan Hita…</div>;
  if (!user && !isGuest) return hasChosenLanguage
    ? <AuthPage onContinueGuest={continueAsGuest} />
    : <FirstVisitLanguageSelection />;
  return <FarmProfileProvider isGuest={isGuest} guestContextId={guestContextId}><AssistantProvider isGuest={isGuest} guestContextId={guestContextId}><AppContent /></AssistantProvider></FarmProfileProvider>;
};

export const App: React.FC = () => {
  return (
    <LanguageProvider>
      <AuthProvider>
        <div style={{ minHeight: '100vh', position: 'relative' }}>
          <ScrollScrubBackground />
          <AuthenticatedApp />
        </div>
      </AuthProvider>
    </LanguageProvider>
  );
};

export default App;

