import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ApiKeys {
  scrapedoKey: string;       // scrape.do — 1000 free/month, permanent, no credit card
  scraperApiKey: string;     // ScraperAPI — fallback
  openAiKey: string;         // OpenAI — AI descriptions
  openRouterKey: string;     // OpenRouter — Multi-model AI access
  geminiApiKey: string;      // Google Gemini Studio API
  supabaseUrl: string;
  supabaseAnonKey: string;
  stripePublishableKey: string;
  googleClientId: string;
}

export interface OpenRouterCredits {
  totalCredits: number;
  usedCredits: number;
  remainingCredits: number;
  lastChecked: string;
}

export interface StoreConfig {
  storeName: string;
  contactEmail: string;
  phone: string;
  address: string;
  freeShippingThreshold: number;
  shippingFee: number;
}

interface SettingsStore {
  apiKeys: ApiKeys;
  storeConfig: StoreConfig;
  openRouterCredits: OpenRouterCredits;
  updateApiKeys: (keys: Partial<ApiKeys>) => void;
  updateStoreConfig: (config: Partial<StoreConfig>) => void;
  updateOpenRouterCredits: (credits: Partial<OpenRouterCredits>) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      apiKeys: {
        scrapedoKey: '',
        scraperApiKey: '',
        openAiKey: '',
        openRouterKey: '',
        geminiApiKey: '',
        supabaseUrl: '',
        supabaseAnonKey: '',
        stripePublishableKey: '',
        googleClientId: '',
      },
      storeConfig: {
        storeName: 'Luxedge',
        contactEmail: 'hello@luxedge.us',
        phone: '(440) 941-8002',
        address: 'Irving, TX, USA',
        freeShippingThreshold: 50,
        shippingFee: 4.99,
      },
      openRouterCredits: {
        totalCredits: 0,
        usedCredits: 0,
        remainingCredits: 0,
        lastChecked: '',
      },
      updateApiKeys: (keys) =>
        set((state) => ({ apiKeys: { ...state.apiKeys, ...keys } })),
      updateStoreConfig: (config) =>
        set((state) => ({ storeConfig: { ...state.storeConfig, ...config } })),
      updateOpenRouterCredits: (credits) =>
        set((state) => ({ openRouterCredits: { ...state.openRouterCredits, ...credits } })),
    }),
    { name: 'luxedge-settings' }
  )
);
