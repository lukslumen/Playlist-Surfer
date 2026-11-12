import { useCallback, useState } from 'react';

/**
 * Open/closed state of the app's modal dialogs, and which one Esc closes first. The import dialog's
 * state belongs to the import flow and is passed in.
 */
export function useDialogs(importDialog: { isImportOpen: boolean; closeImport: () => void }) {
  const { isImportOpen, closeImport } = importDialog;
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isKeyboardHelpOpen, setIsKeyboardHelpOpen] = useState(false);
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);
  const [isResearchLogOpen, setIsResearchLogOpen] = useState(false);

  const hasBlockingOverlay = isCommandPaletteOpen || isKeyboardHelpOpen || isDashboardOpen
    || isImportOpen || isExportOpen || isColumnsOpen || isResearchLogOpen;

  /** Closes the topmost open dialog; returns false when none is open. */
  const closeTopOverlay = useCallback(() => {
    if (isCommandPaletteOpen) setIsCommandPaletteOpen(false);
    else if (isKeyboardHelpOpen) setIsKeyboardHelpOpen(false);
    else if (isDashboardOpen) setIsDashboardOpen(false);
    else if (isImportOpen) closeImport();
    else if (isExportOpen) setIsExportOpen(false);
    else if (isColumnsOpen) setIsColumnsOpen(false);
    else if (isResearchLogOpen) setIsResearchLogOpen(false);
    else return false;
    return true;
  }, [isColumnsOpen, isCommandPaletteOpen, isDashboardOpen, isExportOpen, isImportOpen, isKeyboardHelpOpen, isResearchLogOpen, closeImport]);

  return {
    isCommandPaletteOpen, setIsCommandPaletteOpen,
    isKeyboardHelpOpen, setIsKeyboardHelpOpen,
    isDashboardOpen, setIsDashboardOpen,
    isExportOpen, setIsExportOpen,
    isColumnsOpen, setIsColumnsOpen,
    isResearchLogOpen, setIsResearchLogOpen,
    hasBlockingOverlay,
    closeTopOverlay,
  };
}
