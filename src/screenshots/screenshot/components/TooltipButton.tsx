import { Button, Tooltip } from "antd";
import type { ReactNode } from "react";

interface TooltipButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  success?: boolean;
  loading?: boolean;
  text?: string;
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
  text,
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
        className={`tb-btn${text ? " tb-btn--label" : ""}${active ? " is-active" : ""}${success ? " is-confirm" : ""}`}
        aria-label={label}
        aria-pressed={active === undefined ? undefined : active}
        disabled={disabled}
        onClick={onClick}
        icon={children}
      >
        {text}
      </Button>
    </Tooltip>
  );
}

export default TooltipButton;
