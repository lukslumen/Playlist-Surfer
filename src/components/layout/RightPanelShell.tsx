import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';

/** The animated right-hand panel next to the grid (video details or channel summary). */
export function RightPanelShell({ isOpen, children }: { isOpen: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: '32%', opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 220 }}
          className="detail-pane-shell h-full min-w-[420px] max-w-[620px] overflow-hidden border-l border-[var(--border-color)] bg-[var(--bg-secondary)]"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
