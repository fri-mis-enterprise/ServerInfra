// ============================================================
// UI Store — global modals (confirm, prompt, etc.)
// ============================================================
import { pushState } from '$app/navigation';

type ConfirmOptions = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  withInput?: boolean;
  placeholder?: string;
  defaultValue?: string;
};

type ConfirmResult = {
  confirmed: boolean;
  value?: string;
};

let modalState = $state<{
  show: boolean;
  options: ConfirmOptions;
  component?: any;
  props?: any;
  resolve: (result: ConfirmResult) => void;
} | null>(null);

let hideChromeState = $state(false);

// Flag to prevent double navigation when closing manually
let closingFromPopstate = false;

// Listen for back button
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (modalState && modalState.show && !window.location.hash.includes('modal')) {
      closingFromPopstate = true;
      closeModal(false);
      closingFromPopstate = false;
    }
  });
}

export function getModalState() {
  return modalState;
}

export function openCustomModal(component: any, props: any = {}): Promise<ConfirmResult> {
  // Push state to history for back button support
  if (typeof window !== 'undefined') {
    pushState('#modal', {});
  }

  return new Promise((resolve) => {
    modalState = {
      show: true,
      options: { message: "" }, // Dummy message for basic compatibility
      component,
      props,
      resolve
    };
  });
}


type Alert = {
  id: number;
  message: string;
  type: "success" | "error" | "warning" | "info";
};

let alerts = $state<Alert[]>([]);

export function getAlerts() {
  return alerts;
}

export function triggerAlert(message: string, type: Alert["type"] = "error") {
  // Deduplicate: If an alert with the exact same message and type is already showing,
  // just refresh its timer instead of adding a new one.
  const existingIndex = alerts.findIndex(a => a.message === message && a.type === type);
  if (existingIndex !== -1) {
    // Remove the old one so the new one with fresh timer takes its place
    alerts = alerts.filter((_, i) => i !== existingIndex);
  }

  const id = Date.now();
  // Limit to 3 alerts
  const current = alerts.length >= 3 ? alerts.slice(1) : alerts;
  alerts = [...current, { id, message, type }];
  
  setTimeout(() => {
    alerts = alerts.filter((a) => a.id !== id);
  }, 5000);
}

export function removeAlert(id: number) {
  alerts = alerts.filter((a) => a.id !== id);
}

export function isChromeHidden() {
  return hideChromeState;
}

export function setHideChrome(hide: boolean) {
  hideChromeState = hide;
}

export function confirm(options: ConfirmOptions | string): Promise<ConfirmResult> {
  const opts: ConfirmOptions = typeof options === 'string' ? { message: options } : options;
  
  // Push state to history for back button support
  if (typeof window !== 'undefined') {
    pushState('#modal', {});
  }

  return new Promise((resolve) => {
    modalState = {
      show: true,
      options: opts,
      resolve
    };
  });
}

/**
 * Shorthand for simple confirmation
 */
export async function simpleConfirm(message: string, destructive = false): Promise<boolean> {
  const result = await confirm({ message, destructive });
  return result.confirmed;
}

/**
 * Shorthand for simple prompt
 */
export async function simplePrompt(message: string, placeholder = "", defaultValue = ""): Promise<string | null> {
  const result = await confirm({ 
    message, 
    withInput: true, 
    placeholder, 
    defaultValue 
  });
  return result.confirmed ? (result.value ?? "") : null;
}

export function closeModal(confirmed: boolean, value?: string) {
  if (modalState) {
    // If not triggered by popstate (back button), we need to manually remove the hash
    if (!closingFromPopstate && typeof window !== 'undefined' && window.location.hash.includes('modal')) {
      window.history.back();
    }
    
    modalState.resolve({ confirmed, value });
    modalState = null;
  }
}
