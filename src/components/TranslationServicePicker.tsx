import { Select } from "antd";
import { TRANSLATION_PROVIDERS, type TranslationProvider } from "../api/translation";

export function serviceSwitchAction(
  current: TranslationProvider,
  next: TranslationProvider,
  busy: boolean,
) {
  return busy || current === next ? "ignore" : "switch";
}

export function TranslationServicePicker({
  value,
  busy,
  onSwitch,
  className,
}: {
  value: TranslationProvider;
  busy: boolean;
  onSwitch: (provider: TranslationProvider) => void;
  className?: string;
}) {
  return (
    <Select
      aria-label="翻译服务"
      size="small"
      className={className}
      value={value}
      options={TRANSLATION_PROVIDERS}
      disabled={busy}
      onChange={(provider) => {
        if (serviceSwitchAction(value, provider, busy) === "switch") onSwitch(provider);
      }}
    />
  );
}
