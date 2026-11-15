import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useAssistant } from '../context/AssistantContext';
import { saveWakePreferences } from '../services/wakeWord';
import {
  X,
  ChevronRight,
  ChevronLeft,
  Bot,
  Sprout,
  ShieldAlert,
  CloudSun,
  TrendingUp,
  Settings,
  Sparkles,
  Check,
} from 'lucide-react';

export const ONBOARDING_COMPLETED_KEY = 'kisan_hita_onboarding_completed_v1';
export const LEGACY_INTRO_SEEN_KEY = 'kisan_hita_intro_seen';

export interface FirstTimeWelcomeModalProps {
  currentTab?: string;
  onNavigate?: (tab: string) => void;
}

interface FeatureItem {
  iconType: 'crop' | 'health' | 'weather' | 'market' | 'assistant';
  title: string;
  desc: string;
}

interface SlideCopy {
  stepIndicator: (current: number, total: number) => string;
  close: string;
  back: string;
  next: string;
  finish: string;
  skip: string;
  continueBtn: string;
  getStartedBtn: string;
  handsFreeOptional: string;
  openSettingsText: string;
  slide1: {
    badge: string;
    title: string;
    subtitle: string;
    assistantTitle: string;
    assistantDesc: string;
    nameLabel: string;
    namePlaceholder: string;
  };
  slide2: {
    badge: string;
    title: string;
    subtitle: string;
    features: FeatureItem[];
  };
}

