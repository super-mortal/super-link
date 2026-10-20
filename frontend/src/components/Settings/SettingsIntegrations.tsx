import { observer } from 'mobx-react-lite';
import { InstallApp } from '@/components/Settings/Integrations/InstallApp.tsx';

export const SettingsIntegrations = observer(() => {
  return (
    <div className="mx-auto w-full space-y-4">
      <InstallApp />
    </div>
  );
});
