declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<any> | null = null;

const YT_API_TIMEOUT_MS = 12000;

export function loadYouTubeApi(): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube API can only load in the browser.'));
  }

  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId: number | null = null;
    const existingScript = document.querySelector('script[data-yt-api="true"]') as HTMLScriptElement | null;
    const script = existingScript || document.createElement('script');

    const settleSuccess = () => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      script.removeEventListener('error', handleScriptError);
      resolve(window.YT);
    };

    const settleFailure = (error: Error) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      script.removeEventListener('error', handleScriptError);
      ytApiPromise = null;
      reject(error);
    };

    const handleScriptError = () => {
      settleFailure(new Error('Failed to load YouTube iframe API script.'));
    };

    if (!existingScript) {
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.ytApi = 'true';
      document.body.appendChild(script);
    }

    script.addEventListener('error', handleScriptError, { once: true });

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) {
        settleSuccess();
      }
    };

    const waitForApi = () => {
      if (settled) return;
      if (window.YT?.Player) {
        settleSuccess();
      } else {
        window.setTimeout(waitForApi, 50);
      }
    };

    timeoutId = window.setTimeout(() => {
      settleFailure(new Error(`Timed out loading YouTube player API after ${YT_API_TIMEOUT_MS}ms.`));
    }, YT_API_TIMEOUT_MS);

    waitForApi();
  });

  return ytApiPromise;
}

export function shouldIgnorePlayerShortcut(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || ['input', 'textarea', 'select', 'button'].includes(tagName);
}
