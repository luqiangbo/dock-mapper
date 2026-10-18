import {
  Component,
  lazy,
  Suspense,
  useMemo,
  useState,
  type ComponentPropsWithRef,
  type ReactNode,
} from "react";
import { Alert, Button } from "antd";
import type Editor from "./ExcalidrawScreenshotEditor";

export const loadExcalidrawEditor = () => import("./ExcalidrawScreenshotEditor");
type Props = ComponentPropsWithRef<typeof Editor>;

class EditorBoundary extends Component<
  {
    children: ReactNode;
    onError?: (message: string) => void;
    onRetry: () => void;
  },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onError?.(`标注工具加载失败：${error.message}`);
  }
  render() {
    return this.state.failed ? (
      <Alert
        type="error"
        title="标注工具加载失败，仍可框选和保存原图"
        action={<Button onClick={this.props.onRetry}>重试</Button>}
      />
    ) : (
      this.props.children
    );
  }
}

export default function ScreenshotEditorLoader(props: Props) {
  const [attempt, setAttempt] = useState(0);
  const LazyEditor = useMemo(() => lazy(loadExcalidrawEditor), [attempt]);
  return (
    <EditorBoundary
      key={`${props.captureKey}-${attempt}`}
      onError={props.onError}
      onRetry={() => setAttempt((value) => value + 1)}
    >
      <Suspense fallback={<div className="excalidraw-editor-loading">标注工具加载中…</div>}>
        <LazyEditor {...props} />
      </Suspense>
    </EditorBoundary>
  );
}
