import { useCallback, useState } from 'react';

/** Open/closed state of the app's modal dialogs, and which one Esc closes first. */
export function useDialogs(options: { onCloseImport: () => void }) {
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isKeyboardHelpOpen, setIsKeyboardHelpOpen] = useState(false);
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);
  const [isResearchLogOpen, setIsResearchLogOpen] = useState(false);

  const hasBlockingOverlay = isCommandPaletteOpen || isKeyboardHelpOpen || isDashboardOpen
    || isImportOpen || isExportOpen || isColumnsOpen || isResearchLogOpen;

  const { onCloseImport } = options;
  /** Closes the topmost open dialog; returns false when none is open. */
  const closeTopOverlay = useCallback(() => {
    if (isCommandPaletteOpen) setIsCommandPaletteOpen(false);
    else if (isKeyboardHelpOpen) setIsKeyboardHelpOpen(false);
    else if (isDashboardOpen) setIsDashboardOpen(false);
    else if (isImportOpen) {
      setIsImportOpen(false);
      onCloseImport();
    } else if (isExportOpen) setIsExportOpen(false);
    else if (isColumnsOpen) setIsColumnsOpen(false);
    else if (isResearchLogOpen) setIsResearchLogOpen(false);
    else return false;
    return true;
  }, [isColumnsOpen, isCommandPaletteOpen, isDashboardOpen, isExportOpen, isImportOpen, isKeyboardHelpOpen, isResearchLogOpen, onCloseImport]);

  return {
    isCommandPaletteOpen, setIsCommandPaletteOpen,
    isKeyboardHelpOpen, setIsKeyboardHelpOpen,
    isDashboardOpen, setIsDashboardOpen,
    isImportOpen, setIsImportOpen,
    isExportOpen, setIsExportOpen,
    isColumnsOpen, setIsColumnsOpen,
    isResearchLogOpen, setIsResearchLogOpen,
    hasBlockingOverlay,
    closeTopOverlay,
  };
}
