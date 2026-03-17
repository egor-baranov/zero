import * as React from 'react';
import { Shell } from '@renderer/features/shell/shell';
import { applyUiPreferences, readUiPreferences } from '@renderer/store/ui-preferences';

export const App = (): JSX.Element => {
  React.useEffect(() => {
    applyUiPreferences(readUiPreferences());
  }, []);

  return <Shell />;
};
