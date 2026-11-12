import DashboardWorkspace, { type DashboardWorkspaceProps } from '../dashboard/DashboardWorkspace';

export type DatasetDashboardDialogProps = DashboardWorkspaceProps;

export function DatasetDashboardDialog(props: DatasetDashboardDialogProps) {
  if (!props.isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm" onMouseDown={props.onClose}>
      <div
        className="dialog-shell flex h-screen w-screen max-h-screen max-w-screen flex-col overflow-hidden bg-transparent p-0 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          width: '100vw',
          height: '100vh',
        }}
      >
        <DashboardWorkspace {...props} />
      </div>
    </div>
  );
}