const ONBOARDING_TWO_SLIDES_COPY: Record<string, SlideCopy> = {
  en: {
    stepIndicator: (c, t) => `Step ${c} of ${t}`,
    close: 'Close',
    back: 'Back',
    next: 'Continue',
    finish: 'Get Started',
    skip: 'Close',
    continueBtn: 'Continue',
    getStartedBtn: 'Get Started',
    handsFreeOptional: 'Hands-free voice advice is completely optional. Microphone permission is never requested automatically.',
    openSettingsText: 'Settings',
    slide1: {
      badge: 'Welcome to Kisan Hita',
      title: 'Welcome to Kisan Hita 🙏',
      subtitle: 'Your intelligent agricultural companion for crop planning, plant health diagnosis, local weather advisories, and mandi price trends.',
      assistantTitle: 'Meet Mitra — Your AI Farm Assistant 🤖',
      assistantDesc: 'Get 24/7 agricultural advice anytime. Ask questions by voice or text in your preferred language.',
      nameLabel: 'Personalize your assistant’s name (default: Mitra):',
      namePlaceholder: 'Mitra',
    },
    slide2: {
      badge: 'Overview',
      title: 'Meet Your Features 🌾',
      subtitle: 'Simple, powerful farming tools designed to help you at every stage of cultivation:',
      features: [
        {
          iconType: 'crop',
          title: 'Choose Crop',
          desc: 'Plan high-yielding crops tailored to your soil, water source, and current season.',
        },
        {
          iconType: 'health',
          title: 'Check Crop',
          desc: 'Diagnose leaf pests and plant diseases quickly with safe, practical remedies.',
        },
        {
          iconType: 'weather',
          title: 'Local Weather',
          desc: 'Review rain forecasts, spray suitability, and farm advisories before field operations.',
        },
        {
          iconType: 'market',
          title: 'Market Prices',
          desc: 'Track estimated DEMO mandi prices and trends; always confirm with local officer or KVK before selling.',
        },
        {
          iconType: 'assistant',
          title: 'Mitra Assistant',
          desc: 'Ask your digital companion any farming questions 24/7 hands-free.',
        },
      ],
    },
  },
  te: {
    stepIndicator: (c, t) => `${c} / ${t} దశ`,
    close: 'మూసివేయి',
    back: 'వెనుకకు',
    next: 'ముందుకు సాగండి',
    finish: 'ప్రారంభించండి',
    skip: 'మూసివేయి',
    continueBtn: 'ముందుకు సాగండి',
    getStartedBtn: 'ప్రారంభించండి',
    handsFreeOptional: 'వాయిస్ సహాయం పూర్తిగా ఐచ్ఛికం. మైక్రోఫోన్ అనుమతి దానంతటదే ఎన్నడూ అడగబడదు.',
    openSettingsText: 'సెట్టింగ్స్',
    slide1: {
      badge: 'కిసాన్ హిత స్వాగతం',
      title: 'కిసాన్ హితకు స్వాగతం 🙏',
      subtitle: 'పంట ప్రణాళిక, తెగుళ్ల నివారణ, స్థానిక వాతావరణం మరియు మార్కెట్ ధరల కోసం మీ నమ్మకమైన డిజిటల్ వ్యవసాయ తోడు.',
      assistantTitle: 'మీ ఏఐ వ్యవసాయ సహాయకుడు మిత్ర (Mitra) ను కలవండి 🤖',
      assistantDesc: '24/7 వ్యవసాయ సలహాలను వాయిస్ లేదా టెక్స్ట్ ద్వారా ఎప్పుడైనా మీ భాషలోనే పొందండి.',
      nameLabel: 'సహాయకుడి పేరు (డిఫాల్ట్: Mitra):',
      namePlaceholder: 'Mitra',
    },
    slide2: {
      badge: 'సేవలు',
      title: 'సేవలను తెలుసుకుందాం 🌾',
      subtitle: 'రైతులకు ప్రతి దశలో తోడ్పడే ముఖ్యమైన వ్యవసాయ సాధనాలు:',
      features: [
        {
          iconType: 'crop',
          title: 'పంట ఎంపిక',
          desc: 'మీ నేల రకం, నీరు మరియు సీజన్ ఆధారంగా అధిక దిగుబడినిచ్చే పంటలను ఎంచుకోండి.',
        },
        {
          iconType: 'health',
          title: 'పంట ఆరోగ్యం',
          desc: 'పంట ఆకుల తెగుళ్లను గుర్తించి సమగ్ర సురక్షిత నివారణ చర్యలను తెలుసుకోండి.',
        },
        {
          iconType: 'weather',
          title: 'స్థానిక వాతావరణం',
          desc: 'పనులకు ముందు వర్ష సూచనలు, పిచికారీ అనుకూలత మరియు వ్యవసాయ సూచనలను గమనించండి.',
        },
        {
          iconType: 'market',
          title: 'మార్కెట్ ధరలు',
          desc: 'అంచనా DEMO మార్కెట్ ధరలు; విక్రయించే ముందు స్థానిక వ్యవసాయ అధికారి లేదా KVK ను సంప్రదించండి.',
        },
        {
          iconType: 'assistant',
          title: 'మిత్ర సహాయకుడు',
          desc: 'మీ వ్యవసాయ సందేహాలను ఎప్పుడైనా మిత్ర సహాయకుడిని అడిగి తెలుసుకోండి.',
        },
      ],
    },
  },
  hi: {
    stepIndicator: (c, t) => `चरण ${c} / ${t}`,
    close: 'बंद करें',
    back: 'पीछे',
    next: 'आगे बढ़ें',
    finish: 'शुरू करें',
    skip: 'बंद करें',
    continueBtn: 'आगे बढ़ें',
    getStartedBtn: 'शुरू करें',
    handsFreeOptional: 'वॉइस सहायक पूर्णतः ऐच्छिक है। माइक्रोफ़ोन अनुमति कभी अपने आप नहीं मांगी जाती।',
    openSettingsText: 'सेटिंग्स',
    slide1: {
      badge: 'किसान हिता में स्वागत',
      title: 'किसान हिता में आपका स्वागत है 🙏',
      subtitle: 'फसल योजना, कीट एवं रोग निदान, स्थानीय मौसम और मंडी भाव के लिए आपका विश्वसनीय डिजिटल कृषि साथी।',
      assistantTitle: 'मिलिए मित्रा (Mitra) से — आपका एआई कृषि सहायक 🤖',
      assistantDesc: '24/7 कृषि सलाह किसी भी समय अपनी भाषा में बोलकर या लिखकर प्राप्त करें।',
      nameLabel: 'सहायक का नाम (डिफ़ॉल्ट: Mitra):',
      namePlaceholder: 'Mitra',
    },
    slide2: {
      badge: 'सुविधाएँ',
      title: 'मुख्य कृषि सुविधाएँ 🌾',
      subtitle: 'प्रत्येक किसान के लिए तैयार किए गए सरल व उपयोगी टूल्स:',
      features: [
        {
          iconType: 'crop',
          title: 'फसल चयन',
          desc: 'मिट्टी, पानी और मौसम के अनुसार उत्तम उपज देने वाली फसलें चुनें।',
        },
        {
          iconType: 'health',
          title: 'फसल स्वास्थ्य',
          desc: 'पत्तियों के रोग पहचानें और सुरक्षित उपचार जानें।',
        },
        {
          iconType: 'weather',
          title: 'स्थानीय मौसम',
          desc: 'खेत में काम से पहले बारिश का पूर्वानुमान और छिड़काव सलाह देखें।',
        },
        {
          iconType: 'market',
          title: 'मंडी भाव',
          desc: 'अनुमानित DEMO मंडी भाव देखें; बिक्री से पहले स्थानीय कृषि अधिकारी या KVK से सलाह लें।',
        },
        {
          iconType: 'assistant',
          title: 'मित्रा सहायक',
          desc: 'खेती से जुड़े सवाल कभी भी बोलकर अपने मित्रा सहायक से पूछें।',
        },
      ],
    },
  },
  ta: {
    stepIndicator: (c, t) => `படி ${c} / ${t}`,
    close: 'மூடு',
    back: 'பின்செல்',
    next: 'தொடரவும்',
    finish: 'தொடங்குங்கள்',
    skip: 'மூடு',
    continueBtn: 'தொடரவும்',
    getStartedBtn: 'தொடங்குங்கள்',
    handsFreeOptional: 'குரல் உதவி முற்றிலும் விருப்பமானது. மைக்ரோஃபோன் அனுமதி தானாகக் கேட்கப்படாது.',
    openSettingsText: 'அமைப்புகள்',
    slide1: {
      badge: 'நல்வரவு',
      title: 'கிசான் ஹிதாவிற்கு நல்வரவு 🙏',
      subtitle: 'பயிர் திட்டம், நோய் கண்டறிதல், உள்ளூர் வானிலை மற்றும் சந்தை விலைகளுக்கான உங்கள் AI வழிகாட்டி.',
      assistantTitle: 'மித்ரா (Mitra)-வை சந்தியுங்கள் — உங்கள் AI உதவியாளர் 🤖',
      assistantDesc: '24/7 விவசாய ஆலோசனைகளை உங்கள் மொழியிலேயே எந்நேரமும் பெறுங்கள்.',
      nameLabel: 'உதவியாளரின் பெயர் (இயல்புநிலை: Mitra):',
      namePlaceholder: 'Mitra',
    },
    slide2: {
      badge: 'வசதிகள்',
      title: 'முக்கிய வசதிகள் 🌾',
      subtitle: 'விவசாயிகளுக்காக வடிவமைக்கப்பட்ட எளிய மற்றும் பயனுள்ள கருவிகள்:',
      features: [
        {
          iconType: 'crop',
          title: 'பயிர் தேர்வு',
          desc: 'மண் மற்றும் பருவநிலைக்கு ஏற்ற சிறந்த பயிர்களைத் தேர்வு செய்யுங்கள்.',
        },
        {
          iconType: 'health',
          title: 'பயிர் நலம்',
          desc: 'பயிர் நோய்களைக் கண்டறிந்து பாதுகாப்பான தீர்வு பெறுங்கள்.',
        },
        {
          iconType: 'weather',
          title: 'உள்ளூர் வானிலை',
          desc: 'மழை முன்னறிவிப்பு மற்றும் தெளிப்பு ஆலோசனைகளை முன்கூட்டியே சரிபார்க்கவும்.',
        },
        {
          iconType: 'market',
          title: 'சந்தை விலைகள்',
          desc: 'மாதிரி DEMO மண்டி விலைகள்; விற்பனைக்கு முன் வேளாண் அதிகாரி அல்லது KVK-ஐ அணுகவும்.',
        },
        {
          iconType: 'assistant',
          title: 'மித்ரா உதவியாளர்',
          desc: 'விவசாயக் கேள்விகளுக்கு எந்நேரமும் மித்ரா உதவியாளரிடம் விடை பெறுங்கள்.',
        },
      ],
    },
  },
  kn: {
    stepIndicator: (c, t) => `ಹಂತ ${c} / ${t}`,
    close: 'ಮುಚ್ಚಿ',
    back: 'ಹಿಂದೆ',
    next: 'ಮುಂದುವರಿಯಿರಿ',
    finish: 'ಪ್ರಾರಂಭಿಸಿ',
    skip: 'ಮುಚ್ಚಿ',
    continueBtn: 'ಮುಂದುವರಿಯಿರಿ',
    getStartedBtn: 'ಪ್ರಾರಂಭಿಸಿ',
    handsFreeOptional: 'ಧ್ವನಿ ಸಹಾಯ ಐಚ್ಛಿಕ. ಮೈಕ್ರೊಫೋನ್ ಅನುಮತಿ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಕೇಳಲಾಗುವುದಿಲ್ಲ.',
    openSettingsText: 'ಸೆಟ್ಟಿಂಗ್ಸ್',
    slide1: {
      badge: 'ಸುಸ್ವಾಗತ',
      title: 'ಕಿಸಾನ್ ಹಿತಾಗೆ ಸುಸ್ವಾಗತ 🙏',
      subtitle: 'ಬೆಳೆ ಯೋಜನೆ, ರೋಗ ಪತ್ತೆ, ಸ್ಥಳೀಯ ಹವಾಮಾನ ಮತ್ತು ಮಾರುಕಟ್ಟೆ ಬೆಲೆಗಳ ನಿಮ್ಮ ವಿಶ್ವಾಸಾರ್ಹ ಡಿಜಿಟಲ್ ಕೃಷಿ ಮಾರ್ಗದರ್ಶಿ.',
      assistantTitle: 'ಮಿತ್ರ (Mitra) ನನ್ನು ಭೇಟಿ ಮಾಡಿ — ನಿಮ್ಮ ಎಐ ಸಹಾಯಕ 🤖',
      assistantDesc: '24/7 ಕೃಷಿ ಸಲಹೆಗಳನ್ನು ಧ್ವನಿ ಅಥವಾ ಪಠ್ಯದ ಮೂಲಕ ಯಾವುದೇ ಸಮಯದಲ್ಲಿ ನಿಮ್ಮ ಭಾಷೆಯಲ್ಲಿ ಪಡೆಯಿರಿ.',
      nameLabel: 'ಸಹಾಯಕನ ಹೆಸರು (ಡೀಫಾಲ್ಟ್: Mitra):',
      namePlaceholder: 'Mitra',
    },
    slide2: {
      badge: 'ಸೌಲಭ್ಯಗಳು',
      title: 'ಪ್ರಮುಖ ಸೌಲಭ್ಯಗಳು 🌾',
      subtitle: 'ರೈತರಿಗಾಗಿ ವಿನ್ಯಾಸಗೊಳಿಸಲಾದ ಸರಳ ಮತ್ತು ಉಪಯುಕ್ತ ಸೌಲಭ್ಯಗಳು:',
      features: [
        {
          iconType: 'crop',
          title: 'ಬೆಳೆ ಆಯ್ಕೆ',
          desc: 'ಮಣ್ಣು ಮತ್ತು ಋತುವಿಗೆ ಸೂಕ್ತವಾದ ಉತ್ತಮ ಇಳುವರಿ ಬೆಳೆಗಳನ್ನು ಆರಿಸಿ.',
        },
        {
          iconType: 'health',
          title: 'ಬೆಳೆ ಆರೋಗ್ಯ',
          desc: 'ಬೆಳೆ ರೋಗಗಳನ್ನು ಸುಲಭವಾಗಿ ಗುರುತಿಸಿ ಸೂಕ್ತ ಪರಿಹಾರ ಕಂಡುಕೊಳ್ಳಿ.',
        },
        {
          iconType: 'weather',
          title: 'ಸ್ಥಳೀಯ ಹವಾಮಾನ',
          desc: 'ಹೊಲದ ಕೆಲಸಕ್ಕೆ ಮುನ್ನ ಮಳೆ ಮುನ್ಸೂಚನೆ ಮತ್ತು ಸಿಂಪರಣೆ ಸಲಹೆ ಪಡೆಯಿರಿ.',
        },
        {
          iconType: 'market',
          title: 'ಮಾರುಕಟ್ಟೆ ಬೆಲೆಗಳು',
          desc: 'ಅಂದಾಜು DEMO ಮಂಡಿ ದರಗಳು; ಮಾರಾಟಕ್ಕೆ ಮುನ್ನ ಕೃಷಿ ಅಧಿಕಾರಿ ಅಥವಾ KVK ಸಂಪರ್ಕಿಸಿ.',
        },
        {
          iconType: 'assistant',
          title: 'ಮಿತ್ರ ಸಹಾಯಕ',
          desc: 'ಕೃಷಿ ಪ್ರಶ್ನೆಗಳಿಗೆ ಯಾವುದೇ ಸಮಯದಲ್ಲಿ ಮಿತ್ರ ಸಹಾಯಕನಿಂದ ಉತ್ತರ ಪಡೆಯಿರಿ.',
        },
      ],
    },
  },
  ml: {
    stepIndicator: (c, t) => `ഘട്ടം ${c} / ${t}`,
    close: 'അടയ്ക്കുക',
    back: 'തിരികെ',
    next: 'തുടരുക',
    finish: 'തുടങ്ങുക',
    skip: 'അടയ്ക്കുക',
    continueBtn: 'തുടരുക',
    getStartedBtn: 'തുടങ്ങുക',
    handsFreeOptional: 'വോയ്‌സ് സഹായം പൂർണ്ണമായും ഐച്ഛികമാണ്. മൈക്രോഫോൺ അനുമതി സ്വയമേവ ചോദിക്കില്ല.',
    openSettingsText: 'ക്രമീകരണങ്ങൾ',
    slide1: {
      badge: 'സ്വാഗതം',
      title: 'കിസാൻ ഹിതയിലേക്ക് സ്വാഗതം 🙏',
      subtitle: 'വിള ആസൂത്രണം, രോഗനിർണ്ണയം, കാലാവസ്ഥ, വിപണി വിലകൾ എന്നിവയ്ക്കുള്ള ഡിജിറ്റൽ കാർഷിക കൂട്ടുകാരൻ.',
      assistantTitle: 'മിത്രയെ (Mitra) പരിചയപ്പെടൂ — നിങ്ങളുടെ എഐ സഹായി 🤖',
      assistantDesc: '24/7 കാർഷിക ഉപദേശം ഏതുസമയത്തും ശബ്ദത്തിലൂടെയോ ടെക്സ്റ്റിലൂടെയോ സ്വന്തം ഭാഷയിൽ നേടാം.',
      nameLabel: 'അസിസ്റ്റന്റിന്റെ പേര് (സ്ഥിരസ്ഥിതി: Mitra):',
      namePlaceholder: 'Mitra',
    },
    slide2: {
      badge: 'ഫീച്ചറുകൾ',
      title: 'പ്രധാന ഫീച്ചറുകൾ 🌾',
      subtitle: 'കർഷകർക്കായി രൂപകൽപ്പന ചെയ്ത ലളിതമായ കാർഷിക ടൂളുകൾ:',
      features: [
        {
          iconType: 'crop',
          title: 'വിള തിരഞ്ഞെടുപ്പ്',
          desc: 'മണ്ണും കാലാവസ്ഥയും അനുസരിച്ച് മികച്ച വിളകൾ തിരഞ്ഞെടുക്കുക.',
        },
        {
          iconType: 'health',
          title: 'വിള ആരോഗ്യം',
          desc: 'വിള രോഗങ്ങൾ തിരിച്ചറിഞ്ഞ് സുരക്ഷിതമായ പ്രതിവിധികൾ നേടുക.',
        },
        {
          iconType: 'weather',
          title: 'പ്രാദേശിക കാലാവസ്ഥ',
          desc: 'മഴ മുന്നറിയിപ്പുകളും കാർഷിക നിർദ്ദേശങ്ങളും മുൻകൂട്ടി അറിയുക.',
        },
        {
          iconType: 'market',
          title: 'വിപണി വിലകൾ',
          desc: 'മാതൃകാ DEMO വിപണി വിലകൾ; വിൽപനയ്ക്ക് മുൻപ് കൃഷി ഓഫീസറുമായോ KVK-യുമായോ ആലോചിക്കുക.',
        },
        {
          iconType: 'assistant',
          title: 'മിത്ര സഹായി',
          desc: 'കാർഷിക സംശയങ്ങൾക്ക് ഏതുസമയത്തും മിത്രയോട് ചോദിക്കാം.',
        },
      ],
    },
  },
  mr: {
    stepIndicator: (c, t) => `टप्पा ${c} / ${t}`,
    close: 'बंद करा',
    back: 'मागे',
    next: 'पुढे चला',
    finish: 'सुरू करा',
    skip: 'बंद करा',
    continueBtn: 'पुढे चला',
    getStartedBtn: 'सुरू करा',
    handsFreeOptional: 'व्हॉइस सहाय्य पूर्णपणे ऐच्छिक आहे. मायक्रोफोन परवानगी आपोआप मागितली जात नाही.',
    openSettingsText: 'सेटिंग्ज',
    slide1: {
      badge: 'स्वागत',
      title: 'किसान हिता मध्ये आपले स्वागत आहे 🙏',
      subtitle: 'पीक नियोजन, रोग निदान, स्थानिक हवामान आणि बाजारभावासाठी तुमचा विश्वासू डिजिटल शेती सहकारी.',
      assistantTitle: 'भेटा मित्राला (Mitra) — तुमचा एआई शेती सहकारी 🤖',
      assistantDesc: '२४/७ शेती सल्ला कधीही आपल्या भाषेत बोलून किंवा लिहून मिळवा.',
      nameLabel: 'सहाय्यकाचे नाव (डिफ़ॉल्ट: Mitra):',
      namePlaceholder: 'Mitra',
    },
    slide2: {
      badge: 'सुविधा',
      title: 'प्रमुख शेती सुविधा 🌾',
      subtitle: 'प्रत्येक शेतकऱ्यासाठी डिझाइन केलेल्या उपयुक्त शेती सुविधा:',
      features: [
        {
          iconType: 'crop',
          title: 'पीक निवड',
          desc: 'माती आणि हंगामानुसार अधिक उत्पादनासाठी योग्य पीक निवडा.',
        },
        {
          iconType: 'health',
          title: 'पीक आरोग्य',
          desc: 'पिकांवरील रोग ओळखून सुरक्षित उपाय जाणून घ्या.',
        },
        {
          iconType: 'weather',
          title: 'स्थानिक हवामान',
          desc: 'शेतातील कामांपूर्वी पावसाचा अंदाज आणि फवारणीचे सल्ले तपासा.',
        },
        {
          iconType: 'market',
          title: 'बाजारभाव',
          desc: 'अंदाजित DEMO बाजारभाव; विक्रीपूर्वी कृषी अधिकारी किंवा KVK चा सल्ला घ्या.',
        },
        {
          iconType: 'assistant',
          title: 'मित्रा सहाय्यक',
          desc: 'शेतीविषयक कोणत्याही प्रश्नांची उत्तरे मित्रा सहाय्यकाकडून कधीही मिळवा.',
        },
      ],
    },
  },
};

