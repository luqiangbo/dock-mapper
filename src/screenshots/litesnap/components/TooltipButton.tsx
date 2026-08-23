import { Button, Tooltip } from "antd";
import type { ReactNode } from "react";

interface TooltipButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  success?: boolean;
  loading?: boolean;
  onClick?: () => void;
  children: ReactNode;
}

function TooltipButton({
  label,
  active,
  disabled,
  danger,
  success,
  loading,
  onClick,
  children,
}: TooltipButtonProps): React.JSX.Element {
  return (
    <Tooltip title={label} placement="top" mouseEnterDelay={0.35}>
      <Button
        type="text"
        size="small"
        danger={danger}
        loading={loading}
        className={`tb-btn${active ? " is-active" : ""}${success ? " is-confirm" : ""}`}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        icon={children}
      />
    </Tooltip>
  );
}

export default TooltipButton;
