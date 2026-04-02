/**
 * Setup Wizard Store
 * 
 * Manages state for the first-time setup wizard
 */

import { create } from 'zustand';
import type { SetupStep, SetupState } from '@/types';

interface SetupStore extends SetupState {
  setStep: (step: SetupStep) => void;
  markComplete: () => void;
  reset: () => void;
}

export const useSetupStore = create<SetupStore>((set) => ({
  currentStep: 'welcome',
  isComplete: false,

  setStep: (step) => set({ currentStep: step }),

  markComplete: () => set({ isComplete: true }),

  reset: () =>
    set({
      currentStep: 'welcome',
      isComplete: false,
    }),
}));