export const FirstTimeWelcomeModal: React.FC<FirstTimeWelcomeModalProps> = ({
  currentTab = 'home',
  onNavigate,
}) => {
  const { language, showLanguageModal } = useLanguage();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [step, setStep] = useState<number>(0);
  const slide = step;
  const setSlide = setStep;
  const { setAssistantName: updateAssistantName } = useAssistant();

  // Preserve existing assistant name and never overwrite with defaults
  const [customAssistantName, setCustomAssistantName] = useState<string>(() => {
    try {
      const existing =
        localStorage.getItem('kisan_hita_wake_name') ||
        (typeof window !== 'undefined' ? window.sessionStorage?.getItem('kisan_hita_wake_name') : null);
      if (existing && existing.trim()) return existing.trim();
    } catch {}
    return 'Mitra';
  });

  const modalRef = useRef<HTMLDivElement>(null);

  // Sync assistant name if updated externally
  useEffect(() => {
    const handleSync = () => {
      try {
        const stored =
          localStorage.getItem('kisan_hita_wake_name') ||
          (typeof window !== 'undefined' ? window.sessionStorage?.getItem('kisan_hita_wake_name') : null);
        if (stored && stored.trim()) {
          setCustomAssistantName(stored.trim());
        }
      } catch {}
    };
    window.addEventListener('kisan-hita:wake-preferences-updated', handleSync);
    window.addEventListener('storage', handleSync);
    return () => {
      window.removeEventListener('kisan-hita:wake-preferences-updated', handleSync);
      window.removeEventListener('storage', handleSync);
    };
  }, []);

  const handleNameChange = (newName: string) => {
    setCustomAssistantName(newName);
    if (updateAssistantName) {
      updateAssistantName(newName);
    } else {
      saveWakePreferences(newName, newName, localStorage, language);
    }
  };

  // Check initial first-time entry
  useEffect(() => {
    const completed =
      localStorage.getItem(ONBOARDING_COMPLETED_KEY) ||
      localStorage.getItem(LEGACY_INTRO_SEEN_KEY);
    if (!completed && !showLanguageModal) {
      setIsOpen(true);
      setStep(0);
    }
  }, [showLanguageModal]);

  // Listen for manual request to reopen/replay the onboarding product tour
  useEffect(() => {
    const handleOpenGuide = () => {
      setStep(0);
      setIsOpen(true);
    };

    window.addEventListener('kisan-hita:open-onboarding', handleOpenGuide);
    return () => {
      window.removeEventListener('kisan-hita:open-onboarding', handleOpenGuide);
    };
  }, []);

  const copy = ONBOARDING_TWO_SLIDES_COPY[language] || ONBOARDING_TWO_SLIDES_COPY['en'];
  const totalSlides = 2;

  const handleDismiss = useCallback(() => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
    localStorage.setItem(LEGACY_INTRO_SEEN_KEY, 'true');
    if (updateAssistantName && customAssistantName) {
      updateAssistantName(customAssistantName);
    }
    setIsOpen(false);
    if (onNavigate) {
      onNavigate('home');
    }
  }, [updateAssistantName, customAssistantName, onNavigate]);

  const handleNext = useCallback(() => {
    if (slide < totalSlides - 1) {
      setSlide(slide + 1);
    } else {
      handleDismiss();
    }
  }, [slide, totalSlides, handleDismiss]);

  const handleBack = useCallback(() => {
    if (slide > 0) {
      setSlide(slide - 1);
    }
  }, [slide]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleDismiss();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleBack();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleDismiss, handleNext, handleBack]);

  // Focus management
  useEffect(() => {
    if (isOpen && modalRef.current) {
      modalRef.current.focus();
    }
  }, [isOpen, slide]);

  if (!isOpen) return null;

  const renderFeatureIcon = (type: FeatureItem['iconType']) => {
    const size = 18;
    switch (type) {
      case 'crop':
        return <Sprout size={size} style={{ color: 'var(--amber)' }} />;
      case 'health':
        return <ShieldAlert size={size} style={{ color: '#6ee7b7' }} />;
      case 'weather':
        return <CloudSun size={size} style={{ color: '#60a5fa' }} />;
      case 'market':
        return <TrendingUp size={size} style={{ color: '#fbbf24' }} />;
      case 'assistant':
        return <Bot size={size} style={{ color: 'var(--amber)' }} />;
      default:
        return <Sparkles size={size} style={{ color: 'var(--amber)' }} />;
    }
  };

  return (
    <div
      className="interactive-tour-container"
      role="region"
      aria-label="Kisan Hita Onboarding"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        background: 'rgba(10, 11, 7, 0.82)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      {/* Centered Modal Card */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={copy.stepIndicator(slide + 1, totalSlides)}
        tabIndex={-1}
        className="cinematic-modal-surface onboarding-modal-card"
        style={{
          width: '100%',
          maxWidth: slide === 0 ? '520px' : '580px',
          maxHeight: '90vh',
          background: 'var(--char-card, #161a12)',
          border: '1.5px solid var(--border-subtle, rgba(240, 168, 58, 0.25))',
          borderRadius: 'var(--radius-lg, 16px)',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.85)',
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
          boxSizing: 'border-box',
          overflow: 'hidden',
          animation: 'fadeIn 0.2s ease-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1rem 1.25rem 0.75rem',
            borderBottom: '1px solid var(--border-card, rgba(244, 236, 216, 0.08))',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'var(--amber)',
                background: 'rgba(240, 168, 58, 0.12)',
                padding: '0.2rem 0.55rem',
                borderRadius: '999px',
                border: '1px solid rgba(240, 168, 58, 0.25)',
              }}
            >
              {copy.stepIndicator(slide + 1, totalSlides)}
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #a1a1aa)' }}>
              {slide === 0 ? copy.slide1.badge : copy.slide2.badge}
            </span>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label={copy.skip || copy.close}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted, #a1a1aa)',
              cursor: 'pointer',
              padding: '0.25rem',
              borderRadius: 'var(--radius-sm, 6px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Slide Body (Scrollable if necessary) */}
        <div
          style={{
            padding: '1.25rem 1.35rem',
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          {slide === 0 ? (
            /* SLIDE 1 – WELCOME */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'center' }}>
              <div
                style={{
                  width: '54px',
                  height: '54px',
                  borderRadius: '50%',
                  background: 'rgba(240, 168, 58, 0.12)',
                  border: '1px solid rgba(240, 168, 58, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto',
                }}
              >
                <Sprout size={28} style={{ color: 'var(--amber)' }} />
              </div>

              <div>
                <h2
                  style={{
                    fontSize: '1.45rem',
                    fontWeight: 700,
                    color: 'var(--cream, #fff)',
                    margin: '0 0 0.45rem',
                    lineHeight: 1.3,
                  }}
                >
                  {copy.slide1.title}
                </h2>
                <p
                  style={{
                    fontSize: '0.9rem',
                    color: 'var(--cream, #e4e4e7)',
                    lineHeight: 1.5,
                    margin: 0,
                    opacity: 0.9,
                  }}
                >
                  {copy.slide1.subtitle}
                </p>
              </div>

              {/* Mitra Assistant Introduction Card */}
              <div
                style={{
                  background: 'rgba(244, 236, 216, 0.04)',
                  border: '1px solid var(--border-subtle, rgba(240, 168, 58, 0.2))',
                  borderRadius: 'var(--radius-md, 12px)',
                  padding: '1rem',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.65rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      background: 'rgba(240, 168, 58, 0.16)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Bot size={18} style={{ color: 'var(--amber)' }} />
                  </div>
                  <strong style={{ fontSize: '0.95rem', color: 'var(--cream, #fff)' }}>
                    {copy.slide1.assistantTitle}
                  </strong>
                </div>

                <p style={{ fontSize: '0.84rem', color: 'var(--text-muted, #d4d4d8)', lineHeight: 1.45, margin: 0 }}>
                  {copy.slide1.assistantDesc}
                </p>

                {/* Personalize Assistant Name */}
                <div style={{ marginTop: '0.25rem' }}>
                  <label
                    htmlFor="onboarding-assistant-name"
                    style={{
                      display: 'block',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      color: 'var(--amber)',
                      marginBottom: '0.35rem',
                    }}
                  >
                    {copy.slide1.nameLabel}
                  </label>
                  <input
                    id="onboarding-assistant-name"
                    type="text"
                    value={customAssistantName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder={copy.slide1.namePlaceholder}
                    maxLength={30}
                    style={{
                      width: '100%',
                      padding: '0.45rem 0.75rem',
                      borderRadius: 'var(--radius-sm, 8px)',
                      border: '1px solid var(--border-subtle, rgba(240, 168, 58, 0.3))',
                      background: 'rgba(10, 11, 7, 0.65)',
                      color: 'var(--cream, #fff)',
                      fontSize: '0.88rem',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* Hands-free Permission Note */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.1rem' }}>
                  <small style={{ fontSize: '0.74rem', color: 'var(--text-dim, #a1a1aa)', lineHeight: 1.4 }}>
                    {copy.handsFreeOptional} (
                    <button
                      type="button"
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('kisan-hita:open-settings'));
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--amber)',
                        padding: 0,
                        cursor: 'pointer',
                        fontSize: '0.74rem',
                        textDecoration: 'underline',
                      }}
                    >
                      {copy.openSettingsText}
                    </button>
                    )
                  </small>
                </div>
              </div>
            </div>
          ) : (
            /* SLIDE 2 – MEET YOUR FEATURES */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div style={{ textAlign: 'center' }}>
                <h2
                  style={{
                    fontSize: '1.35rem',
                    fontWeight: 700,
                    color: 'var(--cream, #fff)',
                    margin: '0 0 0.3rem',
                    lineHeight: 1.3,
                  }}
                >
                  {copy.slide2.title}
                </h2>
                <p
                  style={{
                    fontSize: '0.86rem',
                    color: 'var(--text-muted, #d4d4d8)',
                    lineHeight: 1.45,
                    margin: 0,
                  }}
                >
                  {copy.slide2.subtitle}
                </p>
              </div>

              {/* 5 Feature Cards */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.55rem',
                }}
              >
                {copy.slide2.features.map((feature, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: 'rgba(244, 236, 216, 0.035)',
                      border: '1px solid var(--border-card, rgba(244, 236, 216, 0.08))',
                      borderRadius: 'var(--radius-md, 10px)',
                      padding: '0.65rem 0.85rem',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                      transition: 'background 0.15s ease',
                    }}
                  >
                    <div
                      style={{
                        marginTop: '0.15rem',
                        padding: '0.35rem',
                        borderRadius: '6px',
                        background: 'rgba(240, 168, 58, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {renderFeatureIcon(feature.iconType)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong
                        style={{
                          display: 'block',
                          fontSize: '0.88rem',
                          color: 'var(--cream, #fff)',
                          marginBottom: '0.15rem',
                        }}
                      >
                        {feature.title}
                      </strong>
                      <p
                        style={{
                          fontSize: '0.8rem',
                          color: 'var(--text-muted, #d4d4d8)',
                          lineHeight: 1.4,
                          margin: 0,
                        }}
                      >
                        {feature.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '0.85rem 1.25rem 1rem',
            borderTop: '1px solid var(--border-card, rgba(244, 236, 216, 0.08))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: slide === 0 ? 'flex-end' : 'space-between',
            gap: '0.75rem',
          }}
        >
          {slide > 0 && (
            <button
              type="button"
              onClick={handleBack}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-subtle, rgba(244, 236, 216, 0.2))',
                color: 'var(--cream, #fff)',
                borderRadius: 'var(--radius-sm, 8px)',
                padding: '0.55rem 1rem',
                fontSize: '0.88rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              <ChevronLeft size={16} />
              <span>{copy.back}</span>
            </button>
          )}

          {slide === 0 ? (
            <button
              type="button"
              onClick={handleNext}
              style={{
                background: 'var(--amber, #f0a83a)',
                color: '#1a1811',
                border: 'none',
                borderRadius: 'var(--radius-sm, 8px)',
                padding: '0.6rem 1.35rem',
                fontSize: '0.92rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                boxShadow: '0 4px 14px rgba(240, 168, 58, 0.35)',
              }}
            >
              <span>{copy.next || copy.continueBtn}</span>
              <ChevronRight size={16} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleDismiss}
              style={{
                background: 'var(--amber, #f0a83a)',
                color: '#1a1811',
                border: 'none',
                borderRadius: 'var(--radius-sm, 8px)',
                padding: '0.6rem 1.35rem',
                fontSize: '0.92rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                boxShadow: '0 4px 14px rgba(240, 168, 58, 0.35)',
              }}
            >
              <Check size={16} />
              <span>{copy.finish || copy.getStartedBtn}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
