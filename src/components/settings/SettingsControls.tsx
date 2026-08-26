import { createContext, useContext } from "react";
import type { ServingControls } from "../../hooks/useServing";

const SettingsControlsContext = createContext<ServingControls | null>(null);

export function SettingsControlsProvider({
  controls,
  children,
}: {
  controls: ServingControls;
  children: React.ReactNode;
}) {
  return (
    <SettingsControlsContext.Provider value={controls}>{children}</SettingsControlsContext.Provider>
  );
}

export function useSettingsControls(): ServingControls {
  const controls = useContext(SettingsControlsContext);
  if (!controls) throw new Error("SettingsControlsProvider is missing");
  return controls;
}
