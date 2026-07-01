import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ApiKeys {
  scrapedoKey: string;       // scrape.do — 1000 free/month, permanent, no credit card
  scraperApiKey: string;     // ScraperAPI — fallback
  openAiKey: string;         // OpenAI — AI descriptions
  openRouterKey: string;     // OpenRouter — Multi-model AI access
  supabaseUrl: string;
  supabaseAnonKey: string;
  stripePublishableKey: string;
  googleClientId: string;
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
  updateApiKeys: (keys: Partial<ApiKeys>) => void;
  updateStoreConfig: (config: Partial<StoreConfig>) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      apiKeys: {
        scrapedoKey: '',
        scraperApiKey: '',
        openAiKey: '',
        openRouterKey: '',
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
      updateApiKeys: (keys) =>
        set((state) => ({ apiKeys: { ...state.apiKeys, ...keys } })),
      updateStoreConfig: (config) =>
        set((state) => ({ storeConfig: { ...state.storeConfig, ...config } })),
    }),
    { name: 'luxedge-settings' }
  )
);
