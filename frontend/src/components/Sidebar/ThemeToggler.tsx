import { Moon, Sun, SunMoon } from 'lucide-react';

import { Button } from '@/components/ui/button.tsx';
import { Theme, useTheme } from '@/components/ThemeProvider.tsx';

export function ThemeToggler() {
  const { theme, setTheme } = useTheme();
  const switchTheme = () => {
    const themes: Theme[] = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(theme);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
  };

  return (
    <Button type="button" variant="ghost" size="icon" onClick={switchTheme}>
      <Sun
        className="absolute scale-0 rotate-90 transition-all data-[active=true]:scale-100 data-[active=true]:rotate-0"
        data-active={theme === 'light'}
      />
      <Moon
        className="absolute scale-0 rotate-90 transition-all data-[active=true]:scale-100 data-[active=true]:rotate-0"
        data-active={theme === 'dark'}
      />
      <SunMoon
        className="absolute scale-0 rotate-90 transition-all data-[active=true]:scale-100 data-[active=true]:rotate-0"
        data-active={theme === 'system'}
      />
      <span className="sr-only">切换主题</span>
    </Button>
  );
}
