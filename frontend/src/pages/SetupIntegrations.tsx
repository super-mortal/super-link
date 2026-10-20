import { Button } from '@/components/ui/button.tsx';
import { useNavigate } from 'react-router-dom';
import { Onboarding } from '@/layouts/Onboarding.tsx';
import { SettingsIntegrations } from '@/components/Settings/SettingsIntegrations.tsx';

export const SetupIntegrations = () => {
  const navigate = useNavigate();

  return (
    <Onboarding currentStepIndex={1}>
      <SettingsIntegrations />

      <Button className="w-full" onClick={() => navigate('/setup/import')}>
        下一步：导入书签
      </Button>
    </Onboarding>
  );
};
